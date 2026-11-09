import type { Puzzle, MoveValidationResponse } from '../../shared/api';

function failure(
  message: string,
  movesUsed = 0,
  gameScore = 0,
  words: string[] = [],
  hintsUsed = 0
): MoveValidationResponse {
  return {
    valid: false,
    complete: false,
    message,
    movesUsed,
    pointsAwarded: 0,
    gameScore,
    words,
    level: 1,
    hintsUsed,
    hintCost: 5 + hintsUsed,
    hintWord: null,
  };
}

export function calculateHintCost(hintsUsed: number): number {
  return 5 + Math.max(0, Math.floor(hintsUsed));
}

export function calculateMoveScore(score: number): number {
  return Math.max(0, Math.floor(score) - 1);
}

export function calculateCompletionScore(score: number): number {
  return Math.max(0, Math.floor(score)) + 25;
}

export function calculateHintTotalCost(hintsUsed: number): number {
  return calculateHintCost(hintsUsed) + 1;
}

export function canAffordHint(score: number, hintsUsed: number): boolean {
  return Number.isSafeInteger(score) && score >= calculateHintTotalCost(hintsUsed);
}

export function applyHintCost(score: number, hintsUsed: number): number | null {
  return canAffordHint(score, hintsUsed) ? score - calculateHintTotalCost(hintsUsed) : null;
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

export function differsByOneLetter(previous: string, current: string): boolean {
  if (previous.length !== current.length) return false;
  let differences = 0;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== current[index] && ++differences > 1) return false;
  }
  return differences === 1;
}

/** Generate neighbors with 104 set lookups instead of rescanning the dictionary. */
export function neighbors(word: string, dictionary: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (let position = 0; position < word.length; position += 1) {
    for (let code = 65; code <= 90; code += 1) {
      const letter = String.fromCharCode(code);
      if (letter === word[position]) continue;
      const candidate = word.slice(0, position) + letter + word.slice(position + 1);
      if (dictionary.has(candidate)) found.push(candidate);
    }
  }
  return found;
}

/** Breadth first search with parent reconstruction and optional used word exclusions. */
export function shortestPath(
  start: string,
  target: string,
  dictionary: ReadonlySet<string>,
  excludedWords: readonly string[] = []
): string[] | null {
  if (start === target) return [start];
  const blocked = new Set(excludedWords);
  blocked.delete(start);
  const queue = [start];
  let head = 0;
  const parent = new Map<string, string | null>([[start, null]]);

  while (head < queue.length) {
    const current = queue[head++];
    if (!current) continue;

    for (const neighbor of neighbors(current, dictionary)) {
      if (blocked.has(neighbor) || parent.has(neighbor)) continue;
      parent.set(neighbor, current);

      if (neighbor === target) {
        const path: string[] = [];
        let cursor: string | null = target;
        while (cursor !== null) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}

export function validateSequence(
  puzzle: Puzzle,
  dictionary: ReadonlySet<string>,
  rawWords: readonly string[]
): MoveValidationResponse {
  const words = rawWords.map((word) => word.trim().toUpperCase());
  const movesUsed = Math.max(0, words.length - 1);
  const currentWord = words[words.length - 1];
  const wordPattern = new RegExp(`^[A-Z]{${puzzle.wordLength}}$`);

  if (words.length < 2) return failure('Enter a word to continue.', movesUsed, 0, words);
  if (words.length > 200) return failure('This word chain is too long.', movesUsed, 0, words);
  if (words[0] !== puzzle.start) return failure(`Start with ${puzzle.start}.`, movesUsed, 0, words);
  if (words.some((word) => !wordPattern.test(word))) {
    return failure(`Every word must contain exactly ${puzzle.wordLength} letters.`, movesUsed, 0, words);
  }
  if (words.some((word) => !dictionary.has(word))) {
    return failure('That word is not in the dictionary.', movesUsed, 0, words);
  }
  if (new Set(words).size !== words.length) {
    return failure('You cannot use the same word twice.', movesUsed, 0, words);
  }

  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    if (!previous || !current || !differsByOneLetter(previous, current)) {
      return failure('Change exactly one letter per move.', movesUsed, 0, words);
    }
    if (current === puzzle.target && index !== movesUsed) {
      return failure('The target must be your final word.', movesUsed, 0, words);
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
      words: [...words],
      level: 1,
      hintsUsed: 0,
      hintCost: 5,
      hintWord: null,
    };
  }

  return {
    valid: true,
    complete: false,
    message: 'Valid move.',
    movesUsed,
    pointsAwarded: 0,
    gameScore: 0,
    words: [...words],
    level: 1,
    hintsUsed: 0,
    hintCost: 5,
    hintWord: null,
  };
}
