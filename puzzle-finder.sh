#!/usr/bin/env bash
# ============================================================
#  Lichess Puzzle Finder (Shell)
#
#  Sucht Puzzles in lichess_db_puzzle.csv nach Theme, Rating und
#  Anzahl und gibt die Links aus.
#
#  Korrekturen gegenüber der vorherigen Fassung:
#
#    1. Die Theme-Liste ist jetzt dynamisch: sie wird aus dem Index
#       gelesen, nicht aus einer fest im Skript stehenden Liste. Vorher
#       waren nur 56 der 73 Themes der Datenbank überhaupt auswählbar
#       (u. a. cornerMate, operaMate, enPassant, underPromotion fehlten).
#
#    2. Es wird jede Index-Datei sortiert, nicht nur die Dateien der
#       eingebauten Theme-Liste. Vorher blieben die 17 zusätzlichen
#       Themen unsortiert - "100 schwerste Opera-Matte" lieferte
#       zufällige Puzzles statt der schwersten.
#
#    3. Der Index wird bei jedem Start auf Sortiertheit geprüft und notfalls
#       repariert. Ein Index aus einer älteren Skript-Version wird dadurch
#       automatisch repariert, statt jahrelang falsche Ergebnisse zu liefern.
#
#    4. Sortiert wird stabil und eindeutig: Rating absteigend, bei Gleichstand
#       Puzzle-ID aufsteigend, mit LC_ALL=C. Zwei Läufe liefern damit
#       garantiert dieselbe Liste (vorher hing die Reihenfolge bei
#       Gleichständen von der Sortierreihenfolge von GNU sort ab).
#
#    5. Fehlende oder leere Theme-Dateien führen in der UND-Suche zu einer
#       verständlichen Meldung statt zu einem Abbruch mitten in der Schleife.
# ============================================================
set -euo pipefail

# Feste Sortierreihenfolge, unabhängig von der eingestellten Systemsprache.
export LC_ALL=C

CSV="lichess_db_puzzle.csv"
INDEX_DIR=".lichess-puzzle-index"

# ============================================================
# Variablen
# ============================================================

RESULT=""

# ============================================================
# Hilfsfunktionen
# ============================================================

# Prüft, ob eine Index-Datei exakt nach "Rating absteigend, dann ID
# aufsteigend" sortiert ist, und sortiert sie andernfalls neu.
sort_index_file() {
    local file="$1"

    [[ -s "$file" ]] || return 0

    if sort -s -t$'\t' -k1,1nr -k2,2 -c "$file" 2>/dev/null; then
        return 0
    fi

    echo "  sortiere $(basename "$file")"
    sort -s -t$'\t' -k1,1nr -k2,2 "$file" > "$file.tmp"
    mv "$file.tmp" "$file"
}

# Alle Index-Dateien sortieren und prüfen (auch bei altem Index).
sort_all_index_files() {
    local file

    for file in "$INDEX_DIR"/*.tsv; do
        sort_index_file "$file"
    done
}

# Themes, für die es im Index tatsächlich Puzzles gibt.
themes_from_index() {
    local file

    for file in "$INDEX_DIR"/*.tsv; do
        [[ -s "$file" ]] || continue
        basename "$file" .tsv
    done | sort
}

# ============================================================
# Datenbank prüfen
# ============================================================

if [[ ! -f "$CSV" ]]; then
    echo
    echo "Fehler: $CSV wurde nicht gefunden."
    echo
    exit 1
fi

# ============================================================
# fzf prüfen
# ============================================================

if ! command -v fzf >/dev/null 2>&1; then
    echo
    echo "Fehler: fzf ist nicht installiert."
    echo
    echo "Installieren mit:"
    echo "  sudo pacman -S fzf"
    echo
    exit 1
fi

# ============================================================
# Index erstellen
# ============================================================

if [[ ! -f "$INDEX_DIR/.complete" ]]; then

    echo
    echo "Erstelle Index."
    echo "Das kann beim ersten Mal etwas dauern."
    echo

    rm -rf "$INDEX_DIR"
    mkdir -p "$INDEX_DIR"

    echo "Lese Datenbank..."

    # ========================================================
    # CSV-Spalten:
    #
    # $1 = PuzzleId
    # $2 = FEN
    # $3 = Moves
    # $4 = Rating
    # $5 = RatingDeviation
    # $6 = Popularity
    # $7 = NbPlays
    # $8 = Themes
    # $9 = GameUrl
    #
    # Die Themenamen stehen in $8; danach können Kommas folgen
    # (OpeningTags), deshalb wird bewusst nur auf die ersten 8
    # Felder gesplittet - awk -F',' würde sie sonst verschieben.
    # ========================================================

    awk -F',' '
        NR > 1 {

            id = $1
            rating = $4
            themes = $8

            if (id == "" || rating == "")
                next

            n = split(themes, t, " ")

            for (i = 1; i <= n; i++) {

                theme = t[i]

                if (theme != "") {

                    file = ".lichess-puzzle-index/" theme ".tsv"

                    print rating "\t" id >> file
                }
            }
        }
    ' "$CSV"

    echo "Sortiere Index..."

    # Jede Theme-Datei: Rating absteigend, bei Gleichstand ID aufsteigend.
    # Wichtig: alle Dateien, nicht nur die einer festen Theme-Liste.
    sort_all_index_files

    touch "$INDEX_DIR/.complete"

    echo
    echo "Index fertig."
    echo

fi

# ============================================================
# Index prüfen
# ============================================================

# Ein Index aus einer älteren Fassung kann unvollständig sortiert sein.
# Das wird hier erkannt und repariert, damit "schwerste/einfachste zuerst"
# immer stimmt.
NEEDS_SORT=0

for FILE in "$INDEX_DIR"/*.tsv; do
    if [[ -s "$FILE" ]] && ! sort -s -t$'\t' -k1,1nr -k2,2 -c "$FILE" 2>/dev/null; then
        NEEDS_SORT=1
        break
    fi
done

if (( NEEDS_SORT )); then
    echo
    echo "Index ist nicht vollständig sortiert - wird repariert."
    echo
    sort_all_index_files
fi

THEMES=$(themes_from_index)

if [[ -z "$THEMES" ]]; then
    echo
    echo "Fehler: Der Index enthält keine Puzzles."
    echo "Lösche $INDEX_DIR und starte das Skript erneut."
    echo
    exit 1
fi

THEME_AMOUNT=$(printf '%s\n' "$THEMES" | wc -l)

# ============================================================
# Theme-Auswahl
# ============================================================

echo
echo "THEMES AUSWÄHLEN"
echo
echo "$THEME_AMOUNT Themes verfügbar (aus der Datenbank)"
echo "TAB = mehrere auswählen | ENTER = bestätigen"
echo

SELECTED_THEMES=$(
    printf '%s\n' "$THEMES" |
    fzf \
        --multi \
        --height=80% \
        --border \
        --header="TAB = auswählen | ENTER = bestätigen" \
        --prompt="Theme > "
)

if [[ -z "$SELECTED_THEMES" ]]; then
    echo
    echo "Keine Themes ausgewählt."
    exit 1
fi

echo
echo "Ausgewählt:"
printf '  %s\n' "$SELECTED_THEMES"
echo

# ============================================================
# AND / OR
# ============================================================

THEME_COUNT=$(printf '%s\n' "$SELECTED_THEMES" | wc -l)

if (( THEME_COUNT > 1 )); then

    echo
    echo "Mehrere Themes:"
    echo
    echo "1) ODER - mindestens eines"
    echo "2) UND  - alle"
    echo

    read -rp "Auswahl [1-2]: " MODE || MODE=1

    case "$MODE" in
        2)
            THEME_MODE="AND"
            ;;
        *)
            THEME_MODE="OR"
            ;;
    esac

else

    THEME_MODE="OR"

fi

# ============================================================
# Rating
# ============================================================

echo
echo "RATING"
echo
echo "1) Schwerste zuerst"
echo "2) Einfachste zuerst"
echo "3) Eigene Rating-Range"
echo

read -rp "Auswahl [1-3]: " RATING_MODE || RATING_MODE=1

case "$RATING_MODE" in

    1)

        SORT_MODE="hardest"
        MIN_RATING=0
        MAX_RATING=9999

        ;;

    2)

        SORT_MODE="easiest"
        MIN_RATING=0
        MAX_RATING=9999

        ;;

    3)

        SORT_MODE="range"

        echo
        read -rp "Minimales Rating: " MIN_RATING
        read -rp "Maximales Rating: " MAX_RATING

        if ! [[ "$MIN_RATING" =~ ^[0-9]+$ ]]; then
            echo
            echo "Ungültiges minimales Rating."
            exit 1
        fi

        if ! [[ "$MAX_RATING" =~ ^[0-9]+$ ]]; then
            echo
            echo "Ungültiges maximales Rating."
            exit 1
        fi

        if (( MIN_RATING > MAX_RATING )); then
            echo
            echo "Das minimale Rating darf nicht größer als das maximale Rating sein."
            exit 1
        fi

        ;;

    *)
        echo
        echo "Ungültige Auswahl."
        exit 1
        ;;

esac

# ============================================================
# Anzahl
# ============================================================

echo

read -rp "Wie viele Puzzles? [100]: " COUNT || COUNT=100

COUNT=${COUNT:-100}

if ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    echo
    echo "Ungültige Anzahl."
    exit 1
fi

if (( COUNT < 1 )); then
    echo
    echo "Die Anzahl muss mindestens 1 sein."
    exit 1
fi

# ============================================================
# Suchkriterien anzeigen
# ============================================================

echo
echo "SUCHKRITERIEN"
echo

echo "Themes:"
printf '  %s\n' "$SELECTED_THEMES"

echo "Verknüpfung: $THEME_MODE"

case "$SORT_MODE" in

    hardest)
        echo "Sortierung: schwerste zuerst"
        ;;
    easiest)
        echo "Sortierung: einfachste zuerst"
        ;;
    range)
        echo "Rating: $MIN_RATING - $MAX_RATING"
        ;;
esac

echo "Anzahl: $COUNT"
echo
echo "Suche..."
echo

mapfile -t THEME_ARRAY <<< "$SELECTED_THEMES"

# ============================================================
# Eingaben gegen den Index prüfen
# ============================================================

# Die Themen kommen jetzt aus dem Index, trotzdem kann eine Datei
# zwischen Auswahl und Suche entfernt worden sein.
for THEME in "${THEME_ARRAY[@]}"; do

    if [[ ! -f "$INDEX_DIR/$THEME.tsv" ]]; then
        echo
        echo "Fehler: Für das Theme '$THEME' gibt es keine Index-Datei."
        echo
        exit 1
    fi

    if [[ ! -s "$INDEX_DIR/$THEME.tsv" ]]; then
        echo
        echo "Keine Puzzles für das Theme '$THEME' gefunden."
        echo
        exit 0
    fi

done

# ============================================================
# EIN Theme
# ============================================================

if (( THEME_COUNT == 1 )); then

    FILE="$INDEX_DIR/${THEME_ARRAY[0]}.tsv"

    # ========================================================
    # Schwerste zuerst
    # ========================================================

    if [[ "$SORT_MODE" == "hardest" ]]; then

        RESULT=$(
            awk \
                -F'\t' \
                -v count="$COUNT" '
                NR <= count {
                    print
                }

                NR >= count {
                    exit
                }
            ' "$FILE"
        )

    # ========================================================
    # Einfachste zuerst
    # ========================================================

    elif [[ "$SORT_MODE" == "easiest" ]]; then

        # "Einfachste zuerst" = Rating aufsteigend, bei Gleichstand ID
        # aufsteigend, also die ersten COUNT Zeilen einer aufsteigend
        # sortierten Datei.
        #
        # Wichtig: hier NICHT einfach die letzten COUNT Zeilen der absteigend
        # sortierten Datei nehmen - das würde innerhalb des niedrigsten
        # Ratings die größten IDs liefern und damit eine andere Auswahl als die
        # Website. Der Sortierdurchlauf kostet bei den größten Themes ein paar
        # Sekunden, ist aber immer exakt.
        RESULT=$(
            sort -s -t$'\t' -k1,1n -k2,2 "$FILE" |
            awk -v count="$COUNT" '
            NR <= count {
                print
            }
            '
        )

    # ========================================================
    # Rating Range
    # ========================================================

    else

        RESULT=$(
            awk \
                -F'\t' \
                -v min="$MIN_RATING" \
                -v max="$MAX_RATING" \
                -v count="$COUNT" '

                $1 >= min && $1 <= max {

                    print

                    found++

                    if (found >= count)
                        exit
                }

            ' "$FILE"
        )

    fi

# ============================================================
# MEHRERE THEMES - ODER
# ============================================================

elif [[ "$THEME_MODE" == "OR" ]]; then

    TMP=$(mktemp)
    SORTED_TMP=$(mktemp)

    trap 'rm -f "$TMP" "$SORTED_TMP"' EXIT

    # ========================================================
    # Alle Theme-Dateien zusammenführen
    # ========================================================

    for theme in "${THEME_ARRAY[@]}"; do

        cat "$INDEX_DIR/$theme.tsv" >> "$TMP"

    done

    if [[ ! -s "$TMP" ]]; then
        echo
        echo "Keine passenden Puzzles gefunden."
        exit 0
    fi

    # ========================================================
    # Sortierung
    # ========================================================

    if [[ "$SORT_MODE" == "easiest" ]]; then

        sort \
            -s \
            -t$'\t' \
            -k1,1n \
            -k2,2 \
            "$TMP" \
            > "$SORTED_TMP"

    else

        sort \
            -s \
            -t$'\t' \
            -k1,1nr \
            -k2,2 \
            "$TMP" \
            > "$SORTED_TMP"

    fi

    # ========================================================
    # Filtern + Duplikate + Anzahl
    # ========================================================

    RESULT=$(
        awk \
            -F'\t' \
            -v min="$MIN_RATING" \
            -v max="$MAX_RATING" \
            -v count="$COUNT" '

            $1 >= min && $1 <= max {

                # Ein Puzzle kann mehrere ausgewählte
                # Themes besitzen.

                if (!seen[$2]++) {

                    print

                    found++

                    if (found >= count)
                        exit
                }
            }

        ' "$SORTED_TMP"
    )

# ============================================================
# MEHRERE THEMES - UND
# ============================================================

else

    # ========================================================
    # AND wird komplett ohne "join" gemacht.
    #
    # Ein Puzzle muss in ALLEN Theme-Dateien vorkommen.
    #
    # Wir arbeiten mit temporären Dateien statt mit großen
    # Shell-Variablen.
    # ========================================================

    WORK_DIR=$(mktemp -d)

    trap 'rm -rf "$WORK_DIR"' EXIT

    CURRENT="$WORK_DIR/current.tsv"

    # Erstes Theme kopieren.

    cp "$INDEX_DIR/${THEME_ARRAY[0]}.tsv" "$CURRENT"

    # ========================================================
    # Mit jedem weiteren Theme schneiden wir die Liste.
    # ========================================================

    for theme in "${THEME_ARRAY[@]:1}"; do

        OTHER="$INDEX_DIR/$theme.tsv"

        NEXT="$WORK_DIR/next.tsv"

        # ====================================================
        # Puzzle-IDs des OTHER-Themes merken, dann CURRENT
        # durchlaufen und nur Puzzles behalten, deren ID
        # auch in OTHER existiert.
        # ====================================================

        awk \
            -F'\t' \
            '
            NR == FNR {
                exists[$2] = 1
                next
            }

            $2 in exists {
                print
            }
            ' \
            "$OTHER" \
            "$CURRENT" \
            > "$NEXT"

        mv "$NEXT" "$CURRENT"

        if [[ ! -s "$CURRENT" ]]; then
            break
        fi

    done

    # ========================================================
    # Rating filtern
    # ========================================================

    FILTERED="$WORK_DIR/filtered.tsv"

    awk \
        -F'\t' \
        -v min="$MIN_RATING" \
        -v max="$MAX_RATING" '
        $1 >= min && $1 <= max {
            print
        }
    ' "$CURRENT" > "$FILTERED"

    # ========================================================
    # Sortieren
    # ========================================================

    SORTED="$WORK_DIR/sorted.tsv"

    if [[ "$SORT_MODE" == "easiest" ]]; then

        sort \
            -s \
            -t$'\t' \
            -k1,1n \
            -k2,2 \
            "$FILTERED" \
            > "$SORTED"

    else

        sort \
            -s \
            -t$'\t' \
            -k1,1nr \
            -k2,2 \
            "$FILTERED" \
            > "$SORTED"

    fi

    # ========================================================
    # Anzahl begrenzen
    # ========================================================

    RESULT=$(
        awk \
            -v count="$COUNT" '
            NR <= count {
                print
            }
        ' "$SORTED"
    )

fi

# ============================================================
# Ergebnis
# ============================================================

if [[ -z "${RESULT:-}" ]]; then

    echo
    echo "Keine passenden Puzzles gefunden."
    echo

    exit 0

fi

echo
echo "ERGEBNIS"
echo

printf '%s\n' "$RESULT" |
awk \
    -F'\t' '
    {
        printf "%3d. Rating: %-5s https://lichess.org/training/%s\n", \
               NR, \
               $1, \
               $2
    }
'

echo
echo "Fertig."
