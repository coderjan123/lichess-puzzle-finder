// Deutsche Beschriftungen fuer die 73 Themes der Lichess-Puzzledatenbank.
// key = Theme-Name aus der Datenbank, label = Anzeigetext,
// group = Rubrik im Theme-Auswahlfeld.

export const GROUPS = [
  { id: 'mate', label: 'Matt-Motive' },
  { id: 'tactic', label: 'Taktik & Angriff' },
  { id: 'defence', label: 'Verteidigung & Aufmerksamkeit' },
  { id: 'endgame', label: 'Endspiel' },
  { id: 'phase', label: 'Partiephase' },
  { id: 'other', label: 'Sonstiges' },
];

export const THEMES = {
  // --- Matt-Motive -------------------------------------------------------
  anastasiaMate: ['Anastasia-Matt', 'mate'],
  arabianMate: ['Arabisches Matt', 'mate'],
  backRankMate: ['Matt auf der 1. Reihe', 'mate'],
  balestraMate: ['Balestra-Matt', 'mate'],
  blindSwineMate: ['Blindes-Schwein-Matt', 'mate'],
  bodenMate: ['Boden-Matt', 'mate'],
  cornerMate: ['Ecken-Matt', 'mate'],
  doubleBishopMate: ['Doppel-Läufer-Matt', 'mate'],
  dovetailMate: ['Dovetail-Matt', 'mate'],
  epauletteMate: ['Epauletten-Matt', 'mate'],
  hookMate: ['Haken-Matt', 'mate'],
  killBoxMate: ['Killbox-Matt', 'mate'],
  mate: ['Matt (alle)', 'mate'],
  mateIn1: ['Matt in 1', 'mate'],
  mateIn2: ['Matt in 2', 'mate'],
  mateIn3: ['Matt in 3', 'mate'],
  mateIn4: ['Matt in 4', 'mate'],
  mateIn5: ['Matt in 5', 'mate'],
  morphysMate: ['Morphys Matt', 'mate'],
  operaMate: ['Opera-Matt', 'mate'],
  pillsburysMate: ['Pillsburys Matt', 'mate'],
  smotheredMate: ['Ersticktes Matt', 'mate'],
  swallowstailMate: ['Swallowstail-Matt', 'mate'],
  triangleMate: ['Dreiecks-Matt', 'mate'],
  vukovicMate: ['Vukovic-Matt', 'mate'],

  // --- Taktik & Angriff --------------------------------------------------
  advancedPawn: ['Weit vorgedrungener Bauer', 'tactic'],
  attraction: ['Heranziehen', 'tactic'],
  attackingF2F7: ['Angriff auf f2/f7', 'tactic'],
  clearance: ['Weg freimachen', 'tactic'],
  discoveredAttack: ['Abzugangriff', 'tactic'],
  fork: ['Gabel', 'tactic'],
  interference: ['Blockade', 'tactic'],
  kingsideAttack: ['Angriff auf die Königsseite', 'tactic'],
  pin: ['Fesselung', 'tactic'],
  queensideAttack: ['Angriff auf die Damenseite', 'tactic'],
  sacrifice: ['Opfer', 'tactic'],
  skewer: ['Durchstoß', 'tactic'],
  xRayAttack: ['Röntgenangriff', 'tactic'],
  underPromotion: ['Unterwandlung', 'tactic'],

  // --- Verteidigung & Aufmerksamkeit -----------------------------------
  capturingDefender: ['Verteidiger schlagen', 'defence'],
  defensiveMove: ['Verteidigungszug', 'defence'],
  trappedPiece: ['Eingefangene Figur', 'defence'],
  hangingPiece: ['Hängende Figur', 'defence'],
  quietMove: ['Stiller Zug', 'defence'],
  zugzwang: ['Zugzwang', 'defence'],
  doubleCheck: ['Doppelschach', 'tactic'],
  discoveredCheck: ['Abzugscheck', 'tactic'],
  deflection: ['Ablenkung', 'tactic'],
  intermezzo: ['Intermezzo', 'tactic'],
  enPassant: ['En passant', 'tactic'],
  promotion: ['Umwandlung', 'tactic'],
  collinearMove: ['Kollinearer Zug', 'other'],

  // --- Endspiel ----------------------------------------------------------
  bishopEndgame: ['Läuferendspiel', 'endgame'],
  knightEndgame: ['Springerendspiel', 'endgame'],
  pawnEndgame: ['Bauernendspiel', 'endgame'],
  queenEndgame: ['Damenendspiel', 'endgame'],
  queenRookEndgame: ['Damen-Turm-Endspiel', 'endgame'],
  rookEndgame: ['Turmendspiel', 'endgame'],
  endgame: ['Endspiel (alle)', 'endgame'],

  // --- Partiephase -------------------------------------------------------
  middlegame: ['Mittelspiel', 'phase'],
  opening: ['Eröffnung', 'phase'],
  long: ['Lange Partie', 'phase'],
  short: ['Kurze Partie', 'phase'],
  veryLong: ['Sehr lange Partie', 'phase'],
  oneMove: ['Ein Zug', 'phase'],
  master: ['Meister-Niveau', 'phase'],
  masterVsMaster: ['Meister gegen Meister', 'phase'],
  superGM: ['Super-GM', 'phase'],
  equality: ['Gleichstand', 'phase'],
  advantage: ['Vorteil', 'phase'],
  exposedKing: ['Freistehender König', 'phase'],
  crushing: ['Überwältigende Überlegenheit', 'phase'],
  castling: ['Rochade', 'other'],
};

export function label(theme) {
  const entry = THEMES[theme];
  return entry ? entry[0] : theme;
}

export function groupOf(theme) {
  const entry = THEMES[theme];
  return entry ? entry[1] : 'other';
}
