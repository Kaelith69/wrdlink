export type Puzzle = {
  id: string;
  title: string;
  start: string;
  target: string;
  wordLength: number;
  optimalMoves: number;
};

export type InitResponse = {
  type: 'init';
  puzzle: Puzzle;
  sessionId: string;
  gameScore: number;
  level: number;
  words: string[];
  hintsUsed: number;
  movesUsed: number;
  completed: boolean;
};

export type ValidateRequest = {
  sessionId: string;
  puzzleId: string;
  word: string;
};

export type MoveValidationResponse = {
  valid: boolean;
  complete: boolean;
  message: string;
  movesUsed: number;
  pointsAwarded: number;
  gameScore: number;
  reset: boolean;
  failed: boolean;
  words: string[];
  level: number;
  hintsUsed: number;
  hintCost: number;
  hintWord: string | null;
};

export type HintRequest = {
  sessionId: string;
  puzzleId: string;
};

export type HintResponse = {
  valid: boolean;
  complete: boolean;
  message: string;
  word: string | null;
  hintCost: number;
  totalCost: number;
  pointsAwarded: number;
  gameScore: number;
  hintsUsed: number;
  words: string[];
};
