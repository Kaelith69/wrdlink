import assert from 'node:assert/strict';
import test from 'node:test';
import { createRandomPuzzle, DICTIONARY } from './puzzles.ts';
import { differsByOneLetter, shortestPath } from '../core/game.ts';

void test('generates solvable dictionary puzzles with random endpoints', () => {
  const puzzles = Array.from({ length: 20 }, () => createRandomPuzzle());
  const endpointPairs = new Set(puzzles.map(({ start, target }) => `${start}:${target}`));

  assert.ok(endpointPairs.size > 1);
  for (const puzzle of puzzles) {
    assert.notEqual(puzzle.start, puzzle.target);
    assert.equal(puzzle.wordLength, 4);
    assert.equal(DICTIONARY.has(puzzle.start), true);
    assert.equal(DICTIONARY.has(puzzle.target), true);
    assert.ok(puzzle.optimalMoves >= 3 && puzzle.optimalMoves <= 5);
    const route = shortestPath(puzzle.start, puzzle.target, DICTIONARY);
    assert.ok(route);
    assert.equal(route.length - 1, puzzle.optimalMoves);
    for (let index = 1; index < route.length; index += 1) {
      assert.equal(differsByOneLetter(route[index - 1] ?? '', route[index] ?? ''), true);
    }
  }
});

void test('random puzzle endpoints are connected through dictionary neighbors', () => {
  const puzzle = createRandomPuzzle();
  assert.equal(puzzle.start.length, puzzle.target.length);
  assert.ok(DICTIONARY.has(puzzle.start));
  assert.ok(DICTIONARY.has(puzzle.target));
  assert.ok(puzzle.optimalMoves >= 1);
  const route = shortestPath(puzzle.start, puzzle.target, DICTIONARY);
  assert.ok(route);
  assert.equal(route.length - 1, puzzle.optimalMoves);
});


void test('campaign levels receive progressively harder optimal move bands', () => {
  for (const [level, minimum, maximum] of [[1, 3, 5], [4, 4, 6], [7, 5, 7]] as const) {
    const puzzle = createRandomPuzzle(level);
    assert.ok(
      puzzle.optimalMoves >= minimum && puzzle.optimalMoves <= maximum,
      `Level ${level} generated ${puzzle.optimalMoves} optimal moves, expected ${minimum} to ${maximum}.`
    );
  }
});

void test('high campaign levels still produce a valid puzzle when a target band is sparse', () => {
  const puzzle = createRandomPuzzle(10_000);
  assert.ok(DICTIONARY.has(puzzle.start));
  assert.ok(DICTIONARY.has(puzzle.target));
  assert.notEqual(puzzle.start, puzzle.target);
  const route = shortestPath(puzzle.start, puzzle.target, DICTIONARY);
  assert.ok(route);
  assert.equal(route.length - 1, puzzle.optimalMoves);
});

void test('late campaign levels always return a connected puzzle', () => {
  for (const level of [10, 13, 10000]) {
    const puzzle = createRandomPuzzle(level);
    const route = shortestPath(puzzle.start, puzzle.target, DICTIONARY);
    assert.ok(route, `Level ${level} returned disconnected endpoints.`);
    assert.equal(route.length - 1, puzzle.optimalMoves);
  }
});
