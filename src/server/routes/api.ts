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
const memorySessions = new Map<string, SessionState>();

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

async function readSession(sessionId: string): Promise<SessionState | null> {
  try {
    const raw = await redis.get(sessionKey(sessionId));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isSessionState(parsed)) return cloneSession(parsed);
      console.warn('Discarding an invalid WRDLINK session snapshot.');
    }
  } catch (error) {
    console.error('WRDLINK Redis read failed; using in-memory session state:', error);
  }

  const fallback = memorySessions.get(sessionId);
  return fallback ? cloneSession(fallback) : null;
}

async function writeSession(sessionId: string, state: SessionState): Promise<void> {
  const snapshot = cloneSession(state);
  memorySessions.set(sessionId, snapshot);
  try {
    await redis.set(sessionKey(sessionId), JSON.stringify(snapshot));
  } catch (error) {
    console.error('WRDLINK Redis write failed; session kept in memory:', error);
  }
}

function responseFor(
  state: SessionState,
  patch: Partial<MoveValidationResponse> = {}
): MoveValidationResponse {
  const current = state.words[state.words.length - 1] ?? state.puzzle.start;
  const path = state.completed ? null : shortestPath(
    current,
    state.puzzle.target,
    DICTIONARY,
    state.words.slice(0, -1)
  );
  return {
    valid: true,
    complete: state.completed,
    message: '',
    movesUsed: state.words.length - 1,
    pointsAwarded: 0,
    gameScore: state.gameScore,
    reset: false,
    failed: false,
    words: [...state.words],
    level: state.level,
    hintsUsed: state.hintsUsed,
    hintCost: calculateHintCost(state.hintsUsed),
    hintWord: path && path.length > 1 ? path[1] ?? null : null,
    ...patch,
  };
}

function invalidResponse(message: string, state?: SessionState): MoveValidationResponse {
  return {
    valid: false,
    complete: false,
    message,
    movesUsed: state ? state.words.length - 1 : 0,
    pointsAwarded: 0,
    gameScore: state?.gameScore ?? 0,
    reset: false,
    failed: false,
    words: state ? [...state.words] : [],
    level: state?.level ?? 1,
    hintsUsed: state?.hintsUsed ?? 0,
    hintCost: calculateHintCost(state?.hintsUsed ?? 0),
    hintWord: null,
  };
}

function isSessionRequest(value: unknown): value is { sessionId: string; puzzleId: string } {
  return isRecord(value) && typeof value.sessionId === 'string' &&
    sessionPattern.test(value.sessionId) && typeof value.puzzleId === 'string';
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

api.get('/init', async (c) => {
  const requested = c.req.query('sessionId');
  const newGame = c.req.query('newGame') === 'true';
  const nextLevel = c.req.query('nextLevel') === 'true';
  const sessionId = requested && sessionPattern.test(requested) ? requested : randomUUID();
  const previous = await readSession(sessionId);

  let state: SessionState;
  if (newGame || !previous) {
    state = {
      gameScore: 25,
      level: 1,
      puzzle: createRandomPuzzle(),
      words: [],
      completed: false,
      hintsUsed: 0,
    };
    state.words = [state.puzzle.start];
  } else if (nextLevel && previous.completed) {
    const puzzle = createRandomPuzzle();
    state = {
      ...previous,
      puzzle,
      level: previous.level + 1,
      words: [puzzle.start],
      completed: false,
    };
  } else {
    state = previous;
  }

  assertPuzzleDefinition(state.puzzle, DICTIONARY);
  await writeSession(sessionId, state);

  const response: InitResponse = {
    type: 'init',
    puzzle: state.puzzle,
    sessionId,
    gameScore: state.gameScore,
    level: state.level,
    words: [...state.words],
    hintsUsed: state.hintsUsed,
    movesUsed: state.words.length - 1,
    completed: state.completed,
  };
  return c.json(response);
});

api.post('/validate', async (c) => {
  const body: unknown = await readJson(c);
  if (!isSessionRequest(body) || !('word' in body) || typeof body.word !== 'string') {
    return c.json(invalidResponse('Enter a word to continue.'));
  }

  const word = body.word.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(word)) {
    return c.json(invalidResponse('Enter a valid four letter word.'));
  }

  const state = await readSession(body.sessionId);
  if (!state || state.puzzle.id !== body.puzzleId || state.completed) {
    return c.json(invalidResponse('That puzzle session is not available.', state ?? undefined));
  }

  const candidateChain = [...state.words, word];
  const result = validateSequence(state.puzzle, DICTIONARY, candidateChain);
  if (!result.valid) {
    return c.json(invalidResponse(result.message, state));
  }

  state.words = candidateChain;
  // Every accepted move costs one point immediately.
  state.gameScore = calculateMoveScore(state.gameScore);
  if (result.complete) {
    // The web campaign awards 25 points on top of the remaining level balance.
    state.gameScore = calculateCompletionScore(state.gameScore);
    state.completed = true;
  }

  await writeSession(body.sessionId, state);
  return c.json(responseFor(state, {
    complete: result.complete,
    pointsAwarded: result.complete ? 25 : 0,
    message: result.complete
      ? `${result.message} +25 points. Level balance: ${state.gameScore}.`
      : 'Valid move.',
    hintWord: null,
  }));
});

api.post('/hint', async (c) => {
  const body: unknown = await readJson(c);
  if (!isSessionRequest(body)) {
    return c.json({
      valid: false, complete: false, message: 'The hint request was invalid.',
      word: null, hintCost: 5, totalCost: 6, pointsAwarded: 0,
      gameScore: 0, hintsUsed: 0, words: [],
    });
  }

  const state = await readSession(body.sessionId);
  if (!state || state.puzzle.id !== body.puzzleId || state.completed) {
    return c.json({
      valid: false, complete: false, message: 'That puzzle session is not available.',
      word: null, hintCost: calculateHintCost(state?.hintsUsed ?? 0),
      totalCost: calculateHintCost(state?.hintsUsed ?? 0) + 1,
      pointsAwarded: 0, gameScore: state?.gameScore ?? 0,
      hintsUsed: state?.hintsUsed ?? 0, words: state ? [...state.words] : [],
    });
  }

  const current = state.words[state.words.length - 1];
  const word = current ? responseFor(state).hintWord : null;
  const hintCost = calculateHintCost(state.hintsUsed);
  const totalCost = calculateHintTotalCost(state.hintsUsed);

  if (!word) {
    return c.json({
      valid: false, complete: false, message: 'No unused route to the target remains.',
      word: null, hintCost, totalCost, pointsAwarded: 0,
      gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
    });
  }
  const scoreAfterHint = applyHintCost(state.gameScore, state.hintsUsed);
  if (scoreAfterHint === null) {
    return c.json({
      valid: false, complete: false,
      message: `Not enough score. This hint and its move cost ${totalCost} points, but your current score is ${state.gameScore}.`,
      word: null, hintCost, totalCost, pointsAwarded: 0,
      gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
    });
  }

  const candidateChain = [...state.words, word];
  const result = validateSequence(state.puzzle, DICTIONARY, candidateChain);
  if (!result.valid) {
    return c.json({
      valid: false, complete: false, message: 'The suggested word could not be validated.',
      word: null, hintCost, totalCost, pointsAwarded: 0,
      gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
    }, 500);
  }

  state.words = candidateChain;
  state.hintsUsed += 1;
  // The hint price excludes the separate one point move penalty.
  state.gameScore = scoreAfterHint;
  if (result.complete) {
    state.gameScore = calculateCompletionScore(state.gameScore);
    state.completed = true;
  }

  await writeSession(body.sessionId, state);
  return c.json({
    valid: true,
    complete: result.complete,
    message: `Hint used: ${word}. ${totalCost} points deducted, including the submitted move.`,
    word,
    hintCost,
    totalCost,
    pointsAwarded: result.complete ? 25 : 0,
    gameScore: state.gameScore,
    hintsUsed: state.hintsUsed,
    words: [...state.words],
  });
});
