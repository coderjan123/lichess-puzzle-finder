#!/usr/bin/env bash
# Unveraenderte Kopie von ~/test.sh (Stand vor der Korrektur).
# Nur Referenz fuer build/verify.mjs - die Suche selbst laeuft in puzzle-finder.sh.
#!/usr/bin/env bash
set -euo pipefail

CSV="lichess_db_puzzle.csv"
INDEX_DIR=".lichess-puzzle-index"

# ============================================================
# Themes
# ============================================================

THEMES=$(cat <<'EOF'
advancedPawn
advantage
anastasiaMate
arabianMate
attackingF2F7
attraction
backRankMate
bishopEndgame
bodenMate
capturingDefender
castling
clearance
crushing
defensiveMove
deflection
discoveredAttack
doubleBishopMate
doubleCheck
dovetailMate
endgame
equality
exposedKing
fork
hangingPiece
hookMate
interference
intermezzo
kingsideAttack
knightEndgame
long
master
masterVsMaster
mate
mateIn1
mateIn2
mateIn3
mateIn4
mateIn5
middlegame
oneMove
opening
pawnEndgame
pin
promotion
queenEndgame
queenRookEndgame
queensideAttack
quietMove
rookEndgame
sacrifice
short
skewer
smotheredMate
superGM
trappedPiece
underPromotion
veryLong
xRayAttack
zugzwang
EOF
)

# ============================================================
# Variablen
# ============================================================

RESULT=""

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

    # Theme-Dateien vorbereiten
    while IFS= read -r theme; do
        : > "$INDEX_DIR/$theme.tsv"
    done <<< "$THEMES"

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
    # ========================================================

    awk -F',' '
        NR > 1 {

            id = $1
            rating = $4
            themes = $8

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

    # ========================================================
    # Jede Theme-Datei:
    #
    #   Rating    PuzzleId
    #
    # absteigend nach Rating.
    # ========================================================

    while IFS= read -r theme; do

        FILE="$INDEX_DIR/$theme.tsv"

        if [[ -s "$FILE" ]]; then

            sort \
                -t$'\t' \
                -k1,1nr \
                "$FILE" \
                > "$FILE.tmp"

            mv "$FILE.tmp" "$FILE"
        fi

    done <<< "$THEMES"

    touch "$INDEX_DIR/.complete"

    echo
    echo "Index fertig."
    echo
fi

# ============================================================
# Theme-Auswahl
# ============================================================

echo
echo "THEMES AUSWÄHLEN"
echo
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

    echo "Mehrere Themes:"
    echo
    echo "1) ODER - mindestens eines"
    echo "2) UND  - alle"
    echo

    read -rp "Auswahl [1-2]: " MODE

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

read -rp "Auswahl [1-3]: " RATING_MODE

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

read -rp "Wie viele Puzzles? [100]: " COUNT

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
# EIN Theme
# ============================================================

if (( THEME_COUNT == 1 )); then

    FILE="$INDEX_DIR/${THEME_ARRAY[0]}.tsv"

    if [[ ! -f "$FILE" ]]; then
        echo
        echo "Index-Datei nicht gefunden:"
        echo "$FILE"
        exit 1
    fi

    if [[ ! -s "$FILE" ]]; then
        echo
        echo "Keine Puzzles für dieses Theme gefunden."
        exit 0
    fi

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

        # Die Datei ist absteigend sortiert.
        # Die einfachsten stehen am Ende.

        RESULT=$(
            tail -n "$COUNT" "$FILE" |
            tac
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

        FILE="$INDEX_DIR/$theme.tsv"

        if [[ -s "$FILE" ]]; then
            cat "$FILE" >> "$TMP"
        fi

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
            -t$'\t' \
            -k1,1n \
            "$TMP" \
            > "$SORTED_TMP"

    else

        sort \
            -t$'\t' \
            -k1,1nr \
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

        if [[ ! -s "$OTHER" ]]; then
            : > "$CURRENT"
            break
        fi

        NEXT="$WORK_DIR/next.tsv"

        # ====================================================
        # Puzzle-IDs des OTHER-Themes in einem Array merken.
        #
        # Danach CURRENT durchlaufen und nur Puzzles behalten,
        # deren ID auch in OTHER existiert.
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
            -t$'\t' \
            -k1,1n \
            "$FILTERED" \
            > "$SORTED"

    else

        sort \
            -t$'\t' \
            -k1,1nr \
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
