export type Puzzle = {
  id: string;
  title: string;
  start: string;
  target: string;
  wordLength: number;
  optimalMoves: number;
}

export type InitResponse = {
  type: 'init';
  puzzle: Puzzle;
  sessionId: string;
  gameScore: number;
  level: number;
};

export type ValidateRequest = {
  sessionId: string;
  puzzleId: string;
  words: string[];
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
};
