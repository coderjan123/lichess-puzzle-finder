// Display names for the 73 puzzle themes in the lichess puzzle database.
//
// key   = theme name as it appears in the database (English, this is also what
//         lichess.org shows)
// label = display text
// group = section in the theme picker
//
// The theme names are lichess's own English names - the site is in English, so
// there is nothing to translate. The search field accepts both the label and the
// raw key ("matein3", "mate in 3", "discovered check").

export const GROUPS = [
  { id: 'mate', label: 'Mate patterns' },
  { id: 'tactic', label: 'Tactics & attack' },
  { id: 'defence', label: 'Defence & awareness' },
  { id: 'endgame', label: 'Endgame' },
  { id: 'phase', label: 'Game phase' },
  { id: 'other', label: 'Other' },
];

export const THEMES = {
  // --- Mate patterns ------------------------------------------------------
  anastasiaMate: ["Anastasia's mate", 'mate'],
  arabianMate: ['Arabian mate', 'mate'],
  backRankMate: ['Back rank mate', 'mate'],
  balestraMate: ['Balestra mate', 'mate'],
  blindSwineMate: ['Blind swine mate', 'mate'],
  bodenMate: ["Boden's mate", 'mate'],
  cornerMate: ['Corner mate', 'mate'],
  doubleBishopMate: ['Double bishop mate', 'mate'],
  dovetailMate: ['Dovetail mate', 'mate'],
  epauletteMate: ['Epaulette mate', 'mate'],
  hookMate: ['Hook mate', 'mate'],
  killBoxMate: ['Kill box mate', 'mate'],
  mate: ['Mate (any)', 'mate'],
  mateIn1: ['Mate in 1', 'mate'],
  mateIn2: ['Mate in 2', 'mate'],
  mateIn3: ['Mate in 3', 'mate'],
  mateIn4: ['Mate in 4', 'mate'],
  mateIn5: ['Mate in 5', 'mate'],
  morphysMate: ["Morphy's mate", 'mate'],
  operaMate: ['Opera mate', 'mate'],
  pillsburysMate: ["Pillsbury's mate", 'mate'],
  smotheredMate: ['Smothered mate', 'mate'],
  swallowstailMate: ["Swallow's tail mate", 'mate'],
  triangleMate: ['Triangle mate', 'mate'],
  vukovicMate: ["Vukovic's mate", 'mate'],

  // --- Tactics & attack ---------------------------------------------------
  advancedPawn: ['Advanced pawn', 'tactic'],
  attraction: ['Attraction', 'tactic'],
  attackingF2F7: ['Attacking f2/f7', 'tactic'],
  clearance: ['Clearance', 'tactic'],
  discoveredAttack: ['Discovered attack', 'tactic'],
  fork: ['Fork', 'tactic'],
  interference: ['Interference', 'tactic'],
  kingsideAttack: ['King-side attack', 'tactic'],
  pin: ['Pin', 'tactic'],
  queensideAttack: ['Queen-side attack', 'tactic'],
  sacrifice: ['Sacrifice', 'tactic'],
  skewer: ['Skewer', 'tactic'],
  xRayAttack: ['X-ray attack', 'tactic'],
  underPromotion: ['Underpromotion', 'tactic'],

  // --- Defence & awareness ------------------------------------------------
  capturingDefender: ['Capturing the defender', 'defence'],
  defensiveMove: ['Defensive move', 'defence'],
  trappedPiece: ['Trapped piece', 'defence'],
  hangingPiece: ['Hanging piece', 'defence'],
  quietMove: ['Quiet move', 'defence'],
  zugzwang: ['Zugzwang', 'defence'],
  doubleCheck: ['Double check', 'defence'],
  discoveredCheck: ['Discovered check', 'defence'],
  deflection: ['Deflection', 'defence'],
  intermezzo: ['Intermezzo', 'defence'],
  enPassant: ['En passant', 'defence'],
  promotion: ['Promotion', 'defence'],
  collinearMove: ['Collinear move', 'defence'],

  // --- Endgame ------------------------------------------------------------
  bishopEndgame: ['Bishop endgame', 'endgame'],
  knightEndgame: ['Knight endgame', 'endgame'],
  pawnEndgame: ['Pawn endgame', 'endgame'],
  queenEndgame: ['Queen endgame', 'endgame'],
  queenRookEndgame: ['Queen & rook endgame', 'endgame'],
  rookEndgame: ['Rook endgame', 'endgame'],
  endgame: ['Endgame', 'endgame'],

  // --- Game phase ---------------------------------------------------------
  middlegame: ['Middlegame', 'phase'],
  opening: ['Opening', 'phase'],
  long: ['Long game', 'phase'],
  short: ['Short game', 'phase'],
  veryLong: ['Very long game', 'phase'],
  oneMove: ['One move', 'phase'],

  // --- Player strength ----------------------------------------------------
  master: ['Master', 'other'],
  masterVsMaster: ['Master vs master', 'other'],
  superGM: ['Super GM', 'other'],
  equality: ['Equal position', 'other'],
  advantage: ['Winning position', 'other'],
  exposedKing: ['Exposed king', 'other'],
  crushing: ['Crushing', 'other'],
  castling: ['Castling', 'other'],
};

/** Anzeigetext eines Themes; unbekannte Namen werden unverändert übernommen. */
export function label(theme) {
  const entry = THEMES[theme];
  return entry ? entry[0] : theme;
}

/** Rubrik eines Themes. */
export function groupOf(theme) {
  const entry = THEMES[theme];
  return entry ? entry[1] : 'other';
}

/**
 * Deutsche Suchbegriffe - ausschliesslich fuer das Suchfeld.
 *
 * Die Seite ist englisch, gesucht werden kann aber in beiden Sprachen: wer
 * "matt" eintippt, sucht Mate-Motive, und das war vor dem Sprachwechsel der
 * angezeigte Name. Die Namen stammen aus der Git-Historie, damit hier nichts
 * frei erfunden ist; ergaenzt wurden Woerter, die nachgefragt wurden.
 *
 * Geprueft wird ueber norm() in main.js: Kleinschreibung, Umlaute werden auf
 * ihren Grundlaut gelegt (ä->a, ö->o, ü->u, ß->ss), alles andere faellt weg.
 * Gesucht wird mit "enthält", deshalb genuegt eine Naeherung: "matt" trifft
 * "Matt in 2", "rontgen" trifft "Röntgenangriff".
 *
 * Beide Schreibweisen stehen dabei, weil ein Alias mit ae/oe/ue geschrieben
 * nicht auf "Haengende" passt und umgekehrt auch nicht: norm() legt die
 * Umlaute auf den Grundlaut, nicht auf "ae".
 */
export const SEARCH_DE = {
  anastasiaMate: ['Anastasia-Matt'],
  arabianMate: ['Arabisches Matt'],
  backRankMate: ['Matt auf der 1. Reihe'],
  balestraMate: ['Balestra-Matt'],
  blindSwineMate: ['Blindes-Schwein-Matt'],
  bodenMate: ['Boden-Matt'],
  cornerMate: ['Ecken-Matt'],
  doubleBishopMate: ['Doppel-Läufer-Matt', 'Doppel-Laeufer-Matt', 'Doppel-Laufer-Matt'],
  dovetailMate: ['Dovetail-Matt'],
  epauletteMate: ['Epauletten-Matt'],
  hookMate: ['Haken-Matt'],
  killBoxMate: ['Killbox-Matt'],
  mate: ['Matt (alle)', 'alle mattmotive', 'mattmotiv'],
  mateIn1: ['Matt in 1'],
  mateIn2: ['Matt in 2'],
  mateIn3: ['Matt in 3'],
  mateIn4: ['Matt in 4'],
  mateIn5: ['Matt in 5'],
  morphysMate: ['Morphys Matt'],
  operaMate: ['Opera-Matt'],
  pillsburysMate: ['Pillsburys Matt'],
  smotheredMate: ['Ersticktes Matt'],
  swallowstailMate: ['Swallowstail-Matt'],
  triangleMate: ['Dreiecks-Matt'],
  vukovicMate: ['Vukovic-Matt'],
  advancedPawn: ['Weit vorgedrungener Bauer'],
  attraction: ['Heranziehen', 'hinlenkung', 'heranziehen'],
  attackingF2F7: ['Angriff auf f2/f7'],
  clearance: ['Weg freimachen'],
  discoveredAttack: ['Abzugangriff', 'aufdeckungsangriff'],
  fork: ['Gabel', 'gabelstellung'],
  interference: ['Blockade', 'blockieren'],
  kingsideAttack: ['Angriff auf die Königsseite', 'Angriff auf die Koenigsseite', 'Angriff auf die Konigsseite'],
  pin: ['Fesselung'],
  queensideAttack: ['Angriff auf die Damenseite'],
  sacrifice: ['Opfer'],
  skewer: ['Durchstoß', 'Durchstoss', 'durchstoss'],
  xRayAttack: ['Röntgenangriff', 'Roentgenangriff', 'Rontgenangriff', 'röntgenangriff', 'röntgen'],
  underPromotion: ['Unterwandlung', 'unterwandlung'],
  capturingDefender: ['Verteidiger schlagen'],
  defensiveMove: ['Verteidigungszug'],
  trappedPiece: ['Eingefangene Figur', 'eingefangen'],
  hangingPiece: ['Hängende Figur', 'Haengende Figur', 'Hangende Figur', 'hängende', 'haengende'],
  quietMove: ['Stiller Zug'],
  zugzwang: ['Zugzwang'],
  doubleCheck: ['Doppelschach'],
  discoveredCheck: ['Abzugscheck', 'abzugschach'],
  deflection: ['Ablenkung', 'umlenkung', 'ablenkung'],
  intermezzo: ['Intermezzo'],
  enPassant: ['En passant'],
  promotion: ['Umwandlung', 'umwandlung'],
  collinearMove: ['Kollinearer Zug'],
  bishopEndgame: ['Läuferendspiel', 'Laeuferendspiel', 'Lauferendspiel', 'läufer', 'laeufer'],
  knightEndgame: ['Springerendspiel', 'springer'],
  pawnEndgame: ['Bauernendspiel', 'bauernendspiel', 'bauerendspiel'],
  queenEndgame: ['Damenendspiel', 'dame'],
  queenRookEndgame: ['Damen-Turm-Endspiel', 'dame und turm'],
  rookEndgame: ['Turmendspiel', 'turm'],
  endgame: ['Endspiel (alle)', 'endspiel (alle)'],
  middlegame: ['Mittelspiel', 'mittelpartie'],
  opening: ['Eröffnung', 'Eroeffnung', 'Eroffnung', 'eröffnung', 'eroeffnung'],
  long: ['Lange Partie', 'lange partie'],
  short: ['Kurze Partie', 'kurze partie'],
  veryLong: ['Sehr lange Partie', 'sehr lange partie'],
  oneMove: ['Ein Zug', 'ein zug'],
  master: ['Meister-Niveau', 'meister', 'grossmeister'],
  masterVsMaster: ['Meister gegen Meister', 'meister gegen meister'],
  superGM: ['Super-GM', 'großmeister', 'grossmeister'],
  equality: ['Gleichstand'],
  advantage: ['Vorteil'],
  exposedKing: ['Freistehender König', 'Freistehender Koenig', 'Freistehender Konig', 'freistehender könig'],
  crushing: ['Überwältigende Überlegenheit', 'Überwaeltigende Überlegenheit', 'Überwaltigende Überlegenheit'],
  castling: ['Rochade', 'rokade'],
};

/** Dasselbe fuer die Rubriken, damit "taktik" oder "endspiel" etwas findet. */
export const GROUP_SEARCH_DE = {
  mate: ['matt', 'mattmotive', 'matte', 'mattmuster'],
  tactic: ['taktik', 'angriff', 'angriffsfigur', 'manoeuvre'],
  defence: ['verteidigung', 'vermeidung', 'abwehr'],
  endgame: ['endspiel', 'endpartie', 'endphase'],
  phase: ['partiephase', 'spielphase', 'phase'],
  other: ['sonstiges', 'verschiedenes'],
};
