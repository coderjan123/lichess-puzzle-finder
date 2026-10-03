#!/usr/bin/env python3
"""
Vergleicht den Zuggenerator mit python-chess.

Der Test gegen den zweiten Generator in build/zugtest.mjs vergleicht nur
die MENGE der Zuege. Zwei Programme koennen denselben Fehler machen und
sich dann einig sein - so ist es passiert: beide haben den Turm bei der
Rochade neben das Brett geschrieben, und der Perft-Vergleich an Tiefe 3
zeigte 46 fehlende Blaetter, ohne die Ursache zu nennen.

Dieses Skript vergleicht deshalb nach JEDEM Zug die Stellung. Eine
abweichende FEN benennt Zug und Stellung genau.

    python3 build/gegenpython.mjs --python3 python3   # geht einfach: python3 build/gegenpython.mjs

Aufruf:
    python3 build/gegenpython.mjs [Tiefe] [nur_die_stellung]

Voraussetzung: python-chess (apt: python3-chess). Ist es nicht da,
ueberspringt sich das Skript mit einer klaren Meldung - die anderen
Tests laufen ohne diese Bibliothek.
"""

import json
import os
import subprocess
import sys
import tempfile

TIEFE = int(sys.argv[1]) if len(sys.argv) > 1 else 2
NUR = int(sys.argv[2]) if len(sys.argv) > 2 else None

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STELLUNGEN = [
    ('Anfangszug', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'),
    ('Kiwi-Pete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'),
    ('En passant', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'),
    ('Umbauprofile', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'),
    ('Schlag mit Schlag', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'),
    ('Ruhige Stellung', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'),
]


def sammle():
    """Alle Stellungen bis Tiefe TIEFE einsammeln, ep-Feld immer behalten.

    Zurueck kommen zwei Karten:
      zuege[fen]        die legalen Zuege als Text
      danach[fen|uci]   die Stellung, die dieser Zug ergeben MUESSTE
    """
    import chess

    zuege = {}
    danach = {}

    def lauf(brett, tiefe):
        # en_passant='fen' laesst das Feld stehen, auch wenn der Zug gerade
        # nicht legal waere. Ohne das bleiben genau die interessanten
        # Stellungen unsichtbar.
        fen = brett.fen(en_passant='fen')
        if fen not in zuege:
            zuege[fen] = sorted(m.uci() for m in brett.legal_moves)
            for u in zuege[fen]:
                b2 = brett.copy()
                b2.push_uci(u)
                danach[f'{fen}|{u}'] = b2.fen(en_passant='fen')
        if tiefe > 0:
            for m in list(brett.legal_moves):
                brett.push(m)
                lauf(brett, tiefe - 1)
                brett.pop()

    for i, (_, fen) in enumerate(STELLUNGEN, 1):
        if NUR and i != NUR:
            continue
        lauf(chess.Board(fen), TIEFE)
    return zuege, danach


def main():
    try:
        import chess  # noqa: F401
    except ImportError:
        print('python-chess fehlt - uebersprungen.')
        print('  Arch:  pacman -S python-chess')
        print('  Debian: apt install python3-chess')
        print('  pip:    pip install chess   (in einer virtuellen Umgebung)')
        return 0

    zuege, danach = sammle()
    mit_dir = tempfile.mkdtemp(prefix='lpf-gegen-')
    pfad_soll = os.path.join(mit_dir, 'soll.json')
    pfad_uns = os.path.join(mit_dir, 'uns.json')
    with open(pfad_soll, 'w', encoding='utf-8') as fh:
        json.dump(zuege, fh)

    # Der Generator laeuft in Node, weil er dort geschrieben ist.
    node = os.path.join(WURZEL, 'build', 'gegenpython.mjs')
    with open(pfad_uns, 'w', encoding='utf-8') as fh:
        ergebnis = subprocess.run(
            ['node', node, pfad_soll, pfad_uns],
            capture_output=True,
            text=True,
        )
        if ergebnis.returncode != 0:
            print(ergebnis.stderr.strip())
            return 1

    with open(pfad_uns, encoding='utf-8') as fh:
        uns = json.load(fh)

    fehler = 0
    geprueft = 0
    for schluessel, soll_fen in danach.items():
        geprueft += 1
        ist_fen = uns.get(schluessel)
        if ist_fen != soll_fen:
            fehler += 1
            if fehler <= 5:
                fen, uci = schluessel.rsplit('|', 1)
                print(f'ABWEICHUNG nach {uci} aus {fen}')
                print(f'  bei uns  : {ist_fen}')
                print(f'  python   : {soll_fen}')
    print(
        f'{geprueft - fehler} von {geprueft} Zuegen ergeben dieselbe Stellung '
        f'wie python-chess (Tiefe {TIEFE})'
    )
    return 1 if fehler else 0


if __name__ == '__main__':
    raise SystemExit(main())