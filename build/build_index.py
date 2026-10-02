#!/usr/bin/env python3
"""
Baut aus lichess_db_puzzle.csv einen kompakten Theme-Index fuer die Website.

Der Index enthaelt pro Theme nur noch "Rating<TAB>PuzzleId" - keine FENs, keine
Moves. Die Puzzledaten selbst holt sich die Website zur Laufzeit kostenlos von
lichess.org/api/puzzle/<id> (oeffentlich, ohne Token).

Der Index ist nach Rating-Buckets (100 Punkte) aufgeteilt, damit die Seite fuer
eine Suche nur die 1-3 passenden Dateien laden muss:

    data/<theme>_<bucketStart>.tsv.gz   z. B. mateIn2_1400.tsv.gz
                                         alle Puzzles mit Rating 1400-1499,
                                         sortiert Rating absteigend, Id aufsteigend

    data/manifest.json                  Zaehler, Rating-Spannen, Dateigroessen

"Sortierung: Rating absteigend, dann Id aufsteigend" ist deterministisch und
haengt nicht von der Sortierstabilitaet der Laufzeitumgebung ab.

Aufruf:
    python3 build_index.py [pfad/zur/lichess_db_puzzle.csv] [pfad/zur/data]
"""

from __future__ import annotations

import array
import base64
import gzip
import math
import json
import os
import sys
import time

# Rating-Bucket-Breite.
BUCKET = 100

# Bytes je Eintrag in den komprimierten Dateien, gemessen: 6,46 (vor der
# Spielzahl-Spalte waren es 4,70). Wird nur fuer die Groessen-Anzeige im UI
# gebraucht - die Suche selbst rechnet mit echten Dateigroessen nichts.
BYTES_PER_ENTRY = 6.46

# Schrittweite der logarithmischen Spielzahl-Kodierung.
#
# NbPlays reicht in den Daten bis ueber 220.000. Als Zahl waeren das bis zu 6
# Zeichen je Eintrag und rund 50 MB mehr Index. Logarithmisch passt der Wert in
# ein Byte, und die Kurve muss den ganzen Wertebereich tragen:
#
#   13 Stufen je Oktave x 8 Bit = 19,6 Oktaven = bis 803.000
#   Gemessener groesster Rundungsfehler: 4,4 Prozent (bei kleinen Werten, wo
#   der Abzug der 1 staerker wiegt). Die Daten reichen bis 221.000, es ist
#   also dreifacher Puffer nach oben.
#
# "Mindestens 1.000 mal" heisst damit "mindestens ~960 mal". Fuer die Frage
# "wurde das oft genug gespielt" ist das unerheblich - und die Selbstpruefung
# unten laesst den Build abbrechen, falls der Wertebereich doch nicht reicht.
SOLV_STEPS = 13

# Groesster Wert, den das Byte noch trägt (Puffer nach oben).
SOLV_CEILING = int(2 ** (255 / SOLV_STEPS)) - 1


def encode_solv(nb_plays: int) -> int:
    """Wandelt eine Spielzahl in ein Byte (0-255), logarithmisch."""
    if nb_plays <= 0:
        return 0
    return min(255, int(round(SOLV_STEPS * math.log2(nb_plays + 1))))


def decode_solv(code: int) -> int:
    """Umkehrung fuer Anzeige und Schwellen: naeherungsweise Spielzahl."""
    if code <= 0:
        return 0
    return int(round(2 ** (code / SOLV_STEPS) - 1))

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE = len(ALPHABET)
BASE62 = {c: i for i, c in enumerate(ALPHABET)}


def encode_id(puzzle_id: str) -> int:
    """5-stellige base62-ID -> Zahl < 62^5 (~916 Mio.)."""
    n = 0
    for ch in puzzle_id:
        n = n * BASE + BASE62[ch]
    return n


def decode_id(n: int) -> str:
    chars = []
    for _ in range(5):
        n, rem = divmod(n, BASE)
        chars.append(ALPHABET[rem])
    return "".join(reversed(chars))


def pack_never(names: list[str], pairs: list[list[str]]) -> str:
    """Packt die Liste leerer Theme-Paare als Bitmatrix (base64).

    Zeile i, Spalte j = 1 bedeutet: die beiden Themes kommen nie gemeinsam vor.

    WICHTIG: `names` muss genau die Reihenfolge sein, in der die Themes spaeter
    in der JSON stehen - der Leser im Browser nutzt Object.keys(manifest.themes)
    und zaehlt die Bitpositionen in dieser Reihenfolge. Das Manifest wird mit
    sort_keys=True geschrieben, also alphabetisch. Eine andere Reihenfolge
    verschiebt alle Bits und wuerde erfundene "leere Paare" erzeugen.
    """
    index = {name: i for i, name in enumerate(names)}
    n = len(names)
    bits = bytearray((n * n + 7) // 8)
    for a, b in pairs:
        i, j = index[a], index[b]
        pos = i * n + j
        bits[pos // 8] |= 1 << (7 - (pos % 8))
    return base64.b64encode(bytes(bits)).decode()


def main() -> int:
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "lichess_db_puzzle.csv"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "data"

    if not os.path.isfile(csv_path):
        print(f"FEHLER: {csv_path} nicht gefunden")
        return 1

    for stale in os.listdir(out_dir) if os.path.isdir(out_dir) else []:
        if stale.endswith(".tsv.gz"):
            os.remove(os.path.join(out_dir, stale))

    os.makedirs(out_dir, exist_ok=True)

    # Gepackter Wert: Rating * 2**30 + Id.
    # Numerisch absteigend sortiert = Rating absteigend, dann Id aufsteigend.
    packed: dict[str, array.array] = {}
    ratings_min: dict[str, int] = {}
    ratings_max: dict[str, int] = {}
    # Paare von Themes, die in der Datenbank nie gemeinsam auftreten. Solche
    # UND-Kombinationen liefern immer 0 Treffer - die Website kann das sofort
    # sagen, statt mehrere Megabyte zu laden.
    theme_index: dict[str, int] = {}
    pairs_seen: set[int] = set()
    # Stichprobe der Spielzahlen fuer die Selbstpruefung weiter unten.
    solv_sample: list[tuple[int, int]] = []

    print(f"Lese {csv_path} ...")
    t0 = time.time()

    with open(csv_path, "r", encoding="utf-8", errors="replace", newline="") as fh:
        header = fh.readline()
        if not header.lower().startswith("puzzleid"):
            print("FEHLER: Unerwartetes CSV-Format (erste Zeile muss mit PuzzleId beginnen)")
            return 1

        rows = 0
        for line in fh:
            # Nur die ersten 8 Spalten interessieren uns. Der Rest (OpeningTags)
            # kann Kommas enthalten, deshalb bewusst manuell splitten.
            parts = line.split(",", 8)
            if len(parts) < 8:
                continue

            puzzle_id = parts[0]
            themes = parts[7]
            # Spalte 7 (0-basiert) ist NbPlays. Fehlt der Wert bei sehr neuen
            # Puzzles, zaehlt es als 0.
            try:
                nb_plays = int(parts[6])
            except (ValueError, IndexError):
                nb_plays = 0

            if not puzzle_id:
                continue
            try:
                rating = int(parts[3])
            except ValueError:
                continue

            # Gepackt: Spielzahl (8 Bit) | Rating (12 Bit) | Puzzle-ID (30 Bit)
            value = (encode_solv(nb_plays) << 42) | (int(rating) << 30) | encode_id(puzzle_id)

            row_themes = [t for t in themes.split(" ") if t]

            for theme in row_themes:
                if theme not in theme_index:
                    theme_index[theme] = len(theme_index)
                a = theme_index[theme]
                for other in row_themes:
                    if other is theme:
                        continue
                    if other not in theme_index:
                        theme_index[other] = len(theme_index)
                    b = theme_index[other]
                    # Immer als (kleinerer Index, groesserer Index) ablegen.
                    # Andernfalls passt der Schluessel nicht zur Abfrage unten,
                    # weil dort die Indexreihenfolge zaehlt, nicht die Namen.
                    pairs_seen.add(a * 256 + b if a < b else b * 256 + a)

                arr = packed.get(theme)
                if arr is None:
                    arr = array.array("q")
                    packed[theme] = arr
                    ratings_min[theme] = int(rating)
                    ratings_max[theme] = int(rating)
                arr.append(value)
                if rating < ratings_min[theme]:
                    ratings_min[theme] = int(rating)
                if rating > ratings_max[theme]:
                    ratings_max[theme] = int(rating)

            if len(solv_sample) < 20000 and rows % 37 == 0:
                solv_sample.append((encode_solv(nb_plays), nb_plays))

            rows += 1
            if rows % 1_000_000 == 0:
                print(f"  {rows:,} Zeilen  ({time.time() - t0:.0f}s)")

    print(f"{rows:,} Puzzles gelesen, {len(packed)} Themes ({time.time() - t0:.0f}s)\n")

    manifest: dict = {
        "v": 2,
        "generated": time.strftime("%Y-%m-%d"),
        "source": os.path.basename(csv_path),
        "puzzles": rows,
        "bucketSize": BUCKET,
        "bytesPerEntry": BYTES_PER_ENTRY,
        "themes": {},
    }

    total_gz = 0
    total_files = 0
    biggest = ("", 0)

    for theme in sorted(packed):
        # Sortierung: Rating absteigend, bei Gleichstand Puzzle-ID aufsteigend.
        # Gepackt ist der Wert als solv | rating | id, deshalb muss hier ueber
        # das Ratingmaskiert werden - ein Sortieren auf den ganzen Wert wuerde
        # zuerst nach Spielzahl ordnen.
        # Python sortiert stabil, also muss der NEBENSchluessel zuerst laufen:
        # erst nach ID aufsteigend, dann stabil nach Rating absteigend. Die
        # Reihenfolge der IDs innerhalb eines Ratings bleibt damit erhalten.
        id_mask = (1 << 30) - 1
        values = sorted(packed[theme])
        values.sort(key=lambda v: v & id_mask)
        values.sort(key=lambda v: -((v >> 30) & 0xFFF))
        packed[theme] = array.array("q")

        # In Buckets gruppieren. Die Werte liegen schon sortiert vor.
        buckets: dict[int, list[int]] = {}
        for v in values:
            buckets.setdefault(((v >> 30) & 0xFFF) // BUCKET, []).append(v)

        entries = []
        for start in sorted(buckets, reverse=True):
            chunk = buckets[start]
            # Drei Spalten: Rating, Puzzle-ID, Spielzahl-Kodierung.
            # Die Datei bleibt nach Rating absteigend sortiert - so laesst sich
            # beim Lesen weiterhin frueh abbrechen. Sortiert nach Spielzahl
            # wird erst beim Lesen, und nur wenn danach gefragt wird.
            raw = "".join(
                f"{(v >> 30) & 0xFFF}\t{decode_id(v & ((1 << 30) - 1))}\t{(v >> 42) & 0xFF}\n"
                for v in chunk
            ).encode()
            gz = gzip.compress(raw, compresslevel=9, mtime=0)

            name = f"{theme}_{start * BUCKET}.tsv.gz"
            with open(os.path.join(out_dir, name), "wb") as out:
                out.write(gz)

            # [start, anzahl, max_solv] - der Dateiname ergibt sich aus Theme
            # und Start.
            #
            # Die Byte-Groesse steht bewusst nicht im Manifest: sie wuerde es
            # um ein Drittel aufblaehen und wird nur fuer eine Anzeige gebraucht,
            # die aus anzahl x bytesPerEntry berechnet wird.
            #
            # max_solv dagegen ist noetig: um die top-N nach Spielzahl zu
            # finden, werden die Buckets nach ihrer groessten Spielzahl
            # absteigend geoeffnet. Sobald der N-te Treffer mindestens so hoch
            # ist wie die groesste Spielzahl aller noch geschlossenen Buckets,
            # kann nichts mehr nachruecken - dann ist die Liste fertig, ohne
            # den Rest zu laden. Ohne diese Zahl muesste ein Theme immer
            # vollstaendig gelesen werden (1,3 MB statt 200 kB).
            max_solv = max((v >> 42) & 0xFF for v in chunk)
            entries.append([start * BUCKET, len(chunk), max_solv])

            total_gz += len(gz)
            total_files += 1
            if len(gz) > biggest[1]:
                biggest = (name, len(gz))
            del raw, chunk, gz

        manifest["themes"][theme] = {"n": len(values), "b": entries}
        del values, buckets

    # Theme-Paare, die in der Datenbank nie gemeinsam vorkommen. Eine UND-Suche
    # auf so einem Paar kann sofort mit "0 Treffer" beantwortet werden, ohne
    # eine einzige Datei zu laden. 1681 von 2628 Paaren sind leer - das wird als
    # 73x73-Bitmatrix gespeichert (0,9 kB statt 48 kB als Textliste).
    by_index = sorted(theme_index, key=theme_index.get)
    never = [
        [by_index[i], by_index[j]]
        for i in range(len(by_index))
        for j in range(i + 1, len(by_index))
        if i * 256 + j not in pairs_seen
    ]
    # Alphabetische Reihenfolge = Reihenfolge der Keys in der JSON (sort_keys=True)
    ordered = sorted(manifest["themes"])
    manifest["neverBits"] = pack_never(ordered, never)

    # Selbstpruefung 1: die Kodierung der Spielzahl.
    #
    # Sie ist logarithmisch, damit ein Byte reicht. Der Preis ist ein
    # Rundungsfehler - wenn der groesser wird als geplant, sind alle Anzeigen
    # und Schwellen falsch. 2,2 Prozent sind der Konstruktionsfehler von 16
    # Stufen je Oktave.
    if solv_sample:
        worst = 0.0
        for code, n in solv_sample:
            if n <= 0:
                continue
            back = decode_solv(code)
            worst = max(worst, abs(back - n) / n)
        if worst > 0.05:
            raise SystemExit(
                f"FEHLER: Spielzahl-Kodierung verliert {worst:.1%} (erlaubt sind 5%)."
            )
        groesster = max(n for _c, n in solv_sample)
        if groesster > SOLV_CEILING:
            raise SystemExit(
                f"FEHLER: groesste Spielzahl {groesster:,} passt nicht in das Byte "
                f"(Grenze {SOLV_CEILING:,}). SOLV_STEPS auf {SOLV_STEPS} senken."
            )
        print(
            f"  Spielzahl-Kodierung geprueft: {len(solv_sample):,} Werte, "
            f"max. Fehler {worst:.2%}, groesster Wert {groesster:,} (Grenze {SOLV_CEILING:,})"
        )

    # Selbstpruefung 2: das Dateiformat. Jede Zeile muss drei Spalten haben,
    # die Datei nach Rating absteigend sortiert sein und die Spielzahl im
    # Bereich 0-255 liegen.
    for theme in list(manifest["themes"])[:3]:
        for start, _count, _maxsolv in manifest["themes"][theme]["b"][:2]:
            path = os.path.join(out_dir, f"{theme}_{start}.tsv.gz")
            prev = None
            with gzip.open(path, "rt") as fh:
                for line in fh:
                    felder = line.rstrip("\n").split("\t")
                    if len(felder) != 3:
                        raise SystemExit(f"FEHLER: {path} hat {len(felder)} Spalten, nicht 3.")
                    rating, pid, code = int(felder[0]), felder[1], int(felder[2])
                    if not 0 <= code <= 255:
                        raise SystemExit(f"FEHLER: {path} hat Spielzahl {code} ausserhalb 0-255.")
                    # Zwei Regeln getrennt: Rating absteigend, bei Gleichstand
                    # ID aufsteigend. Ein gemeinsamer Vergleich koennte beides
                    # nicht ausdruecken.
                    if prev is not None:
                        if rating > prev[0] or (rating == prev[0] and pid < prev[1]):
                            raise SystemExit(
                                f"FEHLER: {path} ist nicht sortiert: "
                                f"Rating {prev[0]}/{pid} vor {rating}/{pid}."
                            )
                    prev = (rating, pid)
    # max_solv im Manifest gegen die Dateien pruefen: ein falscher Wert wuerde
    # die Suche nach "meistgeloest" zu frueh beenden und damit eine falsche
    # Liste liefern - der teuerste Fehler, den diese Zahl machen kann.
    geprueft = 0
    for theme in list(manifest["themes"])[:6]:
        for start, _count, max_solv in manifest["themes"][theme]["b"][:6]:
            pfad = os.path.join(out_dir, f"{theme}_{start}.tsv.gz")
            with gzip.open(pfad, "rt") as fh:
                ist = max(int(zeile.rstrip("\n").split("\t")[2]) for zeile in fh if zeile.strip())
            if ist != max_solv:
                raise SystemExit(
                    f"FEHLER: max_solv im Manifest ist {max_solv}, in {pfad} steht {ist}."
                )
            geprueft += 1
    print(f"  max_solv im Manifest geprueft: {geprueft} Buckets stimmen")

    # Selbstpruefung 3: einige Paare unabhaengig aus den Index-Dateien pruefen.
    # Faellt eine Fehlklassifikation auf, bricht der Build ab - eine falsche
    # "nie gemeinsam"-Liste wuerde auf der Website leere Ergebnisse zeigen.
    probe_pairs = [
        ("mateIn2", "mateIn3", True),      # Matt-Themen schliessen sich aus
        ("mateIn1", "mateIn4", True),
        ("backRankMate", "sacrifice", False),  # kommen sehr oft zusammen
        ("mateIn3", "attraction", False),
        ("rookEndgame", "endgame", False),
        ("fork", "skewer", False),
        ("defensiveMove", "fork", False),
    ]
    wrong: list[str] = []
    for a, b, expected_empty in probe_pairs:
        if a not in manifest["themes"] or b not in manifest["themes"]:
            continue
        # Flag genau so auslesen wie der Browser es tut
        n_ord = len(ordered)
        ia, ib = ordered.index(a), ordered.index(b)
        lo, hi = (ia, ib) if ia < ib else (ib, ia)
        pos = lo * n_ord + hi
        raw_bits = base64.b64decode(manifest["neverBits"])
        flagged = bool((raw_bits[pos // 8] >> (7 - (pos % 8))) & 1)

        shared = False
        starts_a = {s for s, _c, _m in manifest["themes"][a]["b"]}
        starts_b = {s for s, _c, _m in manifest["themes"][b]["b"]}
        for start in sorted(starts_a & starts_b)[:6]:
            with gzip.open(os.path.join(out_dir, f"{a}_{start}.tsv.gz"), "rt") as fa:
                ids_a = {line.split("\t")[1] for line in fa if line.strip()}
            with gzip.open(os.path.join(out_dir, f"{b}_{start}.tsv.gz"), "rt") as fb:
                ids_b = {line.split("\t")[1] for line in fb if line.strip()}
            if ids_a & ids_b:
                shared = True
                break
        # Der Flag in der Matrix muss der Erwartung entsprechen. Ein faelschlich
        # als leer markiertes Paar wuerde auf der Website leere Ergebnisse zeigen,
        # wo es Treffer gibt - das ist der gefaehrliche Fehler.
        if flagged != expected_empty:
            wrong.append(f"{a}/{b}: erwartet leer={expected_empty}, Matrix sagt {flagged}")
        # Gegenprobe aus den Dateien. Nur die obersten gemeinsamen Buckets werden
        # gescannt, deshalb ist "nichts gefunden" hier kein Beweis - ein Fund bei
        # einem als leer markierten Paar waere dagegen ein Fehler.
        if shared and expected_empty:
            wrong.append(f"{a}/{b} kommt in den Buckets vor, ist aber als leer markiert")
        if not shared and not expected_empty:
            print(f"  Hinweis: {a} und {b} teilen in den geprueften Buckets keine ID")

    if wrong:
        raise SystemExit(
            "FEHLER: Bitmatrix der leeren Paare ist falsch.\n  - "
            + "\n  - ".join(wrong)
            + "\n  Ursache meist: andere Reihenfolge als in der JSON (siehe pack_never)."
        )
    print(f"  Bitmatrix geprueft: {len(probe_pairs)} Paare stimmen")

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as out:
        json.dump(manifest, out, separators=(",", ":"), sort_keys=True)

    manifest_size = os.path.getsize(os.path.join(out_dir, "manifest.json"))

    print(f"{len(manifest['themes'])} Themes, {total_files} Dateien")
    print(f"grösste Datei : {biggest[0]} ({biggest[1] / 1048576:.1f} MB)")
    print(f"manifest.json : {manifest_size / 1024:.1f} KB")
    print(f"leere Paare   : {len(never)} (z. B. alle mateInN untereinander)")
    print(f"Gesamt        : {(total_gz + manifest_size) / 1048576:.1f} MB")
    print(f"\nFertig in {time.time() - t0:.0f}s -> {out_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
