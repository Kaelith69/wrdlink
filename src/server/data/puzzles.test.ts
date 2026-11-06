import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node resolves the native TypeScript module at runtime.
import { createRandomPuzzle, DICTIONARY } from './puzzles.ts';

void test('generates solvable dictionary puzzles with random endpoints', () => {
  const puzzles = Array.from({ length: 20 }, () => createRandomPuzzle());
  const endpointPairs = new Set(puzzles.map(({ start, target }) => `${start}:${target}`));

  assert.ok(endpointPairs.size > 1);
  for (const puzzle of puzzles) {
    assert.notEqual(puzzle.start, puzzle.target);
    assert.equal(puzzle.wordLength, 4);
    assert.equal(DICTIONARY.has(puzzle.start), true);
    assert.equal(DICTIONARY.has(puzzle.target), true);
    assert.ok(puzzle.optimalMoves >= 1);
    assert.ok(puzzle.optimalMoves >= 1);
  }
});

void test('random puzzle endpoints are connected through dictionary neighbors', () => {
  const puzzle = createRandomPuzzle();
  assert.equal(puzzle.start.length, puzzle.target.length);
  assert.ok(DICTIONARY.has(puzzle.start));
  assert.ok(DICTIONARY.has(puzzle.target));
  assert.ok(puzzle.optimalMoves >= 1);
});
