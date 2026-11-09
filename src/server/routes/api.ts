import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import type {
  InitResponse,
  MoveValidationResponse,
  Puzzle,
} from '../../shared/api';
import { createRandomPuzzle, DICTIONARY } from '../data/puzzles';
import {
  assertPuzzleDefinition,
  applyHintCost,
  calculateCompletionScore,
  calculateHintCost,
  calculateMoveScore,
  calculateHintTotalCost,
  shortestPath,
  validateSequence,
} from '../core/game';

export const api = new Hono();

type SessionState = {
  gameScore: number;
  level: number;
  puzzle: Puzzle;
  words: string[];
  completed: boolean;
  hintsUsed: number;
};

const sessionPattern = /^(?:[a-f0-9-]{20,80}|session-[a-z0-9-]{10,80})$/i;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const RATE_WINDOW_SECONDS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 &&
    value.length <= 200 && value.every((item) => typeof item === 'string');
}

function cloneSession(state: SessionState): SessionState {
  return { ...state, puzzle: { ...state.puzzle }, words: [...state.words] };
}

function isSessionState(value: unknown): value is SessionState {
  if (!isRecord(value) || typeof value.gameScore !== 'number' ||
      !Number.isSafeInteger(value.gameScore) || value.gameScore < 0 ||
      typeof value.level !== 'number' || !Number.isSafeInteger(value.level) || value.level < 1 ||
      !isRecord(value.puzzle) || typeof value.puzzle.id !== 'string' ||
      typeof value.puzzle.title !== 'string' || typeof value.puzzle.start !== 'string' ||
      typeof value.puzzle.target !== 'string' || typeof value.puzzle.wordLength !== 'number' ||
      typeof value.puzzle.optimalMoves !== 'number' || !isStringArray(value.words) ||
      typeof value.completed !== 'boolean' || typeof value.hintsUsed !== 'number' ||
      !Number.isSafeInteger(value.hintsUsed) || value.hintsUsed < 0) {
    return false;
  }

  if (typeof value.puzzle.wordLength !== 'number' ||
      typeof value.puzzle.optimalMoves !== 'number') return false;
  const puzzle: Puzzle = {
    id: value.puzzle.id,
    title: value.puzzle.title,
    start: value.puzzle.start,
    target: value.puzzle.target,
    wordLength: value.puzzle.wordLength,
    optimalMoves: value.puzzle.optimalMoves,
  };
  if (puzzle.wordLength !== 4 || puzzle.start.length !== 4 || puzzle.target.length !== 4 ||
      !DICTIONARY.has(puzzle.start) || !DICTIONARY.has(puzzle.target) ||
      !Number.isSafeInteger(puzzle.optimalMoves) || puzzle.optimalMoves < 1 ||
      value.words[0] !== puzzle.start) {
    return false;
  }

  const words = value.words;
  if (words.length === 1) return !value.completed;
  const result = validateSequence(puzzle, DICTIONARY, words);
  return result.valid && result.complete === value.completed;
}

function sessionKey(sessionId: string): string {
  return `wrdlink:session:${sessionId}`;
}


