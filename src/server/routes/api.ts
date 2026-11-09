import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type { HintResponse, InitResponse, MoveValidationResponse, Puzzle } from '../../shared/api';
import { createRandomPuzzle, DICTIONARY } from '../data/puzzles';
import {
  assertPuzzleDefinition,
  applyHintCost,
  calculateCompletionScore,
  calculateHintCost,
  calculateHintTotalCost,
  calculateMoveScore,
  shortestPath,
  validateSequence,
} from '../core/game';

export const api = new Hono();

api.onError((error, context) => {
  console.error('WRDLINK API request failed:', error);
  return context.json({
    error: 'The game service is temporarily unavailable. Please try again shortly.',
    code: 'SERVICE_UNAVAILABLE',
  }, 503);
});

type SessionState = {
  gameScore: number;
  level: number;
  puzzle: Puzzle;
  words: string[];
  completed: boolean;
  hintsUsed: number;
};

type MutationResult<T> = { state?: SessionState; result: T };

const sessionPattern = /^(?:[a-f0-9-]{20,80}|session-[a-z0-9-]{10,80})$/i;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 60;
// Rate limits are scoped to the authenticated player (or anonymous session).\n// Avoid installation wide ceilings that let one busy subreddit throttle everyone.

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
      !Number.isSafeInteger(value.hintsUsed) || value.hintsUsed < 0) return false;

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
      value.words[0] !== puzzle.start) return false;

  if (value.words.length === 1) return !value.completed;
  const validation = validateSequence(puzzle, DICTIONARY, value.words);
  return validation.valid && validation.complete === value.completed;
}

function sessionKey(sessionId: string): string {
  return `wrdlink:session:${sessionId}`;
}

function accountSessionKey(userId: string): string {
  return `wrdlink:account:${userId}`;
}

/** Resolve a campaign from Devvit's authenticated account identity. */
async function resolveSessionId(requested?: string): Promise<string> {
  const userId = context.userId;
  if (!userId) return requested && sessionPattern.test(requested) ? requested : randomUUID();

  const accountKey = accountSessionKey(userId);
  const linked = await redis.get(accountKey);
  if (linked) {
    if (!sessionPattern.test(linked)) throw new Error('Could not restore the account game session.');
    const ownerKey = sessionOwnerKey(linked);
    await redis.set(ownerKey, userId, {
      nx: true,
      expiration: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    });
    if (await redis.get(ownerKey) !== userId) {
      throw new Error('This account session is already assigned to another player.');
    }
    await redis.expire(accountKey, SESSION_TTL_SECONDS);
    await redis.expire(ownerKey, SESSION_TTL_SECONDS);
    return linked;
  }

  // Claim a legacy browser session only if no other Reddit account owns it.
  // If it is already claimed, start a fresh private campaign instead.
  const preferred = requested && sessionPattern.test(requested) ? requested : randomUUID();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = attempt === 0 ? preferred : randomUUID();
    const ownerKey = sessionOwnerKey(candidate);
    await redis.set(ownerKey, userId, {
      nx: true,
      expiration: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    });
    const owner = await redis.get(ownerKey);
    if (owner !== userId) continue;

    await redis.set(accountKey, candidate, {
      nx: true,
      expiration: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    });
    const winner = await redis.get(accountKey);
    if (!winner || !sessionPattern.test(winner)) {
      throw new Error('Could not restore the account game session.');
    }
    if (winner !== candidate) {
      // Another concurrent request linked this account first. Its session wins.
      const winnerOwnerKey = sessionOwnerKey(winner);
      await redis.set(winnerOwnerKey, userId, {
        nx: true,
        expiration: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
      });
      if (await redis.get(winnerOwnerKey) !== userId) {
        throw new Error('This account session is already assigned to another player.');
      }
    }
    await redis.expire(accountKey, SESSION_TTL_SECONDS);
    await redis.expire(sessionOwnerKey(winner), SESSION_TTL_SECONDS);
    return winner;
  }
  throw new Error('Could not safely claim a game session. Please retry.');
}

async function sessionBelongsToCurrentUser(sessionId: string): Promise<boolean> {
  const userId = context.userId;
  if (!userId) return true;
  const [linkedSessionId, ownerId] = await Promise.all([
    redis.get(accountSessionKey(userId)),
    redis.get(sessionOwnerKey(sessionId)),
  ]);
  return linkedSessionId === sessionId && ownerId === userId;
}

function rateLimitSubject(sessionId: string): string {
  return context.userId ? `user:${context.userId}` : sessionId;
}

async function refreshAccountSessionLink(sessionId: string): Promise<void> {
  const userId = context.userId;
  if (!userId) return;
  const key = accountSessionKey(userId);
  if (await redis.get(key) === sessionId) await redis.expire(key, SESSION_TTL_SECONDS);
}

/**
 * Optimistic Redis transaction. WATCH protects the session snapshot from the
 * first read through EXEC, so concurrent requests cannot overwrite each other.
 * A null EXEC means another request changed the key and this mutation retries.
 */
async function updateSession<T>(
  sessionId: string,
  update: (state: SessionState | null) => MutationResult<T>
): Promise<T> {
  const key = sessionKey(sessionId);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const txn = await redis.watch(key);
    const raw = await txn.get(key);
    let current: SessionState | null = null;
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (isSessionState(parsed)) current = cloneSession(parsed);
    }

    let outcome: MutationResult<T>;
    try {
      outcome = update(current);
    } catch (error) {
      await txn.unwatch();
      throw error;
    }
    if (!outcome.state) {
      await txn.unwatch();
      return outcome.result;
    }

    await txn.multi();
    await txn.set(key, JSON.stringify(cloneSession(outcome.state)));
    await txn.expire(key, SESSION_TTL_SECONDS);
    const committed = await txn.exec();
    if (committed !== null) {
      await refreshAccountSessionLink(sessionId);
      return outcome.result;
    }
  }
  throw new Error('The game session changed repeatedly. Please retry.');
}

/** Per player fixed window counter. Increment and expiry are committed together. */
async function consumeRateLimit(key: string, limit: number): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const txn = await redis.watch(key);
    const raw = await txn.get(key);
    const current = raw ? Number.parseInt(raw, 10) : 0;
    const safeCurrent = Number.isSafeInteger(current) && current > 0 ? current : 0;
    const ttl = await txn.expireTime(key);
    await txn.multi();
    await txn.incrBy(key, 1);
    if (safeCurrent === 0 || ttl <= 0) await txn.expire(key, RATE_WINDOW_SECONDS);
    const committed = await txn.exec();
    if (committed !== null) return safeCurrent + 1 <= limit;
  }
  throw new Error('Rate limit state is busy. Please retry.');
}

function rateLimitKey(sessionId: string, action: string): string {
  return `wrdlink:rate:${action}:${sessionId}`;
}

async function allowedRequest(sessionId: string, action: string, limit: number): Promise<boolean> {
  return consumeRateLimit(rateLimitKey(rateLimitSubject(sessionId), action), limit);
}

function responseFor(
  state: SessionState,
  patch: Partial<MoveValidationResponse> = {}
): MoveValidationResponse {
  return {
    valid: true,
    complete: state.completed,
    message: '',
    movesUsed: state.words.length - 1,
    pointsAwarded: 0,
    gameScore: state.gameScore,
    words: [...state.words],
    level: state.level,
    hintsUsed: state.hintsUsed,
    hintCost: calculateHintCost(state.hintsUsed),
    hintWord: null,
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
  const sessionId = await resolveSessionId(requested);

  if (!await allowedRequest(sessionId, 'init', 12)) {
    c.header('Retry-After', String(RATE_WINDOW_SECONDS));
    return c.json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  const result = await updateSession(sessionId, (previous) => {
    let state: SessionState;
    if (!previous || newGame) {
      state = {
        gameScore: 25,
        level: 1,
        puzzle: createRandomPuzzle(1),
        words: [],
        completed: false,
        hintsUsed: 0,
      };
      state.words = [state.puzzle.start];
    } else if (nextLevel && previous.completed) {
      const puzzle = createRandomPuzzle(previous.level + 1);
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
    return { state, result: response };
  });
  return c.json(result);
});

api.post('/validate', async (c) => {
  const body: unknown = await readJson(c);
  if (!isSessionRequest(body) || !('word' in body) || typeof body.word !== 'string') {
    return c.json(invalidResponse('Enter a word to continue.'));
  }
  if (!await sessionBelongsToCurrentUser(body.sessionId)) {
    return c.json(invalidResponse('That puzzle session is not available.'));
  }
  if (!await allowedRequest(body.sessionId, 'validate', 30)) {
    c.header('Retry-After', String(RATE_WINDOW_SECONDS));
    return c.json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  const word = body.word.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(word)) return c.json(invalidResponse('Enter a valid four letter word.'));

  const result = await updateSession(body.sessionId, (stored) => {
    if (!stored || stored.puzzle.id !== body.puzzleId || stored.completed) {
      return { result: invalidResponse('That puzzle session is not available.', stored ?? undefined) };
    }
    const state = cloneSession(stored);
    const validation = validateSequence(state.puzzle, DICTIONARY, [...state.words, word]);
    if (!validation.valid) return { result: invalidResponse(validation.message, state) };

    state.words = [...state.words, word];
    state.gameScore = calculateMoveScore(state.gameScore);
    if (validation.complete) {
      state.gameScore = calculateCompletionScore(state.gameScore);
      state.completed = true;
    }

    return {
      state,
      result: responseFor(state, {
        complete: validation.complete,
        pointsAwarded: validation.complete ? 25 : 0,
        message: validation.complete
          ? `${validation.message} +25 points. Level balance: ${state.gameScore}.`
          : state.gameScore === 0
            ? 'Valid move. Your score is zero, so hints are unavailable until you earn more points by completing a level.'
            : 'Valid move.',
      }),
    };
  });
  return c.json(result);
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
  if (!await sessionBelongsToCurrentUser(body.sessionId)) {
    return c.json({ error: 'That puzzle session is not available.' }, 403);
  }
  if (!await allowedRequest(body.sessionId, 'hint', 8)) {
    c.header('Retry-After', String(RATE_WINDOW_SECONDS));
    return c.json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  const result = await updateSession<HintResponse>(body.sessionId, (stored) => {
    const hintCost = calculateHintCost(stored?.hintsUsed ?? 0);
    const totalCost = calculateHintTotalCost(stored?.hintsUsed ?? 0);
    if (!stored || stored.puzzle.id !== body.puzzleId || stored.completed) {
      return { result: {
        valid: false, complete: false, message: 'That puzzle session is not available.',
        word: null, hintCost, totalCost, pointsAwarded: 0,
        gameScore: stored?.gameScore ?? 0, hintsUsed: stored?.hintsUsed ?? 0,
        words: stored ? [...stored.words] : [],
      } };
    }

    const state = cloneSession(stored);
    const current = state.words[state.words.length - 1];
    const path = current
      ? shortestPath(current, state.puzzle.target, DICTIONARY, state.words.slice(0, -1))
      : null;
    const word = path && path.length > 1 ? path[1] ?? null : null;
    if (!word) {
      return { result: {
        valid: false, complete: false, message: 'No unused route to the target remains.',
        word: null, hintCost, totalCost, pointsAwarded: 0,
        gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
      } };
    }

    const scoreAfterHint = applyHintCost(state.gameScore, state.hintsUsed);
    if (scoreAfterHint === null) {
      return { result: {
        valid: false, complete: false,
        message: `Not enough score. This hint and its move cost ${totalCost} points, but your current score is ${state.gameScore}.`,
        word: null, hintCost, totalCost, pointsAwarded: 0,
        gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
      } };
    }

    const validation = validateSequence(state.puzzle, DICTIONARY, [...state.words, word]);
    if (!validation.valid) {
      return { result: {
        valid: false, complete: false, message: 'The suggested word could not be validated.',
        word: null, hintCost, totalCost, pointsAwarded: 0,
        gameScore: state.gameScore, hintsUsed: state.hintsUsed, words: [...state.words],
      } };
    }

    state.words = [...state.words, word];
    state.hintsUsed += 1;
    state.gameScore = scoreAfterHint;
    if (validation.complete) {
      state.gameScore = calculateCompletionScore(state.gameScore);
      state.completed = true;
    }

    return {
      state,
      result: {
        valid: true,
        complete: validation.complete,
        message: `Hint used: ${word}. ${totalCost} points deducted, including the submitted move.`,
        word,
        hintCost,
        totalCost,
        pointsAwarded: validation.complete ? 25 : 0,
        gameScore: state.gameScore,
        hintsUsed: state.hintsUsed,
        words: [...state.words],
      },
    };
  });
  return c.json(result);
});
