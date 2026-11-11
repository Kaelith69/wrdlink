import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type { Puzzle } from '../../shared/api';
import {
  calculateCompletionScore,
  calculateMoveScore,
  validateSequence,
} from '../core/game';
import {
  aggregateRankScore,
  dailyRankScore,
  earnedBadges,
  isoWeekKey,
  parseDateKey,
  updateDailyStreak,
  utcDateKey,
  type DailyProfile,
} from '../core/daily';
import { createDailyPuzzle, DICTIONARY } from '../data/puzzles';

export const dailyApi = new Hono();

type DailyState = {
  puzzle: Puzzle;
  words: string[];
  score: number;
  completed: boolean;
  startedAt: number;
  completedAt: number | null;
};

type DailyResult = {
  date: string;
  userId: string;
  username: string;
  start: string;
  target: string;
  words: string[];
  moves: number;
  score: number;
  optimalMoves: number;
  hintsUsed: number;
  completedAt: number;
};

const SESSION_PATTERN = /^(?:[a-f0-9-]{20,80}|session-[a-z0-9-]{10,80})$/i;
const DAILY_TTL_SECONDS = 60 * 24 * 60 * 60;
const RATE_WINDOW_SECONDS = 60;
const DEFAULT_PROFILE: DailyProfile = {
  totalCompleted: 0,
  totalScore: 0,
  totalMoves: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastDailyDate: null,
  graceTokens: 0,
  badges: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((word) => typeof word === 'string');
}

function isDailyResult(value: unknown): value is DailyResult {
  return isRecord(value) && typeof value.date === 'string' && parseDateKey(value.date) !== null &&
    typeof value.userId === 'string' && typeof value.username === 'string' &&
    typeof value.start === 'string' && typeof value.target === 'string' && isStringArray(value.words) &&
    Number.isSafeInteger(value.moves) && Number.isSafeInteger(value.score) &&
    Number.isSafeInteger(value.optimalMoves) && Number.isSafeInteger(value.hintsUsed) &&
    typeof value.completedAt === 'number' && Number.isFinite(value.completedAt);
}

function isDailyState(value: unknown, expectedPuzzle: Puzzle): value is DailyState {
  if (!isRecord(value) || !isStringArray(value.words) ||
      typeof value.score !== 'number' || !Number.isSafeInteger(value.score) || value.score < 0 ||
      typeof value.completed !== 'boolean' || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt) ||
      !(value.completedAt === null || (typeof value.completedAt === 'number' && Number.isFinite(value.completedAt))) ||
      !isRecord(value.puzzle) || value.puzzle.id !== expectedPuzzle.id ||
      value.puzzle.start !== expectedPuzzle.start || value.puzzle.target !== expectedPuzzle.target ||
      value.puzzle.wordLength !== expectedPuzzle.wordLength || value.puzzle.optimalMoves !== expectedPuzzle.optimalMoves ||
      value.words[0] !== expectedPuzzle.start) return false;
  const validation = value.words.length === 1
    ? { valid: true, complete: false }
    : validateSequence(expectedPuzzle, DICTIONARY, value.words);
  return validation.valid && validation.complete === value.completed;
}

function identityKey(sessionId: string): string {
  return context.userId ?? 'anonymous-' + sessionId;
}

function stateKey(date: string, sessionId: string): string {
  return `wrdlink:v2:daily:session:${date}:${identityKey(sessionId)}`;
}

function resultKey(date: string, userId: string): string {
  return `wrdlink:v2:daily:result:${date}:${userId}`;
}

async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const lockKey = key + ':lock';
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await redis.set(lockKey, token, {
      nx: true,
      expiration: new Date(Date.now() + 30_000),
    }) === 'OK') {
      acquired = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!acquired) throw new Error('Your daily challenge is busy. Please retry.');
  try {
    return await operation();
  } finally {
    if (await redis.get(lockKey) === token) await redis.del(lockKey);
  }
}

async function limited(subject: string, action: string, limit: number): Promise<boolean> {
  const key = `wrdlink:v2:rate:${action}:${subject}`;
  const count = await redis.incrBy(key, 1);
  if (count === 1 || await redis.expireTime(key) <= 0) await redis.expire(key, RATE_WINDOW_SECONDS);
  return count <= limit;
}

async function getSharedDailyPuzzle(date: string): Promise<Puzzle> {
  const key = `wrdlink:v2:daily:puzzle:${date}`;
  const readStored = async (): Promise<Puzzle | null> => {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && parsed.id === `daily-${date}` &&
          parsed.title === 'WRDLINK Daily Challenge' && typeof parsed.start === 'string' &&
          typeof parsed.target === 'string' && parsed.wordLength === 4 &&
          typeof parsed.optimalMoves === 'number' && Number.isSafeInteger(parsed.optimalMoves) &&
          DICTIONARY.has(parsed.start) && DICTIONARY.has(parsed.target)) {
        return {
          id: parsed.id,
          title: parsed.title,
          start: parsed.start,
          target: parsed.target,
          wordLength: 4,
          optimalMoves: parsed.optimalMoves,
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  const existing = await readStored();
  if (existing) return existing;
  const generated = createDailyPuzzle(date);
  const stored = await redis.set(key, JSON.stringify(generated), {
    nx: true,
    expiration: new Date(Date.now() + DAILY_TTL_SECONDS * 1000),
  });
  if (stored === 'OK') return generated;
  return await readStored() ?? generated;
}

function defaultState(puzzle: Puzzle): DailyState {
  return {
    puzzle,
    words: [puzzle.start],
    score: 25,
    completed: false,
    startedAt: Date.now(),
    completedAt: null,
  };
}

async function readProfile(userId: string): Promise<DailyProfile> {
  const raw = await redis.hGet('wrdlink:v2:profiles', userId);
  if (!raw) return { ...DEFAULT_PROFILE, badges: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_PROFILE, badges: [] };
    return {
      totalCompleted: Number.isSafeInteger(parsed.totalCompleted) ? Number(parsed.totalCompleted) : 0,
      totalScore: Number.isSafeInteger(parsed.totalScore) ? Number(parsed.totalScore) : 0,
      totalMoves: Number.isSafeInteger(parsed.totalMoves) ? Number(parsed.totalMoves) : 0,
      currentStreak: Number.isSafeInteger(parsed.currentStreak) ? Number(parsed.currentStreak) : 0,
      bestStreak: Number.isSafeInteger(parsed.bestStreak) ? Number(parsed.bestStreak) : 0,
      lastDailyDate: typeof parsed.lastDailyDate === 'string' ? parsed.lastDailyDate : null,
      graceTokens: Number.isSafeInteger(parsed.graceTokens) ? Number(parsed.graceTokens) : 0,
      badges: Array.isArray(parsed.badges) ? parsed.badges.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_PROFILE, badges: [] };
  }
}

async function saveVerifiedCompletion(
  date: string,
  userId: string,
  username: string,
  state: DailyState
): Promise<{ result: DailyResult; profile: DailyProfile; newBadges: string[]; graceUsed: boolean; graceEarned: boolean }> {
  const key = resultKey(date, userId);
  const existing = await redis.get(key);
  if (existing) {
    try {
      const previous: unknown = JSON.parse(existing);
      if (!isDailyResult(previous)) throw new Error('Stored daily result is invalid.');
      return {
        result: previous,
        profile: await readProfile(userId),
        newBadges: [],
        graceUsed: false,
        graceEarned: false,
      };
    } catch {
      // A malformed legacy result is not trusted. The immutable completion below replaces it.
    }
  }

  const result: DailyResult = {
    date,
    userId,
    username,
    start: state.puzzle.start,
    target: state.puzzle.target,
    words: [...state.words],
    moves: state.words.length - 1,
    score: state.score,
    optimalMoves: state.puzzle.optimalMoves,
    hintsUsed: 0,
    completedAt: state.completedAt ?? Date.now(),
  };
  const stored = await redis.set(key, JSON.stringify(result), {
    nx: true,
    expiration: new Date(Date.now() + DAILY_TTL_SECONDS * 1000),
  });
  if (stored !== 'OK') {
    const duplicate = await redis.get(key);
    if (!duplicate) throw new Error('Could not safely record your daily result.');
    const previous: unknown = JSON.parse(duplicate);
    if (!isDailyResult(previous)) throw new Error('Stored daily result is invalid.');
    return {
      result: previous,
      profile: await readProfile(userId),
      newBadges: [],
      graceUsed: false,
      graceEarned: false,
    };
  }

  const previousProfile = await readProfile(userId);
  const streak = updateDailyStreak(previousProfile, date);
  const profile: DailyProfile = {
    totalCompleted: previousProfile.totalCompleted + 1,
    totalScore: previousProfile.totalScore + result.score,
    totalMoves: previousProfile.totalMoves + result.moves,
    currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak,
    lastDailyDate: streak.lastDailyDate,
    graceTokens: streak.graceTokens,
    badges: previousProfile.badges,
  };
  profile.badges = earnedBadges(profile, result.moves, result.optimalMoves, result.hintsUsed);
  const newBadges = profile.badges.filter((badge) => !previousProfile.badges.includes(badge));
  await redis.hSet('wrdlink:v2:profiles', { [userId]: JSON.stringify(profile) });

  const dailyPrefix = `wrdlink:v2:leaderboard:daily:${date}`;
  await redis.zAdd(dailyPrefix + ':score', { member: userId, score: dailyRankScore(result.score, result.moves, result.completedAt, 'score') });
  await redis.zAdd(dailyPrefix + ':moves', { member: userId, score: dailyRankScore(result.score, result.moves, result.completedAt, 'moves') });
  await redis.hSet(dailyPrefix + ':entries', { [userId]: JSON.stringify(result) });
  await redis.expire(dailyPrefix + ':score', DAILY_TTL_SECONDS);
  await redis.expire(dailyPrefix + ':moves', DAILY_TTL_SECONDS);
  await redis.expire(dailyPrefix + ':entries', DAILY_TTL_SECONDS);

  const week = isoWeekKey(date);
  const weeklyPrefix = `wrdlink:v2:leaderboard:weekly:${week}`;
  const previousWeekRaw = await redis.hGet(weeklyPrefix + ':entries', userId);
  const previousWeek: { username: string; totalScore: number; totalMoves: number; completedCount: number } = previousWeekRaw ? JSON.parse(previousWeekRaw) : { username, totalScore: 0, totalMoves: 0, completedCount: 0 };
  const weekly = {
    username,
    totalScore: previousWeek.totalScore + result.score,
    totalMoves: previousWeek.totalMoves + result.moves,
    completedCount: previousWeek.completedCount + 1,
  };
  await redis.hSet(weeklyPrefix + ':entries', { [userId]: JSON.stringify(weekly) });
  await redis.zAdd(weeklyPrefix + ':score', { member: userId, score: aggregateRankScore(weekly.totalScore, weekly.totalMoves, weekly.completedCount, 'score') });
  await redis.zAdd(weeklyPrefix + ':moves', { member: userId, score: aggregateRankScore(weekly.totalScore, weekly.totalMoves, weekly.completedCount, 'moves') });
  await redis.expire(weeklyPrefix + ':entries', DAILY_TTL_SECONDS);
  await redis.expire(weeklyPrefix + ':score', DAILY_TTL_SECONDS);
  await redis.expire(weeklyPrefix + ':moves', DAILY_TTL_SECONDS);

  const allPrefix = 'wrdlink:v2:leaderboard:alltime';
  const previousAllRaw = await redis.hGet(allPrefix + ':entries', userId);
  const previousAll: { username: string; totalScore: number; totalMoves: number; completedCount: number } = previousAllRaw ? JSON.parse(previousAllRaw) : { username, totalScore: 0, totalMoves: 0, completedCount: 0 };
  const allTime = {
    username,
    totalScore: previousAll.totalScore + result.score,
    totalMoves: previousAll.totalMoves + result.moves,
    completedCount: previousAll.completedCount + 1,
  };
  await redis.hSet(allPrefix + ':entries', { [userId]: JSON.stringify(allTime) });
  await redis.zAdd(allPrefix + ':score', { member: userId, score: aggregateRankScore(allTime.totalScore, allTime.totalMoves, allTime.completedCount, 'score') });
  await redis.zAdd(allPrefix + ':moves', { member: userId, score: aggregateRankScore(allTime.totalScore, allTime.totalMoves, allTime.completedCount, 'moves') });

  return { result, profile, newBadges, graceUsed: streak.graceUsed, graceEarned: streak.graceEarned };
}

function parseSession(raw: string | null | undefined, puzzle: Puzzle): DailyState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDailyState(parsed, puzzle) ? parsed : null;
  } catch {
    return null;
  }
}

async function leaderboard(period: 'daily' | 'weekly' | 'alltime', metric: 'score' | 'moves', date: string) {
  const periodKey = period === 'daily' ? date : isoWeekKey(date);
  const prefix = period === 'alltime'
    ? 'wrdlink:v2:leaderboard:alltime'
    : `wrdlink:v2:leaderboard:${period}:${periodKey}`;
  const [ranked, currentUserId] = await Promise.all([
    redis.zRange(prefix + ':' + metric, 0, 19, { by: 'rank' }),
    Promise.resolve(context.userId),
  ]);
  const entries = await Promise.all(ranked.map(async (item, index) => {
    const raw = await redis.hGet(prefix + ':entries', item.member);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      return {
        rank: index + 1,
        username: typeof parsed.username === 'string' ? parsed.username : 'WRDLINK Player',
        score: typeof parsed.score === 'number' ? parsed.score : Number(parsed.totalScore ?? 0),
        moves: typeof parsed.moves === 'number' ? parsed.moves : Number(parsed.completedCount) > 0 ? Number((Number(parsed.totalMoves ?? 0) / Number(parsed.completedCount)).toFixed(2)) : 0,
        completedCount: typeof parsed.completedCount === 'number' ? parsed.completedCount : 1,
      };
    } catch {
      return null;
    }
  }));
  const rank = currentUserId ? await redis.zRank(prefix + ':' + metric, currentUserId) : null;
  return {
    period,
    metric,
    entries: entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    currentUserRank: rank === null || rank === undefined ? null : rank + 1,
  };
}

dailyApi.post('/init', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body) || typeof body.sessionId !== 'string' || !SESSION_PATTERN.test(body.sessionId)) {
    return c.json({ error: 'Invalid daily challenge session.' }, 400);
  }
  const date = utcDateKey();
  const puzzle = await getSharedDailyPuzzle(date);
  const key = stateKey(date, body.sessionId);
  if (!await limited(identityKey(body.sessionId), 'daily-init', 30)) {
    c.header('Retry-After', String(RATE_WINDOW_SECONDS));
    return c.json({ error: 'Too many requests. Please try again shortly.' }, 429);
  }
  const state = await withLock(key, async () => {
    const current = parseSession(await redis.get(key), puzzle);
    const next = current ?? defaultState(puzzle);
    await redis.set(key, JSON.stringify(next), { expiration: new Date(Date.now() + DAILY_TTL_SECONDS * 1000) });
    return next;
  });
  const currentUserId = context.userId;
  if (currentUserId && state.completed && !await redis.get(resultKey(date, currentUserId))) {
    const username = await reddit.getCurrentUsername() ?? 'WRDLINK Player';
    await withLock(key, async () => {
      const latest = parseSession(await redis.get(key), puzzle);
      if (latest?.completed) await saveVerifiedCompletion(date, currentUserId, username, latest);
    });
  }
  let profile: DailyProfile = DEFAULT_PROFILE;
  let currentResult: string | null | undefined;
  if (currentUserId) {
    [profile, currentResult] = await Promise.all([
      readProfile(currentUserId),
      redis.get(resultKey(date, currentUserId)),
    ]);
  }
  let result: DailyResult | null = null;
  if (currentResult) {
    try {
      const parsed: unknown = JSON.parse(currentResult);
      if (isDailyResult(parsed)) result = parsed;
    } catch { result = null; }
  }
  if (!result && state.completed) {
    result = {
      date, userId: context.userId ?? '', username: '', start: puzzle.start, target: puzzle.target,
      words: [...state.words], moves: state.words.length - 1, score: state.score,
      optimalMoves: puzzle.optimalMoves, hintsUsed: 0, completedAt: state.completedAt ?? Date.now(),
    };
  }
  return c.json({
    date,
    puzzle,
    words: state.words,
    score: state.score,
    completed: state.completed,
    moves: state.words.length - 1,
    result,
    profile,
    ranked: Boolean(context.userId),
  });
});

dailyApi.post('/validate', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body) || typeof body.sessionId !== 'string' || !SESSION_PATTERN.test(body.sessionId) ||
      typeof body.date !== 'string' || typeof body.puzzleId !== 'string' ||
      typeof body.word !== 'string' || body.word.length > 12) {
    return c.json({ error: 'Invalid daily move.' }, 400);
  }
  const date = utcDateKey();
  if (body.date !== date || parseDateKey(body.date) === null) {
    return c.json({ error: 'This daily challenge has expired. Load today’s puzzle.' }, 409);
  }
  if (!await limited(identityKey(body.sessionId), 'daily-validate', 40)) {
    c.header('Retry-After', String(RATE_WINDOW_SECONDS));
    return c.json({ error: 'Too many attempts. Please wait before trying again.' }, 429);
  }
  const puzzle = await getSharedDailyPuzzle(date);
  if (body.puzzleId !== puzzle.id) return c.json({ error: 'Daily puzzle mismatch.' }, 409);
  const key = stateKey(date, body.sessionId);
  const username = context.userId ? await reddit.getCurrentUsername() : undefined;
  const word = body.word.trim().toUpperCase();

  const response = await withLock(key, async () => {
    const state = parseSession(await redis.get(key), puzzle);
    if (!state || state.completed) {
      return { valid: false, complete: false, message: 'This daily puzzle is already complete or unavailable.', words: state?.words ?? [puzzle.start], score: state?.score ?? 25, result: null, profile: null, newBadges: [] as string[] };
    }
    const next = { ...state, words: [...state.words], score: calculateMoveScore(state.score) };
    const validation = validateSequence(puzzle, DICTIONARY, [...next.words, word]);
    if (!validation.valid) {
      await redis.set(key, JSON.stringify(next), { expiration: new Date(Date.now() + DAILY_TTL_SECONDS * 1000) });
      return { valid: false, complete: false, message: validation.message, words: next.words, score: next.score, result: null, profile: null, newBadges: [] as string[] };
    }
    next.words.push(word);
    next.completed = validation.complete;
    if (validation.complete) {
      next.score = calculateCompletionScore(next.score);
      next.completedAt = Date.now();
    }
    await redis.set(key, JSON.stringify(next), { expiration: new Date(Date.now() + DAILY_TTL_SECONDS * 1000) });
    const completion = validation.complete && context.userId
      ? await saveVerifiedCompletion(date, context.userId, username ?? 'WRDLINK Player', next)
      : null;
    return {
      valid: true,
      complete: validation.complete,
      message: validation.complete ? validation.message : 'Valid move.',
      words: next.words,
      score: next.score,
      result: completion?.result ?? (validation.complete ? {
        date, start: puzzle.start, target: puzzle.target, words: next.words,
        moves: next.words.length - 1, score: next.score, optimalMoves: puzzle.optimalMoves,
        hintsUsed: 0, completedAt: next.completedAt,
      } : null),
      profile: completion?.profile ?? null,
      newBadges: completion?.newBadges ?? [],
      graceUsed: completion?.graceUsed ?? false,
      graceEarned: completion?.graceEarned ?? false,
      ranked: Boolean(context.userId),
    };
  });
  return c.json(response);
});

dailyApi.get('/leaderboard', async (c) => {
  const periodValue = c.req.query('period') ?? 'daily';
  const metricValue = c.req.query('metric') ?? 'score';
  const period = periodValue === 'weekly' || periodValue === 'alltime' ? periodValue : 'daily';
  const metric = metricValue === 'moves' ? 'moves' : 'score';
  const date = utcDateKey();
  return c.json(await leaderboard(period, metric, date));
});

async function verifiedShareRecord(date: string): Promise<DailyResult | null> {
  if (!context.userId || parseDateKey(date) === null) return null;
  const raw = await redis.get(resultKey(date, context.userId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isDailyResult(parsed) ? parsed : null;
  } catch { return null; }
}

function shareText(result: DailyResult): string {
  const path = result.words.join(' → ');
  return [
    `WRDLINK Daily Challenge · ${result.date}`,
    `${result.start} → ${result.target}`,
    `Moves: ${result.moves} · Score: ${result.score}`,
    'Status: Completed',
    path,
    `Play WRDLINK: https://www.reddit.com/r/WRDLINK/`,
  ].join('\n\n');
}

dailyApi.post('/share/post', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body) || typeof body.date !== 'string') return c.json({ error: 'Invalid share request.' }, 400);
  if (!context.userId || !context.subredditName) return c.json({ error: 'Sign in to share your result.' }, 401);
  if (!await limited(context.userId, 'share-post', 3)) return c.json({ error: 'Sharing limit reached. Try again later.' }, 429);
  const result = await verifiedShareRecord(body.date);
  if (!result) return c.json({ error: 'A verified completion for today was not found.' }, 404);
  const text = shareText(result);
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `WRDLINK Daily ${result.date}: ${result.start} → ${result.target}`,
    entry: 'default',
    runAs: 'USER',
    userGeneratedContent: { text },
    textFallback: { text },
  });
  return c.json({ success: true, postId: post.id, permalink: post.permalink });
});

dailyApi.post('/share/comment', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body) || typeof body.date !== 'string') return c.json({ error: 'Invalid share request.' }, 400);
  if (!context.userId || !context.postId) return c.json({ error: 'Open WRDLINK from its Reddit post to share a comment.' }, 400);
  if (!await limited(context.userId, 'share-comment', 3)) return c.json({ error: 'Sharing limit reached. Try again later.' }, 429);
  const result = await verifiedShareRecord(body.date);
  if (!result) return c.json({ error: 'A verified completion for today was not found.' }, 404);
  const comment = await reddit.submitComment({
    id: context.postId,
    text: shareText(result),
    runAs: 'USER',
  });
  return c.json({ success: true, commentId: comment.id });
});
