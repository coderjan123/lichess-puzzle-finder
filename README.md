# Lichess Puzzle Finder

Die Bash-Suche aus der 1,1-GB-Datenbank als Website: Themes auswählen, Puzzles
filtern, Liste abhaken – auch auf dem Handy. Ohne dass irgendwo die Datenbank
installiert sein muss.

Gespielt wird bei lichess: jede Zeile öffnet `https://lichess.org/training/<ID>`
in einem neuen Tab. Die Seite selbst enthält kein Brett und keine Spiellogik.

Die Seite ist reines statisches HTML/CSS/JS und läuft damit kostenlos auf
**GitHub Pages**. Kein Backend, keine API, keine Schlüssel – und zur Laufzeit
wird nichts nachgeladen, sie funktioniert also auch offline.

---

## Wie funktioniert das ohne die 1,1-GB-Datenbank?

Die Datenbank enthält pro Puzzle FEN, Lösung, Rating und Themes – 1,1 GB.
Davon braucht eine Suche aber nur **Rating und Puzzle-ID**, also
`2730<TAB>8ENVm`. Das ist der eigentliche Trick:

1. **Einmalig** (auf dem Rechner mit der CSV) wird daraus ein kompakter Index
   gebaut: pro Theme eine Datei je 100 Ratingpunkte, gzip-komprimiert, nach
   Rating sortiert. 127 MB gesamt, größte Einzeldatei 1,3 MB.
2. **Im Browser** wird nur die Datei geladen, die die Suche wirklich braucht.
   „100 schwerste Matt-in-2“ liest die ersten ~2 kB der obersten Datei und
   bricht den Download ab. Eine typische Suche lädt 1–300 kB, eine
   UND-Suche über zwei Themes ein paar MB.
3. **Puzzledaten braucht die Seite gar nicht** – weder FEN noch Lösung werden
   ausgeliefert. Ein Klick auf einen Treffer öffnet das Puzzle direkt bei
   lichess, wo es ohnehin gespielt wird.

Damit ist die Datenbank nur noch Bauzeit, und zwar auf einem Rechner.
Die Website insgesamt: **22 kB JavaScript, 12 kB CSS**, sonst nichts.

```
 CSV 1,1 GB ──(einmalig, build_index.py)──► docs/data/*.tsv.gz  (127 MB, statisch)
                                            │
 Browser ──ladet nur 1–3 Dateien──► merged & sortiert clientseitig
         ──Klick auf einen Treffer──► lichess.org/training/<ID>
```

## Loslegen

```bash
npm install                 # nur fflate (Laufzeit) + esbuild und Playwright (Tests)
npm run data                # einmalig: CSV -> docs/data/  (ca. 90 s, 127 MB)
npm run build               # src/ -> docs/ (app.js, css, icon)
npm run serve               # lokal + Handy: http://127.0.0.1:8123/
```

Zum Ausliefern braucht es nur `docs/` und einen Webserver – Node wird zur
Laufzeit nicht gebraucht.

`npm run data` braucht die CSV; per Voreinstellung `/home/jan/lichess_db_puzzle.csv`.
Pfad überschreiben:

```bash
python3 build/build_index.py /pfad/zu/lichess_db_puzzle.csv docs/data
```

Der Build ist reproduzierbar: gleiche CSV → gleiche Bytes (`gzip mtime=0`).

## Tests

```bash
node build/verify.mjs       # Such-Logik: Skript gegen Website, exakt in Reihenfolge
node build/uitest.mjs       # ganze Oberfläche im echten Browser (Playwright)
```

* `verify.mjs` lässt **24 Szenarien** sowohl durch `puzzle-finder.sh` als auch
  durch den Browser-Reader laufen und vergleicht die Ergebnislisten **exakt,
  einschließlich der Reihenfolge**. Zusätzlich prüft es, dass alle 73
  Index-Dateien streng sortiert sind (`sort -c`).
  Aktuell: **24/24 identisch, Index vollständig sortiert.**
  Zum Vergleich läuft die alte Fassung mit (`build/original.sh`, unverändert):
  von 14 vergleichbaren Szenarien war sie nur in 10 korrekt, 10 Themes kannte
  sie gar nicht.
* `uitest.mjs` fährt Firefox in Handy- und Desktop-Größe durch: Theme-Auswahl,
  ODER/UND, Rating-Range, Treffer gegen den Node-Reader, jede Zeile als Link auf
  `lichess.org/training/<ID>` mit `target=_blank`, Erreichbarkeit des Links,
  „IDs kopieren“, Reload mit letzter Suche, der `file://`-Hinweis, Konsole –
  21 Prüfungen, alle grün. Screenshots in `/tmp/opencode/shots`.

## Was im Shell-Skript korrigiert wurde

`puzzle-finder.sh` ist ein Ersatz für die alte Fassung (`~/test.sh.bak-original`
liegt als unveränderte Kopie daneben). Gleiche Bedienung, gleiche Menüs, fünf
Korrekturen:

1. **Alle 73 Themes sind auswählbar.** Die Theme-Liste kam vorher fest aus dem
   Skript und enthielt nur 56 Namen – 17 Themes der Datenbank
   (`cornerMate`, `operaMate`, `enPassant`, `vukovicMate`, …) waren gar nicht
   wählbar. Die Liste wird jetzt aus dem Index gelesen.
2. **Jede Index-Datei wird sortiert**, nicht nur die 56 der alten Liste. Deshalb
   kamen bei den 17 zusätzlichen Themes keine echten „schwersten“ Puzzles
   heraus, sondern die ersten 100 in CSV-Reihenfolge. Das Skript prüft die
   Sortiertheit jetzt bei **jedem** Start und repariert einen alten Index
   automatisch (beim ersten Lauf des neuen Skripts wurden 73 Dateien neu
   sortiert).
3. **Stabile, eindeutige Reihenfolge:** `sort -s`, `LC_ALL=C`, Schlüssel
   `Rating absteigend, dann Puzzle-ID aufsteigend`. Vorher hing die Reihenfolge
   bei Gleichständen von der Sortierreihenfolge von GNU `sort` ab, zwei Läufe
   konnten unterschiedliche Listen liefern.
4. **„Einfachste zuerst“ liefert dieselbe Auswahl wie die Website.** Das alte
   Skript nahm die letzten n Zeilen und drehte sie um (`tac`), was innerhalb
   des niedrigsten Ratings die *größten* IDs ergab. Bei „1000 einfachste aus
   mateIn2“ waren das andere Puzzles als in der Website.
5. **Saubere Fehlermeldungen.** Ein Theme ohne Index-Datei brach die UND-Suche
   vorher mitten in der Schleife mit einem rohen `cp: cannot stat` ab; jetzt
   gibt es eine verständliche Meldung. `read` am EOF (z. B. Ctrl-D) führt nicht
   mehr zu einem Abbruch.

Die Index-Dateien selbst bleiben kompatibel: `.lichess-puzzle-index` wird
unverändert weiterverwendet, nur notfalls neu sortiert.

## Auf GitHub Pages deployen

```bash
cd lichess-puzzle-finder
git init
git add -A            # ca. 127 MB Daten + Quellcode
git commit -m "Lichess Puzzle Finder"
git branch -M main
git remote add origin git@github.com:<DEIN-NAME>/<REPO>.git
git push -u origin main
```

Dann in GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch `main`, Ordner `/docs`** → Save. Nach etwa einer Minute ist die Seite
unter `https://<DEIN-NAME>.github.io/<REPO>/` erreichbar.

Die Seite läuft auch in einem Unterordner (relative Pfade), `https` ist nicht
nötig – aber `file://` schon: `fetch` braucht HTTP, also bitte über den Server
oder GitHub Pages öffnen.

## Bedienung

* **Themes**: mehrfach auswählbar, gruppiert (Matt-Motive, Taktik, Endspiel …),
  Suchfeld nimmt `matt`, `matein2` oder `mate in 2`.
* **ODER/UND** erscheint automatisch, sobald mehr als ein Theme gewählt ist.
* **Reihenfolge**: schwerste zuerst, einfachste zuerst oder freies
  Rating-Fenster.
* **Anzahl** 1–5000.
* Unter dem Suchknopf steht vorher, wie viele Daten die Suche ungefähr lädt.
* **Ergebnis**: jede Zeile ist ein Link auf das Puzzle bei lichess und öffnet
  einen neuen Tab, die Liste bleibt stehen. Besuchte Zeilen markiert der Browser
  selbst. „Auf lichess öffnen“ springt direkt auf den ersten Treffer.
* **IDs kopieren**: damit lässt sich die ganze Liste bei lichess unter
  *Training → Importieren* einfügen und dort komplett mit Rating-Verlauf
  durchspielen.
* Die zuletzt gesuchte Liste bleibt im `localStorage` und ist nach einem Reload
  wieder da.

## Grenzen und bewusste Entscheidungen

* **Ratings sind ein Schnappschuss.** Die Liste zeigt das Rating aus der
  CSV. Lichess bewertet Puzzles laufend neu, im Spieler steht deshalb das
  aktuelle Rating aus der API. Beispiel: `8ENVm` steht im Index mit 2730, bei
  lichess aktuell mit 2354. Themes sind stabil.
* **UND-Suchen laden mehr.** Für „alle Themes“ muss der Schnitt berechnet
  werden; das kostet die Buckets aller beteiligten Themes (ein paar MB). Die
  App sagt die Größe vorher an.
* **Kein API-Kontakt.** Zur Laufzeit wird nichts abgerufen: eine Suche
  funktioniert offline (nach einmaligem Laden der Daten) und ist nicht von
  lichess-Limits abhängig.
* **Skript und Website sind jetzt deckungsgleich.** Beide sortieren nach
  „Rating absteigend, bei Gleichstand ID aufsteigend“ und liefern für alle 73
  Themes dieselbe Liste in derselben Reihenfolge – im Test exakt verifiziert.

## Aufbau

```
puzzle-finder.sh  korrigierte Shell-Suche (ersetzt ~/test.sh)
puzzle-finder.sh  korrigierte Shell-Suche (ersetzt ~/test.sh)
build_index.py    CSV -> Rating-Buckets + manifest.json         (einmalig)
bundle.mjs        src/ -> docs/app.js (esbuild, minifiziert)
serve.mjs         statischer Testserver (bildet GitHub Pages nach)
verify.mjs        Vergleich Daten-Logik gegen das Original-Skript
uitest.mjs        Browser-Test der ganzen Oberfläche
original.sh       unveränderte Kopie des alten Skripts, nur als Vergleich
docs/             das, was ausgeliefert wird: index.html, app.js, css, data/
src/              Quellcode: main.js (Oberfläche), reader.js (Index + Sortierung),
                  themes.js (deutsche Theme-Namen), index.html, style.css
```

### Datenformat

`docs/data/<theme>_<bucketstart>.tsv.gz`, z. B. `mateIn2_2400.tsv.gz`:
alle Puzzles mit Rating 2400–2499, jede Zeile `Rating<TAB>PuzzleId`, sortiert
Rating absteigend, dann ID aufsteigend – dieselbe Regel wie im Shell-Skript. `docs/data/manifest.json` (92 kB) zählt
die Puzzles, nennt Rating-Spanne und Dateigröße je Theme und Bucket.

Warum Buckets statt einer Datei je Theme: bei „schwerste zuerst“ wird nur die
oberste Datei angefasst, bei einem Rating-Fenster nur die Dateien im Fenster.
Die Suche für „100 schwerste aus `short`“ (3 Mio. Puzzles) lädt damit 1 kB
statt 14 MB.

## Lizenz/Herkunft

* Gzip im Browser: [fflate](https://github.com/101arrowz/fflate) (MIT) – die
  einzige Laufzeitabhängigkeit.
* Bündeln: [esbuild](https://github.com/evanw/esbuild) (MIT), nur zum Bauen.
* Tests: [Playwright](https://playwright.dev) (Apache-2.0), nur zum Testen.
* Puzzledaten: [Lichess](https://lichess.org). Die Website liest nur den
  CSV-Index und verlinkt auf lichess.org – kein Konto, keine API, keine
  Schlüssel.
