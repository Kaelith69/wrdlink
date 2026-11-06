import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import type {
  InitResponse,
  MoveValidationResponse,
  ValidateRequest,
} from '../../shared/api';
import { createRandomPuzzle, DICTIONARY } from '../data/puzzles';
import { assertPuzzleDefinition, calculatePoints, validateSequence } from '../core/game';

export const api = new Hono();

type SessionState = {
  gameScore: number;
  level: number;
  puzzle: ReturnType<typeof createRandomPuzzle>;
  completed: boolean;
};

const sessionPattern = /^(?:[a-f0-9-]{20,80}|session-[a-z0-9-]{10,80})$/i;
const memorySessions = new Map<string, SessionState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSessionState(value: unknown): value is SessionState {
  return (
    isRecord(value) &&
    typeof value.gameScore === 'number' &&
    Number.isInteger(value.gameScore) &&
    typeof value.level === 'number' &&
    Number.isInteger(value.level) &&
    isRecord(value.puzzle) &&
    typeof value.puzzle.id === 'string' &&
    typeof value.puzzle.start === 'string' &&
    typeof value.puzzle.target === 'string' &&
    typeof value.puzzle.wordLength === 'number' &&
    typeof value.puzzle.optimalMoves === 'number' &&
    typeof value.completed === 'boolean'
  );
}

function isValidateRequest(value: unknown): value is ValidateRequest {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    sessionPattern.test(value.sessionId) &&
    typeof value.puzzleId === 'string' &&
    isStringArray(value.words)
  );
}

function sessionKey(sessionId: string): string {
  return `wrdlink:session:${sessionId}`;
}

async function readSession(sessionId: string): Promise<SessionState | null> {
  try {
    const raw = await redis.get(sessionKey(sessionId));
    if (!raw) return memorySessions.get(sessionId) ?? null;
    const parsed: unknown = JSON.parse(raw);
    if (isSessionState(parsed)) return parsed;
  } catch (error) {
    console.error('WRDLINK Redis read failed; using in-memory session state:', error);
  }
  return memorySessions.get(sessionId) ?? null;
}

async function writeSession(sessionId: string, state: SessionState): Promise<void> {
  memorySessions.set(sessionId, state);
  try {
    await redis.set(sessionKey(sessionId), JSON.stringify(state));
  } catch (error) {
    console.error('WRDLINK Redis write failed; session kept in memory:', error);
  }
}

function invalidResponse(message: string, gameScore = 0): MoveValidationResponse {
  return {
    valid: false,
    complete: false,
    message,
    movesUsed: 0,
    pointsAwarded: 0,
    gameScore,
    reset: true,
    failed: false,
  };
}

api.get('/init', async (c) => {
  const requestedSessionId = c.req.query('sessionId');
  const isNewGame = c.req.query('newGame') === 'true';
  const sessionId = requestedSessionId && sessionPattern.test(requestedSessionId)
    ? requestedSessionId
    : randomUUID();
  const previous = await readSession(sessionId);
  const currentPuzzle = !isNewGame && previous && !previous.completed ? previous.puzzle : undefined;
  const puzzle = currentPuzzle ?? createRandomPuzzle();
  assertPuzzleDefinition(puzzle, DICTIONARY);
  const state: SessionState = {
    gameScore: isNewGame ? 0 : previous?.gameScore ?? 0,
    level: isNewGame ? 1 : currentPuzzle ? previous?.level ?? 1 : (previous?.level ?? 0) + 1,
    puzzle,
    completed: false,
  };
  await writeSession(sessionId, state);

  const response: InitResponse = {
    type: 'init',
    puzzle,
    sessionId,
    gameScore: state.gameScore,
    level: state.level,
  };

  return c.json(response);
});

api.post('/validate', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error('WRDLINK validation request could not be read:', error);
    return c.json(invalidResponse('The request could not be read.'));
  }

  if (!isValidateRequest(body)) {
    return c.json(invalidResponse('Enter a word to continue.'));
  }

  const state = await readSession(body.sessionId);
  const puzzle = state?.puzzle;
  if (!state || !puzzle || state.puzzle.id !== body.puzzleId || state.completed) {
    if (state && !state.completed) {
      await writeSession(body.sessionId, { ...state, gameScore: 0 });
    }
    return c.json(invalidResponse('That puzzle session is not available.'));
  }

  const result = validateSequence(puzzle, DICTIONARY, body.words);
  if (!result.valid) {
    if (result.failed) {
      await writeSession(body.sessionId, { ...state, gameScore: 0, completed: true });
      return c.json({ ...result, gameScore: 0, reset: true });
    }
    return c.json({ ...result, gameScore: state.gameScore, reset: false });
  }

  if (result.complete) {
    const pointsAwarded = calculatePoints(puzzle, result.movesUsed);
    const nextState = {
      ...state,
      gameScore: state.gameScore + pointsAwarded,
      completed: true,
    };
    await writeSession(body.sessionId, nextState);
    return c.json({
      ...result,
      message: `${result.message} +${pointsAwarded} points.`,
      pointsAwarded,
      gameScore: nextState.gameScore,
      reset: false,
    });
  }

  return c.json({ ...result, gameScore: state.gameScore, reset: false });
});
