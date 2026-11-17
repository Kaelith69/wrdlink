import { createHash, randomUUID } from 'node:crypto';
import { reddit, redis } from '@devvit/web/server';

const LOCK_TTL_MS = 30_000;
const SCORE_THREAD_TEXT = [
  '**WRDLINK score sharing thread**',
  '',
  'Post your automatically formatted game scores as replies here. Score comments are submitted only when a player chooses to comment, and appear under their Reddit username.',
].join('\n');

type ScoreSubmissionState =
  | { status: 'pending' }
  | { status: 'submitted'; commentId: string };

export class ScoreCommentPendingError extends Error {
  constructor(message = 'A previous score comment request may already have reached Reddit. Check the pinned WRDLINK score thread before trying again. WRDLINK will not automatically send a possible duplicate.') {
    super(message);
    this.name = 'ScoreCommentPendingError';
  }
}

export class ScoreCommentRateLimitError extends Error {
  constructor() {
    super('Sharing limit reached. Try again later.');
    this.name = 'ScoreCommentRateLimitError';
  }
}

function scoreSubmissionKey(postId: string, userId: string, scope: string): string {
  const digest = createHash('sha256')
    .update([postId, userId, scope].join('|'))
    .digest('hex');
  return `wrdlink:v1:score-submission:${digest}`;
}

function parseSubmissionState(raw: string): ScoreSubmissionState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('status' in value)) return null;
    const state = value as Record<string, unknown>;
    if (state.status === 'pending') return { status: 'pending' };
    if (state.status === 'submitted' && typeof state.commentId === 'string' &&
        /^t1_[a-z0-9]+$/i.test(state.commentId)) {
      return { status: 'submitted', commentId: state.commentId };
    }
  } catch {
    return null;
  }
  return null;
}

async function findExistingScoreReply(
  postId: string,
  parentCommentId: string,
  userId: string,
  text: string
): Promise<string | null> {
  const replies = await reddit.getComments({
    postId: postId as `t3_${string}`,
    commentId: parentCommentId as `t1_${string}`,
    limit: 1000,
    pageSize: 100,
  }).all();

  const existing = replies.find((comment) =>
    comment.parentId === parentCommentId &&
    comment.authorId === userId &&
    comment.body === text
  );
  return existing?.id ?? null;
}

async function cachedStickyThread(postId: string, key: string): Promise<string | null> {
  const cachedId = await redis.get(key);
  if (!cachedId) return null;

  try {
    const comment = await reddit.getCommentById(cachedId as `t1_${string}`);
    if (comment.parentId !== postId || comment.body !== SCORE_THREAD_TEXT) return null;
    if (!comment.stickied || !comment.isDistinguished()) {
      await comment.distinguish(true);
    }
    return comment.id;
  } catch {
    // A deleted or unavailable cached comment must be recovered from the post.
    return null;
  }
}

export async function ensureStickyScoreThread(postId: string): Promise<string> {
  const key = `wrdlink:v1:score-thread:${postId}`;
  const cached = await cachedStickyThread(postId, key);
  if (cached) return cached;

  const lockKey = key + ':lock';
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, {
    nx: true,
    expiration: new Date(Date.now() + LOCK_TTL_MS),
  });

  if (acquired !== 'OK') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const winnerId = await redis.get(key);
      if (winnerId) {
        const winner = await cachedStickyThread(postId, key);
        if (winner) return winner;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The WRDLINK score thread is being created. Please retry shortly.');
  }

  try {
    const secondCheck = await cachedStickyThread(postId, key);
    if (secondCheck) return secondCheck;

    // Recover the original pinned thread after Redis expiry or a cache reset.
    // Never create a replacement until the post has been checked for the marker.
    const comments = await reddit.getComments({
      postId: postId as `t3_${string}`,
      limit: 1000,
      pageSize: 100,
    }).all();
    const matchingThreads = comments.filter((comment) =>
      comment.parentId === postId && comment.body === SCORE_THREAD_TEXT
    );
    const existingThread =
      matchingThreads.find((comment) => comment.stickied && comment.isDistinguished()) ??
      matchingThreads[0];

    if (existingThread) {
      if (!existingThread.stickied || !existingThread.isDistinguished()) {
        await existingThread.distinguish(true);
      }
      await redis.set(key, existingThread.id);
      return existingThread.id;
    }

    const comment = await reddit.submitComment({
      id: postId as `t3_${string}`,
      text: SCORE_THREAD_TEXT,
      runAs: 'APP',
    });
    await comment.distinguish(true);
    await redis.set(key, comment.id);
    return comment.id;
  } finally {
    if (await redis.get(lockKey) === token) await redis.del(lockKey);
  }
}

export async function submitScoreCommentOnce(options: {
  postId: string;
  userId: string;
  scope: string;
  text: string;
  canSubmit: () => Promise<boolean>;
}): Promise<{ commentId: string; alreadySubmitted: boolean }> {
  const { postId, userId, scope, text, canSubmit } = options;
  const parentCommentId = await ensureStickyScoreThread(postId);
  const key = scoreSubmissionKey(postId, userId, scope);

  const completeFromCache = async (
    state: ScoreSubmissionState | null
  ): Promise<{ commentId: string; alreadySubmitted: boolean } | null> => {
    if (!state) return null;
    if (state.status === 'submitted') {
      return { commentId: state.commentId, alreadySubmitted: true };
    }

    try {
      const existingId = await findExistingScoreReply(postId, parentCommentId, userId, text);
      if (existingId) {
        await redis.set(key, JSON.stringify({ status: 'submitted', commentId: existingId }));
        return { commentId: existingId, alreadySubmitted: true };
      }
    } catch (error) {
      console.error('Could not reconcile a pending WRDLINK score comment:', error);
    }
    throw new ScoreCommentPendingError();
  };

  const raw = await redis.get(key);
  if (raw) {
    const state = parseSubmissionState(raw);
    if (!state) throw new ScoreCommentPendingError();
    const cachedResult = await completeFromCache(state);
    if (cachedResult) return cachedResult;
  }

  // Also reconcile against Reddit before creating a record. This covers old
  // successful comments if the app's Redis cache was cleared or migrated.
  try {
    const existingId = await findExistingScoreReply(postId, parentCommentId, userId, text);
    if (existingId) {
      await redis.set(key, JSON.stringify({ status: 'submitted', commentId: existingId }));
      return { commentId: existingId, alreadySubmitted: true };
    }
  } catch (error) {
    console.error('Could not check the WRDLINK score thread before sharing:', error);
    throw new ScoreCommentPendingError();
  }

  if (!await canSubmit()) throw new ScoreCommentRateLimitError();

  const claimed = await redis.set(key, JSON.stringify({ status: 'pending' }), { nx: true });
  if (claimed !== 'OK') {
    const raced = await redis.get(key);
    const state = raced ? parseSubmissionState(raced) : null;
    const cachedResult = await completeFromCache(state);
    if (cachedResult) return cachedResult;
    throw new ScoreCommentPendingError();
  }

  try {
    const comment = await reddit.submitComment({
      id: parentCommentId as `t1_${string}`,
      text,
      runAs: 'USER',
    });
    await redis.set(key, JSON.stringify({ status: 'submitted', commentId: comment.id }));
    return { commentId: comment.id, alreadySubmitted: false };
  } catch (error) {
    // Keep the pending marker. A network timeout can occur after Reddit has
    // accepted the comment, so retrying automatically could create a duplicate.
    console.error('WRDLINK score comment outcome is uncertain:', error);
    throw new ScoreCommentPendingError();
  }
}
