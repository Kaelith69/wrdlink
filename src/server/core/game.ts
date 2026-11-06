import type { Puzzle, MoveValidationResponse } from '../../shared/api';

function failure(
  message: string,
  movesUsed = 0,
  reset = false,
  failed = false
): MoveValidationResponse {
  return {
    valid: false,
    complete: false,
    message,
    movesUsed,
      pointsAwarded: 0,
      gameScore: 0,
    reset,
    failed,
  };
}

export function calculatePoints(puzzle: Puzzle, movesUsed: number): number {
  void puzzle;
  return Math.max(0, 50 - movesUsed);
}

export function assertPuzzleDefinition(
  puzzle: Puzzle,
  dictionary: ReadonlySet<string>
): void {
  if (
    !Number.isInteger(puzzle.wordLength) ||
    puzzle.wordLength < 1 ||
    puzzle.start.length !== puzzle.wordLength ||
    puzzle.target.length !== puzzle.wordLength
  ) {
    throw new Error(`Puzzle ${puzzle.id} has an invalid word length.`);
  }

  if (!Number.isInteger(puzzle.optimalMoves) || puzzle.optimalMoves < 1) {
    throw new Error(`Puzzle ${puzzle.id} has an invalid optimal move count.`);
  }

  if (!dictionary.has(puzzle.start) || !dictionary.has(puzzle.target)) {
    throw new Error(`Puzzle ${puzzle.id} has words missing from the dictionary.`);
  }
}

function differsByOneLetter(previous: string, current: string): boolean {
  let differences = 0;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== current[index]) differences += 1;
  }
  return differences === 1;
}

export function validateSequence(
  puzzle: Puzzle,
  _dictionary: ReadonlySet<string>,
  rawWords: readonly string[]
): MoveValidationResponse {
  if (rawWords.length < 2) return failure('Enter a word to continue.');

  const words = rawWords.map((word) => word.trim().toUpperCase());
  const movesUsed = words.length - 1;
  const currentWord = words[words.length - 1];
  if (!currentWord) return failure('Enter a word to continue.', movesUsed);

  const wordPattern = new RegExp(`^[A-Z]{${puzzle.wordLength}}$`);
  if (words[0] !== puzzle.start) {
    return failure(`Start with ${puzzle.start}.`, movesUsed);
  }
  if (words.some((word) => !wordPattern.test(word))) {
    return failure(`Every word must contain exactly ${puzzle.wordLength} letters.`, movesUsed);
  }
  if (words.some((word) => !_dictionary.has(word))) {
    return failure('That word is not in the dictionary.', movesUsed);
  }
  if (new Set(words).size !== words.length) {
    return failure('You cannot use the same word twice.', movesUsed);
  }

  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    if (!previous || !current || !differsByOneLetter(previous, current)) {
      return failure('Change exactly one letter per move.', movesUsed);
    }
    if (current === puzzle.target && index !== movesUsed) {
      return failure('The target must be your final word.', movesUsed);
    }
  }

  if (currentWord === puzzle.target) {
    return {
      valid: true,
      complete: true,
      message: movesUsed === puzzle.optimalMoves
        ? 'Solved in the minimum moves.'
        : `Solved in ${movesUsed} moves. Minimum: ${puzzle.optimalMoves}.`,
      movesUsed,
      pointsAwarded: 0,
      gameScore: 0,
      reset: false,
      failed: false,
    };
  }

  return {
    valid: true,
    complete: false,
    message: 'Valid move.',
    movesUsed,
    pointsAwarded: 0,
    gameScore: 0,
    reset: false,
    failed: false,
  };
}
