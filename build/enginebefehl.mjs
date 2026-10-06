/**
 * UCI-Zeilen lesen, ohne Engine, ohne Browser, ohne fremde Bibliothek.
 *
 * Stockfish schickt eine Zeile nach der anderen als Text. Jede Zeile ist
 * Schlüssel-Wert-Paare: "info depth 18 score cp 34 nodes 1234 pv e2e4 e7e5".
 * Die Reihenfolge ist nicht garantiert, unbekannte Schlüssel kommen dazu, und
 * lila schickt mit "info string ..." eigene Übersetzungen. Deshalb wird nicht
 * mit festen Spalten gearbeitet, sondern die Zeile wird Token für Token
 * gelesen: jeder Schlüssel holt sich, was er braucht.
 *
 * Zwei Fallen, die hier ausdrücklich abgesichert sind:
 *
 *   - "pv" und "currline" ziehen normalerweise den REST der Zeile an sich.
 *     Steht danach noch ein Feld, darf es nicht verschluckt werden - deshalb
 *     wird nur so weit gegessen, wie es eindeutig Züge sind (siehe
 *     zuegeEssen). Ebenso bei "score" ohne cp/mate.
 *   - Zahlen stehen nicht an festen Stellen. Genau das ist der Grund, warum
 *     hier nie über Positionen auf Zahlen zugegriffen wird.
 *
 * Diese Datei darf NICHT werfen. Eine kaputte Zeile ergibt null, nicht eine
 * Ausnahme: sie kommt aus einem fremden Prozess, und der Aufrufer darf nicht
 * dafür geradestehen, dass er darauf nicht vorbereitet war.
 *
 * Ohne Build-Schritt benutzbar: node -e "import('./build/enginebefehl.mjs')…"
 */

/** Ganzzahl mit Vorzeichen. Leerzeichen sind vorher schon weg. */
const ZAHL = /^[+-]?\d+$/;

/** Ein algebraischer Zug: zwei Felder, optional Promotion, optional/null. */
const ZUG = /^[a-h][1-8][a-h][1-8][nbrq]?$/;

/** Wie viele Züge "pv" oder "currline" höchstens schlucken. */
const MAX_ZUEGE = 256;

function istZahl(text) {
  return typeof text === 'string' && ZAHL.test(text);
}

/**
 * Eine Zeile UCI-Ausgabe lesen.
 *
 * @param {string} zeile eine Zeile ohne Zeilenumbruch, beliebig unscharf
 * @returns {null | {
 *   art: 'info'|'bestmove'|'readyok'|'uciok'|'id',
 *   und?: string, wert?: string,             // bei art 'id'
 *   text?: string,                          // bei art 'info' + "string"
 *   tiefe?: number, seltiefe?: number, mehrzeilenAnzahl?: number,
 *   cp?: number|null, mate?: number|null, knoten?: number, nps?: number,
 *   sekunden?: number, hashfull?: number, tbhits?: number,
 *   upperbound?: boolean, lowerbound?: boolean,
 *   currmove?: string, currmovenumber?: number, uci?: string[],
 *   wdl?: number[], strich?: string,                                          // bei art 'bestmove'
 * }}
 */
export function parseUciZeile(zeile) {
  try {
    if (typeof zeile !== 'string') return null;
    const tokens = zeile.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const art = tokens[0];

    // ---- Die kurzen, anspruchslosen Antworten --------------------------------
    if (art === 'readyok') return { art: 'readyok' };
    if (art === 'uciok') return { art: 'uciok' };
    if (art === 'id') {
      // "id name Stockfish 19" - der Name kann selbst Leerzeichen haben.
      const rest = tokens.slice(2);
      if (tokens[1] !== 'name' && tokens[1] !== 'author') return null;
      if (rest.length === 0) return null;
      return { art: 'id', und: tokens[1], wert: rest.join(' ') };
    }
    if (art === 'bestmove') {
      // "bestmove e7e5 ponder e2e4" oder "bestmove (none)"
      const strich = tokens[1];
      if (typeof strich !== 'string') return null;
      const out = { art: 'bestmove', strich: strich === '(none)' ? null : strich };
      if (tokens[2] === 'ponder') {
        // "(none)" als Antwort ist dasselbe wie gar keine Antwort.
        const gedacht = tokens[3];
        out.ponder = gedacht && gedacht !== '(none)' ? gedacht : null;
      }
      return out;
    }
    if (art !== 'info') return null; // option…, "Neuer Zug", Müll, leere Zeile

    // ---- info ----------------------------------------------------------------
    // cp und mate sind immer beide da, aber genau eines ist eine Zahl. Das ist
    // die Representation, die die Anzeige braucht: "nur eine Zahl, kein undefined".
    const out = {
      art: 'info',
      cp: null,
      mate: null,
      uci: [],
    };

    for (let i = 1; i < tokens.length; i++) {
      const key = tokens[i];

      switch (key) {
        case 'depth':
        case 'seldepth':
        case 'multipv':
        case 'nodes':
        case 'nps':
        case 'time':
        case 'hashfull':
        case 'tbhits':
        case 'sbhits':
        case 'cpelo':
        case 'currmovenumber': {
          const wert = tokens[i + 1];
          if (!istZahl(wert)) break; // Schlüssel ohne Zahl: ignorieren, nicht raten
          const zahl = Number(wert);
          if (key === 'depth') out.tiefe = zahl;
          else if (key === 'seldepth') out.seltiefe = zahl;
          else if (key === 'multipv') out.mehrzeilenAnzahl = zahl;
          else if (key === 'nodes') out.knoten = zahl;
          else if (key === 'nps') out.nps = zahl;
          // Achtung Namensfalle: das UCI-Feld heisst "time" und ist in
          // MILLISEKUNDEN. Der Feldname "sekunden" ist fest verdrahtet
          // (Anzeige und Aufrufer lesen ihn), der Wert ist aber "2500" fuer
          // zweieinhalb Sekunden. Hier wird nichts umgerechnet.
          else if (key === 'time') out.sekunden = zahl;
          else if (key === 'hashfull') out.hashfull = zahl;
          else if (key === 'tbhits') out.tbhits = zahl;
          else if (key === 'sbhits') out.sbhits = zahl;
          else if (key === 'cpelo') out.cpelo = zahl;
          else out.currmovenumber = zahl;
          i++;
          break;
        }

        case 'score': {
          // "score cp 34", "score mate -3", "score cp 5 upperbound",
          // "score mate 12 lowerbound". cp und mate sind Alternativen.
          const art2 = tokens[i + 1];
          const wert = tokens[i + 2];
          if ((art2 === 'cp' || art2 === 'mate') && istZahl(wert)) {
            if (art2 === 'cp') out.cp = Number(wert);
            else out.mate = Number(wert);
            i += 2;
          } else {
            // "score unknown" o.Ä.: nichts fressen. Frisst man hier ein Token,
            // verschwindet bei "info score pv e2e4" das ganze pv.
          }
          // Die Grenze darf direkt danach stehen.
          if (tokens[i + 1] === 'upperbound') {
            out.upperbound = true;
            i++;
          } else if (tokens[i + 1] === 'lowerbound') {
            out.lowerbound = true;
            i++;
          }
          break;
        }

        case 'wdl': {
          // "wdl w 300 d 600 l 100" und "wdl 300 600 100" kommen beide vor.
          const zs = [];
          let j = i + 1;
          while (j < tokens.length && zs.length < 3) {
            if (istZahl(tokens[j])) zs.push(Number(tokens[j++]));
            else if (/^[wdl]$/.test(tokens[j])) j++; // Buchstaben überspringen
            else break;
          }
          if (zs.length > 0) out.wdl = zs;
          i = j - 1;
          break;
        }

        case 'currmove': {
          if (ZUG.test(tokens[i + 1] ?? '')) {
            out.currmove = tokens[i + 1];
            i++;
          }
          break;
        }

        case 'string': {
          // lila schickt hier Übersetzungen. Kein Feld, keine Zahl - nur Text.
          out.text = tokens.slice(i + 1).join(' ');
          i = tokens.length;
          break;
        }

        case 'currline': {
          // Züge bis zum nächsten bekannten Feld, siehe unten.
          i = zuegeEssen(tokens, i, out, 'uci');
          break;
        }

        case 'pv': {
          i = zuegeEssen(tokens, i, out, 'uci');
          break;
        }

        // "refutation …" und "cpulovelier …" nennen die Züge eines einzelnen
        // Suchastes. Für die Anzeige nutzlos - aber sie dürfen die Felder
        // dahinter nicht verschlucken.
        case 'refutation':
        case 'cpulovelier':
        case 'recpf':
          i = zuegeEssen(tokens, i, null, null);
          break;

        default:
          // Unbekannter Schlüssel: ein Token weiter. Ein Schlüssel, der kein
          // Schlüssel ist (z.B. ein Zahlenteil im Wert eines unbekannten Feldes),
          // rutscht so mit durch, ohne dass etwas verrutscht wird.
          break;
      }
    }

    return out;
  } catch {
    // Darf nicht passieren - und wenn doch, darf es nicht nach außen dringen.
    return null;
  }
}

/**
 * Die Zugkette ab Position i essen und den Index des letzten genommenen
 * Tokens liefern, damit die Schleife dort weitermacht.
 *
 * "pv" zieht im Normalfall den Rest der Zeile an sich. Manche Engines (und
 * lila mit seinen eingestreuten Zeilen) haben danach aber noch Felder stehen -
 * die gehen verloren, wenn man blind alles bis zum Zeilenende frisst. Deshalb
 * wird nur so weit gegessen, wie es eindeutig Züge sind, und danach
 * weitergemacht. Ein Zug sieht nie wie ein Feld aus ("e2e4" ist kein
 * "depth"), deshalb ist die Grenze scharf.
 */
function zuegeEssen(tokens, i, out, feld) {
  const zuege = [];
  let j = i + 1;
  while (j < tokens.length && zuege.length < MAX_ZUEGE && ZUG.test(tokens[j])) {
    zuege.push(tokens[j]);
    j++;
  }
  if (out && feld && zuege.length > 0) out[feld] = zuege;
  // Steht danach noch etwas anderes, ist die Kette zu Ende und die Schleife
  // setzt dort fort: darum j-1 (die for-Schleife zählt selbst eins hoch).
  return j - 1;
}