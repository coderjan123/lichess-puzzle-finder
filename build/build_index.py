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
import gzip
import json
import os
import sys
import time

# Rating-Bucket-Breite.
BUCKET = 100

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

            for theme in themes.split(" "):
                if not theme:
                    continue
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
        "generated": time.strftime("%Y-%m-%d"),
        "source": os.path.basename(csv_path),
        "puzzles": rows,
        "bucketSize": BUCKET,
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

            # [start, anzahl, bytes] - der Dateiname ergibt sich aus Theme + Start.
            entries.append([start * BUCKET, len(chunk), len(gz)])

            total_gz += len(gz)
            total_files += 1
            if len(gz) > biggest[1]:
                biggest = (name, len(gz))
            del raw, chunk, gz

        manifest["themes"][theme] = {
            "n": len(values),
            "min": ratings_min[theme],
            "max": ratings_max[theme],
            "b": entries,
        }
        del values, buckets

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as out:
        json.dump(manifest, out, indent=1, sort_keys=True)

    manifest_size = os.path.getsize(os.path.join(out_dir, "manifest.json"))

    print(f"{len(manifest['themes'])} Themes, {total_files} Dateien")
    print(f"grösste Datei : {biggest[0]} ({biggest[1] / 1048576:.1f} MB)")
    print(f"manifest.json : {manifest_size / 1024:.0f} KB")
    print(f"Gesamt        : {(total_gz + manifest_size) / 1048576:.1f} MB")
    print(f"\nFertig in {time.time() - t0:.0f}s -> {out_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
