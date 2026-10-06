/**
 * Eröffnungsdatenbank von lichess: anmelden, fragen, Antwort deuten, merken.
 *
 * Die Endpunkte liegen auf explorer.lichess.org - nicht auf lichess.org. Aus der
 * OpenAPI-Datei (doc/specs/lichess-api.yaml, Abschnitt "Opening Explorer",
 * dort doc/specs/tags/openingexplorer/*.yaml) gibt es genau diese Wege:
 *
 *   GET https://explorer.lichess.org/masters            Masters-Partien
 *   GET https://explorer.lichess.org/lichess             Partien aller Spieler
 *   GET https://explorer.lichess.org/lichess/history     Verlauf nach Monat
 *   GET https://explorer.lichess.org/player              Spielerpartien (NDJSON)
 *   GET https://explorer.lichess.org/masters/pgn/{id}    PGN einer Partie
 *
 * Ohne Anmeldung antworten die ersten vier Wege mit HTTP 401 (gemessen, nicht
 * vermutet - siehe build/explorertest.mjs --live). Es gibt kein Client-Secret:
 * die Doku (doc/specs/tags/oauth/oauth.yaml) verlangt Authorization Code mit
 * PKCE, also code_challenge_method=S256 und ohne Geheimnis. Das Token gehört
 * in den localStorage des Geräts, mit Ablaufdatum - nie in eine URL, nie in
 * ein Log.
 *
 * Zwei Dinge, die die Screenshots zeigen und die Doku nicht liefert:
 *
 *  - "CORR", "2024+" und "TT" sind KEINE eigenen Endpunkte. /corr, /elite,
 *    /tt und /openings antworten mit 404 (gemessen). Es sind Filter auf
 *    /lichess: Tempo, Zeitraum, Ratinggruppe. Elite ist /masters.
 *  - "Opening names" ist auch kein Endpunkt, sondern das Feld `opening`
 *    ({eco, name}) in JEDER Antwort. Es füllt sich nur, wenn `fen` nicht
 *    genau eine benannte Stellung ist - dann braucht es zusätzlich `play`.
 *
 * Mehrere Quellen in einem Aufruf: die Doku erlaubt das nicht. Es gibt je
 * Endpunkt genau eine Datenbank, und /lichess/history ist ein eigener Weg.
 * `abfrageUebertragbar` ist deshalb ein Parallellauf über mehrere
 * Einzelabfragen, kein kombinierter Serveraufruf.
 *
 * Abhängigkeiten: keine. Importierbar in node - dort meldet das Modul
 * "nicht angemeldet" bzw. "kein Fenster", statt zu werfen.
 */

const WIRKUNG = 'https://explorer.lichess.org';
const AUTORISIERUNG = 'https://lichess.org/oauth';
const TOKEN_ULR = 'https://lichess.org/api/token';
const KONTO_ULR = 'https://lichess.org/api/account';

/** OpenAPI nennt für alle drei Quellen `source`; `analysis` ist der Normalfall. */
const QUELLE = 'analysis';

export const SPEICHER = {
  token: 'lpf.explorer.token.v1',
  offen: 'lpf.explorer.pkce.v1',
  cache: 'lpf.explorer.cache.v1.',
};

/**
 * Die Reiter, in der Reihenfolge der Screenshots. `weg` ist der echte
 * Endpunkt, `filter` die Doku-Parameter, die diesen Reiter ausmachen.
 * Für `spieler` (Tab "TT") muss der Aufrufer `spieler` und `farbe` setzen.
 */
export const QUELLEN = [
  { id: 'elite', name: 'Elite', weg: '/masters', filter: {}, hinweis: 'Masters-Partien' },
  { id: 'corr', name: 'CORR', weg: '/lichess', filter: { speeds: 'correspondence' }, hinweis: 'nur Korrespondenz' },
  { id: 'neujahr', name: '2024+', weg: '/lichess', filter: { since: '2024-01' }, hinweis: 'ab Januar 2024' },
  { id: 'tt', name: 'TT', weg: '/lichess', filter: { ratings: '2200,2500' }, hinweis: 'Titelträger' },
  { id: 'lichess', name: 'Lichess', weg: '/lichess', filter: {}, hinweis: 'alle gewerteten Partien' },
  { id: 'spieler', name: 'Spielerdatenbank', weg: '/player', filter: {}, hinweis: 'ein Spieler, braucht Name und Farbe' },
];

export const STANDARD_ANZAHL = 12;

/** Fehler mit maschinenlesbarem Code, damit die Seite einen Knopf anbieten kann. */
export class ExplorerFehler extends Error {
  constructor(code, text) {
    super(text);
    this.name = 'ExplorerFehler';
    this.code = code;
  }
}

const speicher = () => {
  try {
    const s = globalThis.window?.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
};

const lesen = (key) => {
  const s = speicher();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

const schreiben = (key, wert) => {
  const s = speicher();
  if (!s) return false;
  try {
    s.setItem(key, wert);
    return true;
  } catch {
    return false;
  }
};

const loeschen = (key) => {
  const s = speicher();
  if (!s) return false;
  try {
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

const hatFenster = () => typeof globalThis.window === 'object' && globalThis.window !== null;

/** Zufall ohne Krypto ist hier sinnlos - dann lieber ein klarer Fehler. */
const zufall = (n) => {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new ExplorerFehler('keinKrypto', 'Dieser Browser liefert keinen sicheren Zufall - Anmeldung nicht möglich.');
  }
  const puffer = new Uint8Array(n);
  c.getRandomValues(puffer);
  return puffer;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** base64url ohne btoa/Buffer: der einzige Weg, der überall gleich ist. */
function base64url(bytes) {
  let rest = 0;
  let bits = 0;
  let aus = '';
  for (const b of bytes) {
    rest = (rest << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      aus += ALPHABET[(rest >> bits) & 63];
    }
  }
  if (bits > 0) aus += ALPHABET[(rest << (6 - bits)) & 63];
  return aus;
}

function zufallstext(n) {
  const bytes = zufall(n);
  let aus = '';
  for (const b of bytes) aus += ALPHABET[b % ALPHABET.length];
  return aus;
}

/** BASE64URL(SHA256(code_verifier)) - so verlangt es die Doku. */
export async function codeChallenge(verifier) {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new ExplorerFehler('keinKrypto', 'Dieser Browser kann keinen SHA-256 - Anmeldung nicht möglich.');
  }
  const bits = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(bits));
}

/**
 * Baut die Autorisierungs-URL. Bewusst frei von window.location: der
 * Aufrufer gibt redirect_uri und client_id vor, dadurch ist die Funktion
 * ohne Browser testbar. Es gibt kein client_secret und gibt keins.
 */
export function baueAutorisierungsUrl({ clientId, weiterleitung, challenge, zustand, scope, nutzername }) {
  if (!clientId) throw new ExplorerFehler('keineClientId', 'client_id fehlt - die Doku verlangt ihn.');
  if (!weiterleitung) throw new ExplorerFehler('keineWeiterleitung', 'redirect_uri fehlt - die Doku verlangt ihn.');
  if (!challenge) throw new ExplorerFehler('keinChallenge', 'code_challenge fehlt - ohne PKCE gibt es kein Token.');
  const u = new URL(AUTORISIERUNG);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', weiterleitung);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', challenge);
  if (zustand) u.searchParams.set('state', zustand);
  if (scope) u.searchParams.set('scope', Array.isArray(scope) ? scope.join(' ') : String(scope));
  if (nutzername) u.searchParams.set('username', nutzername);
  return u.href;
}

function tokenLesen() {
  const roh = lesen(SPEICHER.token);
  if (!roh) return null;
  let wert;
  try {
    wert = JSON.parse(roh);
  } catch {
    loeschen(SPEICHER.token);
    return null;
  }
  if (!wert || typeof wert.token !== 'string' || !wert.token) {
    loeschen(SPEICHER.token);
    return null;
  }
  // Abgelaufen heißt abgemeldet. Der Token wird auch dann entfernt, damit
  // die Seite keinen Knopf "erneut einloggen" anbietet, der nichts brächte.
  if (typeof wert.laeuftAbAm !== 'number' || !Number.isFinite(wert.laeuftAbAm) || wert.laeuftAbAm <= Date.now()) {
    loeschen(SPEICHER.token);
    return null;
  }
  return wert;
}

export function istAngemeldet() {
  return tokenLesen() !== null;
}

/**
 * { angemeldet, laeuftAbAm, nutzername? }
 * laeuftAbAm ist ein Zeitstempel in Millisekunden, oder null.
 * Der Inhalt des Tokens wird niemals zurückgegeben.
 */
export function tokenStatus() {
  const wert = tokenLesen();
  if (!wert) return { angemeldet: false, laeuftAbAm: null };
  return {
    angemeldet: true,
    laeuftAbAm: wert.laeuftAbAm,
    nutzername: typeof wert.nutzername === 'string' ? wert.nutzername : undefined,
  };
}

export function abmelden() {
  loeschen(SPEICHER.token);
  loeschen(SPEICHER.offen);
}

/**
 * Startet den OAuth-Fluss. Erzeugt code_verifier und state, legt sie für den
 * Rückweg ab und gibt die URL zurück. Der Rückweg ist bewusst getrennt:
 * `anmeldenFortsetzen()` liest code und state aus window.location.
 */
export async function anmelden({ scope, weiterleitung, clientId, nutzername, fenster = true } = {}) {
  if (!hatFenster()) {
    throw new ExplorerFehler('keinFenster', 'Anmeldung braucht ein Browser-Fenster - in node nicht möglich.');
  }
  const w = globalThis.window;
  const ziel = weiterleitung || `${w.location.origin}${w.location.pathname}`;
  const id = clientId || w.location.hostname || 'lpf.explorer';
  const verifier = zufallstext(64);
  const zustand = zufallstext(24);
  const challenge = await codeChallenge(verifier);
  const url = baueAutorisierungsUrl({ clientId: id, weiterleitung: ziel, challenge, zustand, scope, nutzername });
  schreiben(SPEICHER.offen, JSON.stringify({ verifier, zustand, weiterleitung: ziel, clientId: id, zeit: Date.now() }));
  if (fenster && typeof w.open === 'function') {
    const fensterchen = w.open(url, '_blank');
    if (fensterchen) return { url, fenster: 'popup', zustand };
  }
  w.location.assign(url);
  return { url, fenster: 'redirect', zustand };
}

/**
 * Zweite Hälfte des Flusses, aufgerufen beim Laden der Seite, wenn
 * ?code=...&state=... in der Adresse steht. Prüft zuerst das state - sonst
 * wäre jeder Aufrufer dieser Seite ein Angreifer auf den eigenen Account.
 */
export async function anmeldenFortsetzen({ suche } = {}) {
  const s = speicher();
  if (!s) throw new ExplorerFehler('keinSpeicher', 'Ohne localStorage geht die Anmeldung nicht.');
  const roh = s.getItem(SPEICHER.offen);
  const jetzt = suche || new URLSearchParams(globalThis.window?.location?.search || '');
  const fehler = jetzt.get('error');
  const code = jetzt.get('code');
  const zustand = jetzt.get('state');
  if (fehler) {
    loeschen(SPEICHER.offen);
    if (hatFenster() && typeof globalThis.window.history?.replaceState === 'function') {
      globalThis.window.history.replaceState({}, '', globalThis.window.location.pathname);
    }
    throw new ExplorerFehler('abgelehnt', `Anmeldung abgelehnt: ${fehler}`);
  }
  if (!code) return { angemeldet: false, grund: 'kein Code in der Adresse' };
  if (!roh) throw new ExplorerFehler('keinFluss', 'Es liegt kein angefangener Anmeldefluss vor - bitte neu einloggen.');
  let offen;
  try {
    offen = JSON.parse(roh);
  } catch {
    loeschen(SPEICHER.offen);
    throw new ExplorerFehler('keinFluss', 'Der Anmeldefluss ist unlesbar - bitte neu einloggen.');
  }
  if (!zustand || zustand !== offen.zustand) {
    loeschen(SPEICHER.offen);
    throw new ExplorerFehler('falschesState', 'Das state passt nicht - Anmeldung verworfen, bitte erneut einloggen.');
  }
  const c = globalThis.crypto;
  if (!c?.subtle) throw new ExplorerFehler('keinKrypto', 'Dieser Browser kann keinen SHA-256 - Anmeldung nicht möglich.');

  const antwort = await fetch(TOKEN_ULR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: offen.verifier,
      redirect_uri: offen.weiterleitung,
      client_id: offen.clientId,
    }).toString(),
  });
  const text = await antwort.text();
  if (!antwort.ok) {
    // Die Antwort nennt eventuell das Geheimnis des Nutzers - sie bleibt hier.
    throw new ExplorerFehler('keinToken', `Kein Token erhalten (HTTP ${antwort.status}).`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ExplorerFehler('keinToken', 'Die Token-Antwort war kein JSON.');
  }
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new ExplorerFehler('keinToken', 'Die Token-Antwort enthielt kein access_token.');
  }
  const sekunden = Number(json.expires_in);
  const wert = {
    token: json.access_token,
    laeuftAbAm: Date.now() + (Number.isFinite(sekunden) && sekunden > 0 ? sekunden * 1000 : 3600_000),
    typ: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
  wert.nutzername = await frageNutzername(wert.token);
  schreiben(SPEICHER.token, JSON.stringify(wert));
  loeschen(SPEICHER.offen);
  if (hatFenster() && typeof globalThis.window.history?.replaceState === 'function') {
    globalThis.window.history.replaceState({}, '', globalThis.window.location.pathname);
  }
  return { angemeldet: true, laeuftAbAm: wert.laeuftAbAm, nutzername: wert.nutzername };
}

/** GET /api/account laut Doku: öffentliche Angaben zum angemeldeten Konto. */
async function frageNutzername(token) {
  try {
    const antwort = await fetch(KONTO_ULR, { headers: { Authorization: `Bearer ${token}` } });
    if (!antwort.ok) return undefined;
    const json = await antwort.json();
    return typeof json.username === 'string' ? json.username : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Nur die ersten vier FEN-Felder zählen: Brett, Farbe, Rochade, en passant.
 * Halbzug- und Vollzugszähler ändern die Stellung nicht, dürfen den
 * Zwischenspeicher aber auch nicht verfehlen - darum werden sie hier abgeschnitten.
 */
export function normiereFen(fen) {
  const text = typeof fen === 'string' ? fen.trim() : '';
  if (!text) return '';
  const felder = text.split(/\s+/);
  return felder.slice(0, 4).join(' ').toLowerCase();
}

/** Schlüssel aus Quelle + FEN + Zugfolge (+ gewünschter Zugzahl). */
export function cacheSchluessel(fen, quelle, zuege, anzahl = STANDARD_ANZAHL) {
  const zuegeText = (Array.isArray(zuege) ? zuege : String(zuege || '').split(','))
    .map((z) => String(z).trim().toLowerCase())
    .filter(Boolean)
    .join(',');
  const anzahlText = Number.isFinite(anzahl) ? String(anzahl) : String(STANDARD_ANZAHL);
  return `${quelle}|${anzahlText}|${normiereFen(fen)}|${zuegeText}`;
}

/** bis: absolute Zeit in ms (Date.now()-System). Ohne "bis" bleibt es unbegrenzt. */
export function zwischenspeichern(key, wert, bis) {
  const s = speicher();
  if (!s) return false;
  try {
    const gesetzt = Number.isFinite(bis) ? bis : null;
    s.setItem(SPEICHER.cache + key, JSON.stringify({ wert, ab: Date.now(), bis: gesetzt }));
    return true;
  } catch {
    return false;
  }
}

/** null bei fehlend, zu alt oder abgelaufen - im Zweifel lieber neu fragen. */
export function ausZwischenspeicher(key, maxAlterMs = Infinity) {
  const s = speicher();
  if (!s) return null;
  let roh;
  try {
    roh = s.getItem(SPEICHER.cache + key);
  } catch {
    return null;
  }
  if (!roh) return null;
  let wert;
  try {
    wert = JSON.parse(roh);
  } catch {
    loeschen(SPEICHER.cache + key);
    return null;
  }
  if (!wert || typeof wert.ab !== 'number' || !Number.isFinite(wert.ab)) {
    loeschen(SPEICHER.cache + key);
    return null;
  }
  const jetzt = Date.now();
  // maxAlterMs <= 0 heißt "nichts ist frisch genug" - auch nicht das, was
  // gerade eben geschrieben wurde.
  if (Number.isFinite(maxAlterMs) && (maxAlterMs <= 0 || jetzt - wert.ab > maxAlterMs)) {
    loeschen(SPEICHER.cache + key);
    return null;
  }
  if (Number.isFinite(wert.bis) && wert.bis <= jetzt) {
    loeschen(SPEICHER.cache + key);
    return null;
  }
  return wert.wert;
}

export function zwischenspeicherLeeren() {
  const s = speicher();
  if (!s) return 0;
  let n = 0;
  try {
    const raeume = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(SPEICHER.cache)) raeume.push(k);
    }
    for (const k of raeume) {
      s.removeItem(k);
      n += 1;
    }
  } catch {
    return n;
  }
  return n;
}

const laufende = new Set();

/** Bricht alle laufenden Abfragen ab und räumt die Liste auf. */
export function abbrechen() {
  const n = laufende.size;
  for (const c of laufende) {
    try {
      c.abort();
    } catch {
      /* schon beendet */
    }
  }
  laufende.clear();
  return n;
}

// Achtung: Number(null) ist 0 und Number('') ist 0. Beides ist kein Messwert,
// sondern ein fehlendes Feld - deshalb wird vorher weggefiltert.
const zahlOderNull = (w) => {
  if (typeof w === 'number') return Number.isFinite(w) ? w : null;
  if (typeof w !== 'string') return null;
  const text = w.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

const textOderNull = (w) => (typeof w === 'string' && w.length > 0 ? w : null);

function deuteSpiel(roh) {
  if (!roh || typeof roh !== 'object') return null;
  const seite = (s) => {
    if (!s || typeof s !== 'object') return null;
    return { name: textOderNull(s.name), rating: zahlOderNull(s.rating) };
  };
  const jahr = zahlOderNull(roh.year);
  return {
    id: textOderNull(roh.id),
    gewinner: ['white', 'black', 'draw'].includes(roh.winner) ? roh.winner : null,
    tempo: textOderNull(roh.speed),
    modus: ['rated', 'casual'].includes(roh.mode) ? roh.mode : null,
    weiss: seite(roh.white),
    schwarz: seite(roh.black),
    jahr,
    monat: textOderNull(roh.month),
  };
}

/** `game` laut Doku, `games` taucht in Antworten ebenfalls auf - beides nehmen wir. */
function deuteSpiele(roh) {
  if (!roh) return [];
  const rohListe = Array.isArray(roh) ? roh : [roh];
  const aus = [];
  for (const eintrag of rohListe) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    const spiel = deuteSpiel(eintrag);
    if (spiel) aus.push({ uci: textOderNull(eintrag.uci), ...spiel });
  }
  return aus;
}

function deuteOeffnung(roh) {
  if (!roh || typeof roh !== 'object') return null;
  const eco = textOderNull(roh.eco);
  const name = textOderNull(roh.name);
  if (!eco && !name) return null;
  return { eco, name };
}

/**
 * Die reine Deutung - ohne Netz, ohne localStorage, ohne Fenster.
 * Wirft nie: fehlende Felder werden null ("unbekannt"), unbekannte Felder
 * werden verworfen. `moves`, das kein Array ist, gilt als leere Zugliste.
 */
export function parserAntwort(json) {
  const leer = {
    gueltig: false,
    gesamt: { weiss: null, remis: null, schwarz: null },
    opening: null,
    zuege: [],
    topSpiele: [],
    letzteSpiele: [],
    verlauf: [],
    wartende: null,
    unbekannt: [],
  };
  let roh = json;
  if (typeof roh === 'string') {
    const zeilen = roh
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean);
    for (let i = zeilen.length - 1; i >= 0; i -= 1) {
      try {
        roh = JSON.parse(zeilen[i]);
        break;
      } catch {
        roh = undefined;
      }
    }
  }
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return leer;
  // Nicht kopieren: das Spread würde jeden Getter auslösen, und ein Getter, der
  // wirft, darf die ganze Deutung nicht umwerfen.
  const feld = (name) => {
    try {
      return roh[name];
    } catch {
      return undefined;
    }
  };
  const rohGesamt = { white: feld('white'), draws: feld('draws'), black: feld('black') };
  const rohMoves = feld('moves');
  const rohTop = feld('topGames');
  const rohRecent = feld('recentGames');
  const rohHistory = feld('history');
  const rohOpening = feld('opening');
  const rohQueue = feld('queuePosition');
  let rohSchluessel = [];
  try {
    rohSchluessel = Object.keys(roh);
  } catch {
    rohSchluessel = [];
  }

  const gesamt = {
    weiss: zahlOderNull(rohGesamt.white),
    remis: zahlOderNull(rohGesamt.draws),
    schwarz: zahlOderNull(rohGesamt.black),
  };
  const summe =
    gesamt.weiss !== null && gesamt.remis !== null && gesamt.schwarz !== null
      ? gesamt.weiss + gesamt.remis + gesamt.schwarz
      : null;

  const rohZuege = Array.isArray(rohMoves) ? rohMoves : [];
  const zuege = [];
  for (const m of rohZuege) {
    if (!m || typeof m !== 'object') continue;
    const weiss = zahlOderNull(m.white);
    const remis = zahlOderNull(m.draws);
    const schwarz = zahlOderNull(m.black);
    const summeZug = weiss !== null && remis !== null && schwarz !== null ? weiss + remis + schwarz : null;
    // Die Doku kennt zwei Namen: averageRating (masters/lichess) und
    // averageOpponentRating plus performance (player).
    const wertung = zahlOderNull(m.averageOpponentRating ?? m.averageRating ?? m.avg);
    zuege.push({
      uci: textOderNull(m.uci),
      san: textOderNull(m.san),
      weiss,
      remis,
      schwarz,
      spiele: summeZug,
      anteil: summeZug && summeZug > 0 ? (weiss ?? 0) / summeZug : null,
      mittlereWertung: wertung,
      leistung: zahlOderNull(m.performance),
      // Spiele: singular in der Doku, plural in der Praxis.
      partien: deuteSpiele(m.game ?? m.games),
      opening: deuteOeffnung(m.opening),
    });
  }

  const verlauf = Array.isArray(rohHistory)
    ? rohHistory
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          monat: textOderNull(e.month),
          weiss: zahlOderNull(e.white),
          remis: zahlOderNull(e.draws),
          schwarz: zahlOderNull(e.black),
        }))
    : [];

  const bekannt = new Set([
    'white',
    'draws',
    'black',
    'moves',
    'topGames',
    'recentGames',
    'history',
    'opening',
    'queuePosition',
  ]);
  return {
    gueltig: true,
    gesamt: { ...gesamt, spiele: summe },
    opening: deuteOeffnung(rohOpening),
    zuege,
    topSpiele: deuteSpiele(rohTop),
    letzteSpiele: deuteSpiele(rohRecent),
    verlauf,
    wartende: zahlOderNull(rohQueue),
    unbekannt: rohSchluessel.filter((k) => !bekannt.has(k)),
  };
}

function quelleOderFehler(id) {
  const gefunden = QUELLEN.find((q) => q.id === id);
  if (!gefunden) {
    throw new ExplorerFehler('unbekannteQuelle', `Unbekannte Quelle "${id}".`);
  }
  return gefunden;
}

/** Ausgeschriebene URL - ohne Token, damit sie im Test gelesen werden darf. */
export function baueAbfrageUrl(quelle, fen, zuege, anzahl, extra) {
  const q = typeof quelle === 'string' ? quelleOderFehler(quelle) : quelle;
  const u = new URL(q.weg, WIRKUNG);
  u.searchParams.set('source', QUELLE);
  u.searchParams.set('variant', typeof extra?.variant === 'string' ? extra.variant : 'standard');
  u.searchParams.set('fen', normiereFen(fen));
  u.searchParams.set(
    'play',
    (Array.isArray(zuege) ? zuege : String(zuege || '').split(','))
      .map((z) => String(z).trim())
      .filter(Boolean)
      .join(','),
  );
  u.searchParams.set('moves', String(anzahl));
  // Spiele sind die grosse Datenmenge - nur holen, wenn wirklich gewollt.
  const mitSpielen = Number.isFinite(extra?.spiele) ? extra.spiele : 0;
  u.searchParams.set('topGames', String(extra?.mitTopGames ? Math.min(mitSpielen, 15) : 0));
  u.searchParams.set('recentGames', String(extra?.mitLetzten ? Math.min(mitSpielen, 4) : 0));
  // Die Reiter-Filter kommen aus der QUELLE; der Aufrufer darf sie überschreiben.
  for (const [k, w] of Object.entries(q.filter)) {
    if (extra?.[k] !== undefined) u.searchParams.set(k, String(extra[k]));
    else u.searchParams.set(k, String(w));
  }
  // /player verlangt laut Doku player und color - beide sind Pflicht.
  if (q.weg === '/player') {
    const spieler = typeof extra?.spieler === 'string' ? extra.spieler.trim() : '';
    const farbe = extra?.farbe === 'black' ? 'black' : 'white';
    if (!spieler) {
      throw new ExplorerFehler('keinSpieler', 'Die Spielerdatenbank braucht einen Namen (spieler) und eine Farbe.');
    }
    u.searchParams.set('player', spieler);
    u.searchParams.set('color', farbe);
  }
  for (const [k, w] of Object.entries(extra?.parameter || {})) {
    u.searchParams.set(k, String(w));
  }
  return u.href;
}

const warte = (ms, signal) =>
  new Promise((fertig, fehlschlag) => {
    const uhr = setTimeout(() => {
      signal?.removeEventListener('abort', zuAbbruch);
      fertig();
    }, ms);
    const zuAbbruch = () => {
      clearTimeout(uhr);
      fehlschlag(new ExplorerFehler('abgebrochen', 'Abfrage abgebrochen.'));
    };
    if (signal?.aborted) zuAbbruch();
    else signal?.addEventListener('abort', zuAbbruch, { once: true });
  });

/**
 * Holt eine Quelle. Wiederholt bei 429 und bei Zeitüberschreitung, hoechstens
 * `maxVersuche` Mal (Vorgabe 3, mehr nicht). Ein 401 wird nie wiederholt -
 * dort ist das Token abgelaufen, da hilft Warten nicht.
 */
async function hole(url, weg, token, { maxVersuche = 3, wartezeitMs = 700, zeitlimitMs = 12000, signal } = {}) {
  const versuche = Math.max(1, Math.min(3, Number.isFinite(maxVersuche) ? Math.floor(maxVersuche) : 3));
  let letzterFehler = null;
  for (let i = 0; i < versuche; i += 1) {
    if (signal?.aborted) throw new ExplorerFehler('abgebrochen', 'Abfrage abgebrochen.');
    const c = new AbortController();
    const uhr = setTimeout(() => c.abort(), zeitlimitMs);
    const aufAbbruch = () => c.abort();
    signal?.addEventListener('abort', aufAbbruch, { once: true });
    let antwort;
    let zeitUeberschritten = false;
    try {
      antwort = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: c.signal,
      });
    } catch (err) {
      zeitUeberschritten = err?.name === 'AbortError' && !signal?.aborted;
      letzterFehler = zeitUeberschritten
        ? new ExplorerFehler('zeitueberschreitung', `Zeitüberschreitung nach ${zeitlimitMs} ms.`)
        : signal?.aborted
          ? new ExplorerFehler('abgebrochen', 'Abfrage abgebrochen.')
          : new ExplorerFehler('netz', `Die Abfrage ist fehlgeschlagen: ${err?.message || 'unbekannter Grund'}.`);
    } finally {
      clearTimeout(uhr);
      signal?.removeEventListener('abort', aufAbbruch);
    }

    if (antwort) {
      if (antwort.ok) return antwort;
      if (antwort.status === 401) {
        // Token abgelaufen: Status zurücksetzen und genau EINEN Fehler werfen.
        loeschen(SPEICHER.token);
        throw new ExplorerFehler('abgelaufen', 'Nicht angemeldet - bitte erneut einloggen.');
      }
      if (antwort.status === 429) {
        const wartehinweis = Number(antwort.headers?.get?.('Retry-After'));
        letzterFehler = new ExplorerFehler('zuViele', 'Zu viele Anfragen (429) - bitte später erneut versuchen.');
        if (i + 1 < versuche) {
          await warte(Number.isFinite(wartehinweis) && wartehinweis > 0 ? Math.min(wartehinweis * 1000, 10000) : wartezeitMs * (i + 1), signal);
          continue;
        }
        throw letzterFehler;
      }
      if (antwort.status === 404) {
        throw new ExplorerFehler('nichtGefunden', `Diesen Weg gibt es nicht (404): ${weg}`);
      }
      letzterFehler = new ExplorerFehler('server', `Antwort HTTP ${antwort.status}.`);
      if (antwort.status >= 500 && i + 1 < versuche) {
        await warte(wartezeitMs * (i + 1), signal);
        continue;
      }
      throw letzterFehler;
    }

    // Kein HTTP-Status: Zeitüberschreitung oder Netzfehler - beides zählt als Versuch.
    if (letzterFehler?.code === 'abgebrochen') throw letzterFehler;
    if (i + 1 < versuche) {
      await warte(wartezeitMs * (i + 1), signal);
      continue;
    }
    throw letzterFehler;
  }
  throw letzterFehler || new ExplorerFehler('unbekannt', 'Die Abfrage ist fehlgeschlagen.');
}

/**
 * Eine Quelle abfragen. Ohne Anmeldung wirft das sofort - kein stilles
 * Scheitern und kein Warten, denn ohne Token kommt ohnehin 401.
 */
export async function abfrage(fen, { quelle, zuege = [], anzahl = STANDARD_ANZAHL, ...rest } = {}) {
  const q = quelleOderFehler(quelle);
  const angemeldet = tokenLesen();
  if (!angemeldet) {
    throw new ExplorerFehler('nichtAngemeldet', 'Nicht angemeldet - bitte einloggen.');
  }
  const anzahlText = Number.isFinite(Number(anzahl)) ? Math.max(1, Math.min(100, Math.floor(Number(anzahl)))) : STANDARD_ANZAHL;
  const schluessel = cacheSchluessel(fen, q.id, zuege, anzahlText);
  const alter = rest.maxAlterMs ?? 86400_000;
  const treffer = ausZwischenspeicher(schluessel, alter);
  if (treffer) return { ...treffer, ausCache: true };

  const c = new AbortController();
  laufende.add(c);
  const ausAbbruch = () => c.abort();
  rest.signal?.addEventListener('abort', ausAbbruch, { once: true });
  try {
    const url = baueAbfrageUrl(q, fen, zuege, anzahlText, rest);
    const antwort = await hole(url, q.weg, angemeldet.token, { maxVersuche: rest.maxVersuche, wartezeitMs: rest.wartezeitMs, zeitlimitMs: rest.zeitlimitMs, signal: c.signal });
    const text = await antwort.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Der 401 kam als HTML-Seite. Wenn eine Antwort HTML ist, ist sie ein Fehler.
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new ExplorerFehler('keinJson', 'Die Antwort war HTML statt JSON - vermutlich abgelehnt.');
      }
      // /player liefert application/x-ndjson: mehrere JSON-Objekte, eines je
      // Zeile. Der letzte gültige Satz ist der am weitesten geduldete Stand.
      const zeilen = text
        .split('\n')
        .map((z) => z.trim())
        .filter(Boolean);
      for (let i = zeilen.length - 1; i >= 0; i -= 1) {
        try {
          json = JSON.parse(zeilen[i]);
          break;
        } catch {
          json = undefined;
        }
      }
      if (json === undefined) {
        throw new ExplorerFehler('keinJson', 'Die Antwort war weder JSON noch NDJSON.');
      }
    }
    const ergebnis = { ...parserAntwort(json), quelle: q.id, quelleName: q.name, fen: normiereFen(fen), zuege, ausCache: false };
    zwischenspeichern(schluessel, ergebnis, rest.cacheBis);
    return ergebnis;
  } finally {
    rest.signal?.removeEventListener('abort', ausAbbruch);
    laufende.delete(c);
  }
}

/**
 * Mehrere Quellen in einem Aufruf aus Sicht der Seite - aber nicht in einem
 * HTTP-Aufruf: die Doku kennt keinen Weg, der zwei Datenbanken mischt. Es
 * werden deshalb mehrere Abfragen gleichzeitig gestartet; eine Quelle, die
 * ausfällt, nimmt den anderen nichts weg.
 */
export async function abfrageUebertragbar(fen, { quellen, ...rest } = {}) {
  const liste = Array.isArray(quellen) && quellen.length ? quellen : QUELLEN.map((q) => q.id);
  const ids = liste.map((q) => (typeof q === 'string' ? q : q?.id)).filter((id) => typeof id === 'string');
  if (!ids.length) throw new ExplorerFehler('keineQuelle', 'Keine Quellen angegeben.');
  const alle = await Promise.allSettled(ids.map((id) => abfrage(fen, { ...rest, quelle: id })));
  const treffer = {};
  const fehler = {};
  alle.forEach((r, i) => {
    if (r.status === 'fulfilled') treffer[ids[i]] = r.value;
    else fehler[ids[i]] = r.reason?.code || 'unbekannt';
  });
  return { treffer, fehler, quellen: ids, fen: normiereFen(fen) };
}