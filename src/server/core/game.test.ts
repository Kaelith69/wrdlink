import assert from 'node:assert/strict';
import test from 'node:test';
import type { Puzzle } from '../../shared/api.ts';
// @ts-expect-error Node resolves the native TypeScript module at runtime.
import { DICTIONARY } from '../data/puzzles.ts';
// @ts-expect-error Node resolves the native TypeScript module at runtime.
import {
  calculateHintCost,
  calculateHintPenalty,
  calculatePoints,
  differsByOneLetter,
  neighbors,
  shortestPath,
  validateSequence,
} from './game.ts';

const puzzle: Puzzle = {
  id: '001',
  title: 'Puzzle 1',
  start: 'HEAD',
  target: 'TAIL',
  wordLength: 4,
  optimalMoves: 5,
};

void test('accepts the minimum route', () => {
  const result = validateSequence(
    puzzle,
    DICTIONARY,
    ['HEAD', 'HEAL', 'TEAL', 'TELL', 'TALL', 'TAIL']
  );
  assert.equal(result.valid, true);
  assert.equal(result.complete, true);
  assert.equal(result.movesUsed, 5);
  assert.match(result.message, /minimum/i);
});

void test('accepts partial routes and rejects invalid words', () => {
  assert.equal(validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEAL']).valid, true);
  assert.match(validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEZZ']).message, /dictionary/i);
  assert.match(validateSequence(puzzle, DICTIONARY, ['HEAD', 'TAIL']).message, /one letter/i);
  assert.match(validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEAL', 'HEAD']).message, /same word/i);
});

void test('enforces exactly one changed letter and dictionary membership', () => {
  assert.equal(differsByOneLetter('COLD', 'CORD'), true);
  assert.equal(differsByOneLetter('COLD', 'WARM'), false);
  assert.equal(differsByOneLetter('COLD', 'COL'), false);
  assert.equal(neighbors('HEAD', DICTIONARY).includes('HEAL'), true);
  assert.equal(DICTIONARY.has('HEAL'), true);
});

void test('uses the current level scoring model', () => {
  assert.equal(calculatePoints(puzzle, 0), 25);
  assert.equal(calculatePoints(puzzle, 1), 24);
  assert.equal(calculatePoints(puzzle, 25), 0);
  assert.equal(calculatePoints(puzzle, 80), 0);
});

void test('move penalties and hint affordability are separate costs', () => {
  const scoreAfterMove = Math.max(0, 25 - 4 - 1);
  const firstHintCost = calculateHintCost(0);
  assert.equal(scoreAfterMove, 20);
  assert.equal(firstHintCost + 1, 6);
  assert.equal(Math.max(0, scoreAfterMove - firstHintCost - 1), 14);
  assert.equal(Math.max(0, 5 - (firstHintCost + 1)), 0);
});

void test('prices hints cumulatively across levels', () => {
  assert.equal(calculateHintCost(0), 5);
  assert.equal(calculateHintCost(1), 6);
  assert.equal(calculateHintCost(2), 7);
  assert.equal(calculateHintCost(3), 8);
  assert.equal(calculateHintPenalty(3), 18);
  assert.equal(calculateHintPenalty(4), 26);
});

void test('finds a shortest unused route for hints', () => {
  const path = shortestPath('HEAD', 'TAIL', DICTIONARY);
  assert.ok(path);
  assert.equal(path[0], 'HEAD');
  assert.equal(path.at(-1), 'TAIL');
  assert.equal(path.length - 1, puzzle.optimalMoves);

  for (let index = 1; index < path.length; index += 1) {
    assert.equal(differsByOneLetter(path[index - 1] ?? '', path[index] ?? ''), true);
  }

  const alternative = shortestPath('HEAD', 'TAIL', DICTIONARY, ['HEAL']);
  assert.ok(alternative);
  assert.equal(alternative.includes('HEAL'), false);
  assert.equal(shortestPath('HEAD', 'ZZZZ', DICTIONARY), null);
});
