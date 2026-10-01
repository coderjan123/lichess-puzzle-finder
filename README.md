# Lichess Puzzle Finder

Die Bash-Suche aus der 1,1-GB-Datenbank als Website: Themes auswählen, Puzzles
filtern, Liste abhaken – auch auf dem Handy. Ohne dass irgendwo die Datenbank
installiert sein muss.

Gespielt wird bei lichess: jede Zeile öffnet `https://lichess.org/training/<ID>`
in einem neuen Tab. Die Seite selbst enthält kein Brett und keine Spiellogik.

Die Seite ist reines statisches HTML/CSS/JS und läuft damit kostenlos auf
**GitHub Pages**. Kein Backend, keine API, keine Schlüssel – und zur Laufzeit
wird nichts nachgeladen, sie funktioniert also auch offline.

**Auf einem alten Handy im schlechten WLAN steht die Ergebnisliste nach rund
zwei Sekunden da** – gemessen, nicht geschätzt:

| Szenario (UND, schwerste zuerst, 100 Puzzles) | Seitenstart | Klick → Liste | geladen |
|---|---|---|---|
| Matt in 3 ∩ Heranziehen | 0,63 s | 1,39 s | 124 kB in 17 Dateien |
| Matt in 3 ∩ Abzugscheck | 0,62 s | 1,37 s | 78 kB in 17 Dateien |
| Matt in 3 ∩ Blockade | 0,61 s | 3,98 s | 423 kB in 32 Dateien |
| Matt in 3 allein | 0,62 s | 0,85 s | 3 kB in 5 Dateien |
| Matt in 3 ∪ Heranziehen | 0,61 s | 0,87 s | 6 kB in 9 Dateien |

Gemessen mit `build/speedtest.mjs`: 320 ms Wartezeit, 380 kbit/s, geteilte
Leitung, echte Dateigrößen. Zum Vergleich: mit der ersten Fassung brauchte
dieselbe Suche **5,4 Sekunden** – die Zeit steckte nicht in den Bytes, sondern
in den 29 einzelnen Anfragen.

## Wie funktioniert das ohne die 1,1-GB-Datenbank?

Die Datenbank enthält pro Puzzle FEN, Lösung, Rating und Themes – 1,1 GB.
Davon braucht eine Suche aber nur **Rating und Puzzle-ID**, also
`2730<TAB>8ENVm`. Das ist der eigentliche Trick:

1. **Einmalig** (auf dem Rechner mit der CSV) wird daraus ein kompakter Index
   gebaut: pro Theme eine Datei je 100 Ratingpunkte, gzip-komprimiert, nach
   Rating sortiert. 127 MB gesamt, größte Einzeldatei 1,3 MB.
2. **Im Browser** wird nur geladen, was die Suche wirklich braucht, und der
   Download bricht ab, sobald genug Treffer da sind. „100 schwerste Matt-in-2“
   liest ~2 kB der obersten Datei. Eine typische Suche lädt 3–120 kB.
3. **UND-Suchen laufen als Misch-Operation über laufende Ströme.** Statt beide
   Themes vollständig zu laden und dann zu schneiden, laufen beide Ströme in der
   gewünschten Reihenfolge nebeneinander: stehen alle Köpfe auf demselben Puzzle,
   ist es ein Treffer; sonst wird der „kleinste“ Kopf verworfen, weil ihn kein
   anderer Strom mehr erreichen kann. Gelesen wird nur, bis `Anzahl` Treffer
   gefunden sind – für „100 schwerste aus Matt-in-3 ∩ Heranziehen“ 16 Dateien mit
   zusammen 80 kB statt 1,8 MB, und konstant wenig Speicher.
4. **Alle erwarteten Dateien werden gleichzeitig angefordert.** Das ist der
   wichtigste Teil für alte Geräte: 17 Anfragen nacheinander kosten 17 Wartezeiten
   (5,4 s bei 320 ms), nebeneinander nur eine (1,4 s). Der Index plant dazu vorab,
   welche Buckets eine Suche braucht, und lädt sie alle auf einmal.
5. **Puzzledaten braucht die Seite gar nicht** – weder FEN noch Lösung werden
   ausgeliefert. Ein Klick auf einen Treffer öffnet das Puzzle direkt bei
   lichess, wo es ohnehin gespielt wird.

Damit ist die Datenbank nur noch Bauzeit, und zwar auf einem Rechner.
Die ausgelieferte Seite ist **eine einzige HTML-Datei von 67 kB** (23 kB gzip):
CSS, JavaScript und der Index stecken alle darin, der erste Aufruf braucht genau
einen Request.

```
 CSV 1,1 GB ──(einmalig, build_index.py)──► docs/data/*.tsv.gz  (127 MB, statisch)
                                            │
 Browser ──1 Request (index.html)──► bedienbar in 0,6 s
        ──Klick──► 2–32 Dateien gleichzeitig ─► merged & sortiert clientseitig
        ──Klick auf einen Treffer──► lichess.org/training/<ID>
```

## Loslegen

```bash
npm install                 # nur fflate (Laufzeit) + esbuild und Playwright (Tests)
npm run data                # einmalig: CSV -> docs/data/  (ca. 100 s, 127 MB)
npm run build               # src/ -> docs/index.html (alles inline) + sw.js + icon
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
node build/speedtest.mjs --profile langsam --szenario and    # Zeit bis zur Liste
```

* `verify.mjs` lässt **24 Szenarien** sowohl durch `puzzle-finder.sh` als auch
  durch den Browser-Reader laufen und vergleicht die Ergebnislisten **exakt,
  einschließlich der Reihenfolge**. Zusätzlich prüft es, dass alle 73
  Index-Dateien streng sortiert sind (`sort -c`) und dass die 532 als „nie
  gemeinsam“ markierten Theme-Paare wirklich keine gemeinsamen Puzzles haben –
  geprüft gegen den Original-Index des Skripts.
  Aktuell: **24/24 identisch, Index vollständig sortiert, 15/15 Paare korrekt.**
  Zum Vergleich läuft die alte Fassung mit (`build/original.sh`, unverändert):
  von 14 vergleichbaren Szenarien war sie nur in 10 korrekt, 10 Themes kannte
  sie gar nicht.
* `uitest.mjs` fährt Firefox in Handy- und Desktop-Größe durch: Theme-Auswahl,
  ODER/UND, Rating-Range, Treffer gegen den Node-Reader, jede Zeile als Link auf
  `lichess.org/training/<ID>` mit `target=_blank`, Erreichbarkeit des Links,
  „IDs kopieren“, Reload mit letzter Suche, der `file://`-Hinweis, die Warnung bei
  unmöglichen UND-Kombinationen (mit der Zusicherung, dass dafür **keine**
  Datendatei geladen wird), Konsole – 25 Prüfungen, alle grün. Screenshots in
  `/tmp/opencode/shots`.
* `speedtest.mjs` bildet eine Leitung nach (Wartezeit, geteilte Bandbreite,
  echte Dateigrößen) und misst bis zur sichtbaren Ergebnisliste. Drei Profile
  (`langsam` 320 ms/380 kbit/s, `mittel`, `schnell`) und fünf Szenarien; die
  Grenze ist 3 s, alles darüber wird als Fehlschlag gemeldet.

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

Zwei Hinweise zum Deployment:

* **`docs/index.html` ist die ganze Seite.** CSS, JavaScript und der Index sind
  eingebettet, `docs/app.js` und `docs/style.css` gibt es im Normal-Build nicht
  mehr. Nur `docs/` als Verzeichnis publishen – nichts umstellen.
* **GitHub Pages und `http`:** Die Seite braucht für `fetch` ein Protokoll, aber
  kein `https` – ein reines `http://`-Repo funktioniert. Der Service Worker
  (`docs/sw.js`) braucht allerdings `https` oder `localhost`; ohne ihn läuft
  alles, nur ohne Cache. Für den vollen Effekt also `https` über
  `*.github.io` (bei `http` genügt ein Klick auf „Enforce HTTPS“ in den
  Pages-Einstellungen).

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
* **Manche UND-Kombinationen brauchen mehr als 3 Sekunden.** Der Schnitt wird
  von oben her gesucht und endet bei `Anzahl` Treffern – wie weit man dafür
  hinuntergehen muss, hängt von der Kombination ab. „Matt in 3 ∩ Heranziehen“
  schafft 100 Treffer mit 80 kB, „Matt in 3 ∩ Blockade“ braucht 423 kB und damit
  auf 380 kbit/s rund 4,6 Sekunden. Die Anzeige unter dem Suchknopf nennt vorher
  die Unter- und die Obergrenze; schneller ginge es nur mit weniger Daten, und
  die gibt es für eine echte Schnittmenge nicht.
* **532 von 2628 Theme-Paaren kommen nie gemeinsam vor** (`mateIn2 ∩ mateIn3`
  zum Beispiel, es sei denn in zwei Einzelfällen). Solche UND-Suchen beantwortet
  die Seite sofort mit „0 Treffer“, **ohne eine einzige Datei zu laden**. Das
  steht als Bitmatrix im Index, die der Index-Build gegen die Daten prüft.
* **Kein API-Kontakt.** Zur Laufzeit wird nichts abgerufen: eine Suche
  funktioniert offline (nach einmaligem Laden der Daten) und ist nicht von
  lichess-Limits abhängig.
* **Skript und Website sind deckungsgleich.** Beide sortieren nach
  „Rating absteigend, bei Gleichstand ID aufsteigend“ und liefern für alle 73
  Themes dieselbe Liste in derselben Reihenfolge – im Test exakt verifiziert.

## Aufbau

```
puzzle-finder.sh  korrigierte Shell-Suche (ersetzt ~/test.sh)
build_index.py    CSV -> Rating-Buckets + manifest.json         (einmalig)
bundle.mjs        src/ -> docs/index.html (esbuild, alles inline) + sw.js + icon
serve.mjs         statischer Testserver (bildet GitHub Pages nach)
verify.mjs        Vergleich Daten-Logik gegen das Original-Skript
uitest.mjs        Browser-Test der ganzen Oberfläche
speedtest.mjs     Zeitmessung mit nachgebauter Leitung
original.sh       unveränderte Kopie des alten Skripts, nur als Vergleich
docs/             das, was ausgeliefert wird: index.html, sw.js, icon.svg, data/
src/              Quellcode: main.js (Oberfläche), reader.js (Index + Sortierung),
                  themes.js (deutsche Theme-Namen), sw.js (Cache), index.html, style.css
```

### Datenformat

`docs/data/<theme>_<bucketstart>.tsv.gz`, z. B. `mateIn2_2400.tsv.gz`:
alle Puzzles mit Rating 2400–2499, jede Zeile `Rating<TAB>PuzzleId`, sortiert
Rating absteigend, dann ID aufsteigend – dieselbe Regel wie im Shell-Skript.

`docs/data/manifest.json` (25 kB, 8,5 kB gzip) steckt in der ausgelieferten
HTML, damit dafür kein Request nötig ist. Es enthält die Puzzlezahl, die
Buckets (Ratingfenster + Anzahl Einträge) je Theme und die Bitmatrix der Paare,
die nie gemeinsam vorkommen. Die ersten Fassung war 92 kB und wurde als eigene
Datei geladen – Byte-Größen und Rating-Spannen stehen nicht mehr drin, weil sie
sich aus Anzahl × 4,4 Byte je Eintrag ergeben.

Warum Buckets statt einer Datei je Theme: bei „schwerste zuerst“ wird nur die
oberste Datei angefasst, bei einem Rating-Fenster nur die Dateien im Fenster.
Die Suche für „100 schwerste aus `short`“ (3 Mio. Puzzles) lädt damit 1 kB
statt 14 MB.

## Lizenz/Herkunft

* Gzip im Browser: der Browser selbst (`DecompressionStream`).
  [fflate](https://github.com/101arrowz/fflate) (MIT) liegt als Rückfall für
  ältere Browser bei – die einzige Laufzeitabhängigkeit, 2,3 kB gzip.
* Bündeln: [esbuild](https://github.com/evanw/esbuild) (MIT), nur zum Bauen.
* Tests: [Playwright](https://playwright.dev) (Apache-2.0), nur zum Testen.
* Puzzledaten: [Lichess](https://lichess.org). Die Website liest nur den
  CSV-Index und verlinkt auf lichess.org – kein Konto, keine API, keine
  Schlüssel.
