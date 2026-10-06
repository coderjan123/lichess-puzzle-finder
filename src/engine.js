/**
 * Stockfish im Browser: Dateien laden, UCI sprechen, Bewertungen ausgeben.
 *
 * Die Engine ist ein ES-Modul mit einer Default-Export-Funktion, die ein
 * Emscripten-WASM-Modul erzeugt (das npm-Paket @lichess-org/stockfish-web, so
 * wie lila es benutzt). Der Import passiert deshalb ZUR LAUFZEIT in einem
 * Web-Worker: die mehrere Megabyte sollen erst fliessen, wenn jemand die
 * Engine einschaltet, und die Suche darf den Hauptthread nicht blockieren.
 *
 * Gemessen, nicht geraten (Stockfish 19 smallnet, Firefox, Startstellung):
 *   info depth 12 … score cp 31 nodes 12743 nps 335342 time 38 pv e2e4 c7c5 …
 *   bestmove e2e4 ponder c7c5
 *
 * Zwei Dinge, die man wissen muss, bevor man das hier aufruft:
 *
 *   1. Die Engine braucht SharedArrayBuffer (pthreads-WASM). Das gibt es im
 *      Browser nur bei "cross-origin isolation", also nur wenn der Server
 *      COOP: same-origin und COEP: require-corp schickt. Ohne diese Header
 *      startet die Engine zwar, antwortet aber auf "uci" mit nichts - kein
 *      Fehler, nur Stille. verfuegbar() sagt deshalb vorher Bescheid.
 *      Ein Web-Worker ist NICHT die Abhilfe: Worker erben die Isolation der
 *      Seite, nicht umgekehrt.
 *   2. Ueber file:// geht es gar nicht: der Import eines ES-Moduls und das
 *      Nachladen der .wasm brauchen einen echten Origin. Deshalb der klare
 *      Text hier statt eines stillen Nichtstuns.
 *
 * Diese Datei muss in node importierbar sein, ohne zu werfen. Alles, was den
 * Browser braucht, liegt hinter istBrowser()/verfuegbar(); der Parser steht in
 * build/enginebefehl.mjs und wird von hier und vom Parser-Test benutzt.
 */

import { parseUciZeile } from '../build/enginebefehl.mjs';

export { parseUciZeile };

/**
 * Die Engine-Versionen, die es im Repo gibt. Alles andere ist eine Option für
 * später - siehe die Messwerte bei jedem Eintrag.
 *
 * `url` zeigt auf die .js (Einstiegspunkt des Moduls), `nnueBasis` auf den
 * Ordner mit den Netzdateien. Beide liegen nebeneinander, damit locateFile
 * ohne weitere Angaben auskommt.
 */
export const VERFUEGBARE_VERSIONEN = [
  {
    id: 'sf19-lite-single',
    name: 'Stockfish 19 · lite (1,7 MB)',
    url: 'engine/stockfish-19-lite-single.js',
    groesseHinweis: '1,7 MB',
    // 21.415 B js + 1.787.571 B wasm. Einfaedig: braucht weder
    // SharedArrayBuffer noch COOP/COEP-Header, laeuft also auf GitHub Pages.
    // Der Mehrfadenbau waere staerker, ist aber unmoeglich (siehe umgebungsProblem).
    threads: 1,
  },
];

/**
 * Wo der Browser ist. In node gibt es weder Worker noch location - deshalb
 * dieses eine Gate, hinter dem die ganze Ladelogik liegt.
 */
export function istBrowser() {
  return (
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof window.Worker === 'function' &&
    typeof window.WebAssembly === 'object'
  );
}

/**
 * Der eine Grund, warum es hier nicht weitergeht - oder null, wenn es weitergeht.
 * Als Text, damit die Anzeige ihn einfach zeigen kann, statt selbst zu raten.
 */
export function umgebungsProblem() {
  if (!istBrowser()) return 'Kein Browser - die Engine läuft nur im Browser.';
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return (
      'Die Seite läuft über file://. Die Engine braucht einen echten Webserver ' +
      '(node build/serve.mjs <port>) - ein ES-Modul und .wasm lassen sich vom ' +
      'Dateisystem nicht laden.'
    );
  }
  return null;
}

/** Kurzform von umgebungsProblem(): nur ja oder nein. */
export async function verfuegbar() {
  return umgebungsProblem() === null;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Kein eigener Worker mehr: der Bausatz von Stockfish.js ist selbst einer.
// Ein Blob-Worker mit dem Emscripten-Modul darin wäre die zweite Variante
// gewesen - sie braucht aber SharedArrayBuffer und damit COOP/COEP-Header,
// und GitHub Pages kann die nicht setzen. Gemessen und gemessen gegengeprüft:
// "Stockfish 19 · Small" von lila schweigt ohne Header nach dem "uci",
// "Stockfish 19 lite single" rechnet ohne Header bis Tiefe 14.
// ---------------------------------------------------------------------------


/** Zustand einer Mehrzeilen-Suche: je index die zuletzt gesehene info-Zeile. */
/**
 * Fehlertext, der den Grund nennt. Firefox schreibt den Text einer Ausnahme
 * nicht an den Anfang von .stack - nur der Bildschirmname und die Zeile
 * stünden da, und genau damit ist nichts zu machen.
 */
function beschreiben(fehler) {
  if (!(fehler instanceof Error)) return String(fehler);
  const text = `${fehler.name}: ${fehler.message}`;
  return fehler.stack && !fehler.stack.includes(fehler.message) ? `${text} | ${fehler.stack}` : text;
}

function neueSuche() {
  return { zeilen: new Map(), tiefe: 0, knoten: 0, nps: 0, sekunden: 0 };
}

/** Ein Eintrag für die Anzeige: erster Zug der Variante und die ganze Linie. */
function eintrag(info) {
  const uci = Array.isArray(info.uci) ? info.uci : [];
  return {
    cp: typeof info.cp === 'number' ? info.cp : null,
    mate: typeof info.mate === 'number' ? info.mate : null,
    uci: uci[0] ?? null,
    pgn: uci.join(' '),
    tiefe: typeof info.tiefe === 'number' ? info.tiefe : null,
    upperbound: info.upperbound === true,
  };
}

function bewertungText(cp, mate) {
  if (typeof mate === 'number') return `M${mate > 0 ? '+' : ''}${mate}`;
  if (typeof cp === 'number') return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
  return '–';
}

/**
 * Engine laden. Wartet, bis die Engine auf "uci" geantwortet hat.
 *
 * @param {string|object} url  Pfad zur .js oder ein Eintrag aus
 *        VERFUEGBARE_VERSIONEN (dann wird nnueBasis von dort genommen)
 * @param {{anzeigen?: (text: string) => void, basis?: string}} optionen
 *        anzeigen bekommt jede Statuszeile ("lade Modul", "Netz … geladen",
 *        "bereit"). basis ist der Ordner, gegen den relative Pfade aufgelöst
 *        werden - normalerweise die Seite selbst.
 * @returns {Promise<object>} das Engine-Objekt
 */
export async function engineLaden(url, { anzeigen, basis } = {}) {
  const melden = typeof anzeigen === 'function' ? anzeigen : () => {};

  const problem = umgebungsProblem();
  if (problem) throw new Error(problem);

  const version = typeof url === 'string' ? { url } : url;
  if (!version || typeof version.url !== 'string' || version.url === '') {
    throw new Error('engineLaden braucht eine URL zur .js der Engine');
  }
  // Relative Pfade aus VERFUEGBARE_VERSIONEN sind relativ zur Seite gedacht.
  // Eine Seite tiefer im Baum (src/engine-test.html) muss "basis" mitgeben.
  const wurzel = basis ?? document.baseURI;
  const modulUrl = new URL(version.url, wurzel).href;

  // Der Bausatz von Stockfish.js ist selbst der Worker: `new Worker(url)`,
  // danach kommen fertige UCI-Zeilen als Text herein. Das ist der einzige
  // Weg, der auf GitHub Pages trägt - der Mehrfädligkeitsbau von lila
  // braucht SharedArrayBuffer, also COOP/COEP-Header, und die kann
  // GitHub Pages nicht setzen. Gemessen: ohne Header startet jener Bau,
  // antwortet auf "uci" und schweigt danach; dieser rechnet bis Tiefe 14.
  const worker = new Worker(modulUrl);

  // Der Zustand der Suchen liegt hier, nicht im Worker: der Worker kennt nur
  // Zeilen, das Zusammenfassen zu einer Bewertung ist Sache der Anzeige.
  let bereit = false;
  let schliessen = false;
  let laeuft = false; // "go" raus, "bestmove" noch nicht zurück
  let suche = neueSuche();
  let threads = version.threads ?? 1;
  let mehrzeilen = 1;
  let gesetzteThreads = threads; // was zuletzt per setoption gesetzt wurde
  let gesetzteMehrzeilen = mehrzeilen;
  let position = { fen: null, zuege: [] };

  let infoHaken = () => {};
  let fehlerHaken = () => {};

  const sagenFehler = (text) => {
    try {
      fehlerHaken(String(text));
    } catch {
      /* ein Haken, der selbst wirft, darf die Engine nicht aufhalten */
    }
  };

  const meldeInfo = (nutzlast) => {
    try {
      infoHaken(nutzlast);
    } catch {
      /* dito */
    }
  };

  /** Die gesammelten Zeilen zu einer Anzeige zusammenfassen und wegschicken. */
  const veröffentlichen = (bestmove = null) => {
    const eintraege = [...suche.zeilen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, info]) => eintrag(info));
    if (bestmove && bestmove.strich) {
      // Der beste Zug kommt nach vorn und trägt cp/mate = null: das ist die
      // Bewertung des ZUGES, nicht die der Stellung davor. Die Linie bleibt
      // leer - die pv des besten Zuges ist genau die Zeile darunter, und sie
      // einfach zu kopieren hieße, eine zweite Linie zu erfinden.
      eintraege.unshift({ cp: null, mate: null, uci: bestmove.strich, pgn: '', tiefe: suche.tiefe, upperbound: false });
    }
    meldeInfo({
      tiefe: suche.tiefe,
      knoten: suche.knoten,
      nps: suche.nps,
      sekunden: suche.sekunden,
      bewertung: bewertungText(
        suche.zeilen.get(1)?.cp ?? null,
        suche.zeilen.get(1)?.mate ?? null,
      ),
      besterZug: bestmove?.strich ?? suche.zeilen.get(1)?.uci?.[0] ?? null,
      mehrzeilen: eintraege,
    });
  };

  /** Eine geparste Zeile: entweder sammeln oder als Abschluss melden. */
  const zeileVerarbeiten = (roh) => {
    const zeile = parseUciZeile(roh);
    if (!zeile) return;

    if (zeile.art === 'info') {
      if (typeof zeile.text === 'string') return; // "info string …": Übersetzung
      const index = typeof zeile.mehrzeilenAnzahl === 'number' ? zeile.mehrzeilenAnzahl : 1;
      const gemerkt = suche.zeilen.get(index) ?? {};
      suche.zeilen.set(index, { ...gemerkt, ...zeile, uci: zeile.uci?.length ? zeile.uci : gemerkt.uci ?? [] });
      if (index === 1) {
        if (typeof zeile.tiefe === 'number') suche.tiefe = zeile.tiefe;
        if (typeof zeile.knoten === 'number') suche.knoten = zeile.knoten;
        if (typeof zeile.nps === 'number') suche.nps = zeile.nps;
        if (typeof zeile.sekunden === 'number') suche.sekunden = zeile.sekunden;
      }
      veröffentlichen();
      return;
    }

    if (zeile.art === 'bestmove') {
      laeuft = false;
      bestmoveAufloesen();
      veröffentlichen(zeile);
      suche = neueSuche(); // die nächste Suche fängt frisch an
    }
  };

  // Der Worker spricht reines UCI: eine Zeile hinein, Zeilen heraus.
  const befehl = (text) => worker.postMessage(text);

  // Wartet auf das naechste "readyok". Der Deckel ist wichtig: bleibt die
  // Engine einmal stumm, wartet die Seite nicht ewig und der naechste Zug
  // geht trotzdem.
  let bereitHaken = [];
  const aufBereit = (ms = 3000) =>
    new Promise((fertig) => {
      const zeitgeber = setTimeout(() => fertig(false), ms);
      bereitHaken.push(() => {
        clearTimeout(zeitgeber);
        fertig(true);
      });
    });
  // Warten auf das "bestmove" einer gestoppten Suche. Das ist der Punkt, an
  // dem die Engine garantiert fertig ist - "readyok" allein reicht nicht,
  // weil es noch von einem frueheren "isready" stammen kann, und dann geht
  // "position"+"go" mitten im Abbruch der Suche raus. Genau daran ist der
  // Bausatz zweimal mit "RuntimeError: unreachable executed" gestorben.
  let bestmoveHaken = [];
  const aufBestmove = (ms = 4000) =>
    new Promise((fertig) => {
      const zeitgeber = setTimeout(() => fertig(false), ms);
      bestmoveHaken.push(() => {
        clearTimeout(zeitgeber);
        fertig(true);
      });
    });
  const bestmoveAufloesen = () => {
    const wartende = bestmoveHaken;
    bestmoveHaken = [];
    for (const wartenDer of wartende) wartenDer();
  };

  const bereitAufloesen = () => {
    // Achtung: `for (const haken of haken)` waere ein Fehler - die
    // Schleifenvariable beschaeftigt den Namen schon, bevor sie belegt ist
    // ("can't access lexical declaration before initialization").
    const wartende = bereitHaken;
    bereitHaken = [];
    for (const wartenDer of wartende) wartenDer();
  };

  /** Suche beenden. Eigene Funktion, damit "this" nirgends gebraucht wird. */
  const stoppen = () => {
    if (!bereit || !laeuft) return;
    try {
      // Reiner Text, kein Objekt: der Bausatz ruft .trim() auf dem, was
      // ankommt. Ein Objekt bringst ihn zum Absturz - gemessen, mit
      // "TypeError: e.trim is not a function".
      worker.postMessage('stop');
    } catch (fehler) {
      laeuft = false;
      sagenFehler(beschreiben(fehler));
    }
  };

  // "position startpos moves" ohne ein einziges moves ist KEIN gültiges UCI -
  // die Engine stellt dann keine Stellung ein und "go" rechnet ins Leere.
  const positionBefehl = () => {
    if (position.fen) return `position fen ${position.fen}`;
    if (position.zuege.length > 0) return `position startpos moves ${position.zuege.join(' ')}`;
    return 'position startpos';
  };

  const gestartet = new Promise((fertig, unfertig) => {
    worker.onmessage = (ereignis) => {
      // Eine Nachricht kann mehrere Zeilen enthalten, und eine Zeile kann
      // mit einem Zeilenumbruch enden. Deshalb wird hier geteilt und
      // geschnitten, statt die ganze Nachricht als eine Zeile zu lesen -
      // das war ein Fehler, der die Anzeige einfach leer ließ.
      try {
        for (const roh of String(ereignis.data).split('\n')) {
          const zeile = roh.trim();
          if (!zeile) continue;
          if (zeile === 'uciok') {
            bereit = true;
            fertig(true);
            continue;
          }
          if (zeile === 'readyok') {
            bereitAufloesen();
            if (!bereit) {
              bereit = true;
              fertig(true);
            }
            continue;
          }
          zeileVerarbeiten(zeile);
        }
      } catch (fehler) {
        // Der Handler darf nicht werfen, sonst stirbt der Worker und die
        // Meldung kommt nie mehr an.
        sagenFehler(beschreiben(fehler));
      }
    };
    worker.onerror = (ereignis) => {
      const text = `Worker abgestürzt: ${ereignis.message || 'ohne Meldung'}`;
      const warGeladen = bereit;
      bereit = false;
      laeuft = false;
      sagenFehler(text);
      // Ein Absturz beim Laden muss das Warten beenden; ein Absturz später
      // darf nur melden (das Promise ist längst aufgelöst).
      if (!warGeladen) unfertig(new Error(text));
    };
    worker.onmessageerror = () => sagenFehler('Worker-Nachricht unlesbar');

    melden('lade Engine …');
    befehl('uci');
  });

  try {
    await gestartet;
  } catch (fehler) {
    worker.terminate();
    throw fehler instanceof Error ? fehler : new Error(String(fehler));
  }

  melden('Handshake (uci/isready) …');
  // Die Reihenfolge ist die, die die Engine erwartet: erst uci, dann die
  // Optionen, dann isready - und erst danach darf gerechnet werden.
  befehl('ucinewgame');
  befehl(`setoption name Threads value ${threads}`);
  befehl(`setoption name MultiPV value ${mehrzeilen}`);
  befehl('isready');

  return {
    version: version.id ?? null,

    /**
     * Suche starten. Läuft schon eine, wird sie vorher wirklich beendet -
     * zwei "go" hintereinander ohne "stop" machen die Engine unbrauchbar.
     *
     * @param {{fen?: string, tiefe?: number, maxZeitMs?: number, mehrzeilen?: number,
     *          threads?: number}} auftrag
     */
    async analysieren({ fen, tiefe = 18, maxZeitMs, mehrzeilen: mz, threads: th } = {}) {
      if (typeof fen === 'string') position = { fen, zuege: [] };
      if (typeof th === 'number' && th > 0) threads = Math.floor(th);
      if (typeof mz === 'number' && mz > 0) mehrzeilen = Math.floor(mz);

      // "ucinewgame" steht NICHT hier, sondern nur im Handshake: es leert die
      // Hash-Tabelle, und die soll über die Züge einer Partie stehen bleiben.
      //
      // Hier wird auf das Ende einer laufenden Suche GEWARTET. "stop",
      // "position" und "go" hintereinander zu schicken ist zwar kurzer UCI,
      // aber der Bausatz stirbt daran: gemessen "RuntimeError: unreachable
      // executed" beim zweiten Zug, und die Engine antwortet danach nie
      // wieder. Nach dem "stop" gehört ein "isready" hin, und weiter geht es
      // erst nach dem "readyok".
      if (laeuft) {
        const fertig = aufBestmove();
        befehl('stop');
        await fertig;
      }
      laeuft = false;
      suche = neueSuche();

      if (threads !== gesetzteThreads) {
        befehl(`setoption name Threads value ${threads}`);
        gesetzteThreads = threads;
      }
      if (mehrzeilen !== gesetzteMehrzeilen) {
        befehl(`setoption name MultiPV value ${mehrzeilen}`);
        gesetzteMehrzeilen = mehrzeilen;
      }
      const start = aufBereit();
      befehl('isready');
      await start;
      befehl(positionBefehl());

      // Tiefe und Zeit schliessen sich aus: mit maxZeitMs gewinnt die Uhr.
      if (typeof maxZeitMs === 'number' && maxZeitMs > 0) befehl(`go movetime ${Math.floor(maxZeitMs)}`);
      else if (typeof tiefe === 'number' && tiefe > 0) befehl(`go depth ${Math.floor(tiefe)}`);
      else befehl('go depth 1');
      laeuft = true;
    },

    /** Suche beenden. Danach steht der Baum auf der gesetzten Stellung. */
    stoppen,

    /** True, wenn die Engine geladen ist und noch offen ist. */
    istBereit() {
      return bereit && !schliessen;
    },

    /** True, während gerechnet wird (zwischen "go" und "bestmove"). */
    rechnet() {
      return laeuft;
    },

    /** Engine entladen. Danach ist das Objekt unbrauchbar. */
    schliessen() {
      if (schliessen) return;
      schliessen = true;
      bereit = false;
      try {
        worker.postMessage('quit');
      } catch {
        /* der Worker ist dann schon weg - genau das war das Ziel */
      }
      setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
      }, 0);
    },

    /**
     * Rückruf bei jeder Infozeile.
     * @param {(n: {tiefe: number, knoten: number, nps: number, sekunden: number,
     *   bewertung: string, besterZug: string|null,
     *   mehrzeilen: {cp: number|null, mate: number|null, uci: string|null,
     *   pgn: string}[]}) => void} funktion
     */
    aufInfo(funktion) {
      infoHaken = typeof funktion === 'function' ? funktion : () => {};
    },

    /** Rückruf, wenn der Worker stirbt oder die Engine sich beschwert. */
    aufFehler(funktion) {
      fehlerHaken = typeof funktion === 'function' ? funktion : () => {};
    },

    /**
     * Ein Spielzug für die laufende Partie. Setzt die Stellung für den nächsten
     * Zug - es wird aber NICHT gerechnet. Wann gerechnet wird, entscheidet
     * die Seite über analysieren().
     * @param {string} spielZug algebraisch, z.B. "e2e4"
     */
    zugfuege(spielZug) {
      if (typeof spielZug !== 'string' || !/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(spielZug)) {
        return false;
      }
      // Eine laufende Suche gilt der alten Stellung, nicht der neuen.
      stoppen();
      position.fen = null; // ab hier gilt die Partie, nicht mehr eine einzelne FEN
      position.zuege.push(spielZug);
      if (bereit) befehl(positionBefehl()); // Stellung setzen, aber NICHT rechnen
      suche = neueSuche();
      laeuft = false;
      return true;
    },

    /** Für Tests und Anzeige: die aktuelle Position als UCI-Befehl. */
    aktuellePosition() {
      return positionBefehl();
    },
  };
}