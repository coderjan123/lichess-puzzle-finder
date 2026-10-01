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
import json
import os
import sys
import time

# Rating-Bucket-Breite.
BUCKET = 100

# Bytes je Eintrag in den komprimierten Dateien (gemessen: 4,2-4,6 je
# Rating-Ebene). Wird nur fuer die Groessen-Anzeige im UI gebraucht.
BYTES_PER_ENTRY = 4.4

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

            if not puzzle_id:
                continue
            try:
                rating = int(parts[3])
            except ValueError:
                continue

            value = (int(rating) << 30) | encode_id(puzzle_id)

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
        # Der gepackte Wert ist rating * 2**30 + id, also sorts ascending nach
        # Rating und nach ID. Der zweite, stabile Sort dreht nur die Rating-
        # Reihenfolge um und lässt die ID-Reihenfolge within eines Ratings
        # unangetastet (Python-Sort ist stabil).
        values = sorted(packed[theme])
        values.sort(key=lambda v: v >> 30, reverse=True)
        packed[theme] = array.array("q")

        # In Buckets gruppieren. Die Werte liegen schon sortiert vor.
        buckets: dict[int, list[int]] = {}
        for v in values:
            buckets.setdefault((v >> 30) // BUCKET, []).append(v)

        entries = []
        for start in sorted(buckets, reverse=True):
            chunk = buckets[start]
            raw = "".join(
                f"{(v >> 30)}\t{decode_id(v & ((1 << 30) - 1))}\n" for v in chunk
            ).encode()
            gz = gzip.compress(raw, compresslevel=9, mtime=0)

            name = f"{theme}_{start * BUCKET}.tsv.gz"
            with open(os.path.join(out_dir, name), "wb") as out:
                out.write(gz)

            # [start, anzahl] - der Dateiname ergibt sich aus Theme + Start.
            # Die Byte-Groesse steht bewusst nicht im Manifest: sie wuerde es
            # um ein Drittel aufblaehen und wird nur fuer eine Anzeige
            # gebraucht, die aus anzahl x bytesPerEntry berechnet wird.
            entries.append([start * BUCKET, len(chunk)])

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

    # Selbstpruefung: einige Paare unabhaengig aus den Index-Dateien pruefen.
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
        starts_a = {s for s, _ in manifest["themes"][a]["b"]}
        starts_b = {s for s, _ in manifest["themes"][b]["b"]}
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
