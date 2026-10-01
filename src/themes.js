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
