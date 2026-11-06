import assert from 'node:assert/strict';
import test from 'node:test';
import type { Puzzle } from '../../shared/api.ts';
// @ts-expect-error Node resolves the native TypeScript module at runtime.
import { DICTIONARY } from '../data/puzzles.ts';
// @ts-expect-error Node resolves the native TypeScript module at runtime.
import { calculatePoints, validateSequence } from './game.ts';

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

void test('accepts a different valid route without score constraints', () => {
  const result = validateSequence(
    puzzle,
    new Set([...DICTIONARY, 'HELL']),
    ['HEAD', 'HEAL', 'HELL', 'TELL', 'TALL', 'TAIL']
  );
  assert.equal(result.valid, true);
  assert.equal(result.complete, true);
  assert.equal(result.movesUsed, 5);
});

void test('accepts valid partial routes', () => {
  const result = validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEAL']);
  assert.equal(result.valid, true);
  assert.equal(result.complete, false);
  assert.equal(result.movesUsed, 1);
});

void test('accepts expanded dictionary words when the move is valid', () => {
  const result = validateSequence(
    { ...puzzle, start: 'RAIL', target: 'RAID', optimalMoves: 1 },
    DICTIONARY,
    ['RAIL', 'RAID']
  );
  assert.equal(DICTIONARY.has('RAID'), true);
  assert.equal(result.valid, true);
  assert.equal(result.complete, true);
});

void test('rejects invalid words without consuming the move', () => {
  const result = validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEA!']);
  assert.equal(result.valid, false);
  assert.equal(result.failed, false);
  assert.equal(result.movesUsed, 1);
  assert.match(result.message, /exactly 4 letters/i);
});

void test('rejects made-up words outside the dictionary', () => {
  const result = validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEZZ']);
  assert.equal(result.valid, false);
  assert.equal(result.failed, false);
  assert.equal(result.movesUsed, 1);
  assert.match(result.message, /dictionary/i);
});

void test('allows extra valid moves without failing the puzzle', () => {
  const result = validateSequence(
    puzzle,
    DICTIONARY,
    ['HEAD', 'HEAL', 'HELL', 'TELL', 'TEAL', 'REAL']
  );
  assert.equal(result.valid, true);
  assert.equal(result.failed, false);
  assert.equal(result.movesUsed, 5);
});

void test('rejects malformed, repeated, and multi-letter moves', () => {
  assert.match(
    validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEA!']).message,
    /exactly 4 letters/i
  );
  assert.match(
    validateSequence(puzzle, DICTIONARY, ['HEAD', 'HEAL', 'HEAD']).message,
    /same word/i
  );
  assert.match(
    validateSequence(puzzle, DICTIONARY, ['HEAD', 'TAIL']).message,
    /one letter/i
  );
});

void test('awards more points for fewer moves', () => {
  assert.equal(calculatePoints(puzzle, 1), 49);
  assert.equal(calculatePoints(puzzle, 5), 45);
  assert.ok(calculatePoints(puzzle, 6) < calculatePoints(puzzle, 5));
  assert.equal(calculatePoints(puzzle, 50), 0);
});
