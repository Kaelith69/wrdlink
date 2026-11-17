import { createHash, randomUUID } from 'node:crypto';
import { reddit, redis } from '@devvit/web/server';

const THREAD_LOCK_TTL_MS = 30_000;
const THREAD_CACHE_TTL_SECONDS = 60 * 24 * 60 * 60;
const SUBMISSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SUBMISSION_INDEX_TTL_SECONDS = SUBMISSION_TTL_SECONDS + 24 * 60 * 60;

export const SCORE_THREAD_TEXT = [
  '**WRDLINK score sharing thread**',
  '',
  'Post your automatically formatted game scores as replies here. Score comments are submitted only when a player chooses to comment, and appear under their Reddit username.',
].join('\n');

type ScoreSubmissionState =
  | { status: 'pending' }
  | { status: 'submitted'; commentId: string };

export class ScoreCommentPendingError extends Error {
  constructor(message = 'A previous score comment request may already have reached Reddit. Check the WRDLINK comment thread before trying again. WRDLINK will not automatically send a possible duplicate.') {
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

export class ScoreCommentThreadError extends Error {
  constructor(message = 'The WRDLINK score thread is unavailable. No score comment was submitted. Please try again later.') {
    super(message);
    this.name = 'ScoreCommentThreadError';
  }
}

function scoreSubmissionKey(
  postId: string,
  userId: string,
  scope: string,
  destination: 'sticky-reply' | 'custom-top-level'
): string {
  const digest = createHash('sha256')
    .update([postId, userId, destination, scope].join('|'))
    .digest('hex');
  return `wrdlink:v1:score-submission:${digest}`;
}

function scoreSubmissionIndexKey(postId: string): string {
  return `wrdlink:v1:score-submission-index:${postId}`;
}

function scoreThreadKey(postId: string): string {
  return `wrdlink:v1:score-thread:${postId}`;
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

async function findExistingComment(
  postId: string,
  parentId: string,
  userId: string,
  text: string
): Promise<string | null> {
  const listing = parentId.startsWith('t1_')
    ? reddit.getComments({
        postId: postId as `t3_${string}`,
        commentId: parentId as `t1_${string}`,
        limit: 1000,
        pageSize: 100,
      })
    : reddit.getComments({
        postId: postId as `t3_${string}`,
        limit: 1000,
        pageSize: 100,
      });

  const comments = await listing.all();
  const existing = comments.find((comment) =>
    comment.postId === postId &&
    comment.parentId === parentId &&
    comment.authorId === userId &&
    comment.body === text &&
    !comment.removed &&
    !comment.spam
  );
  return existing?.id ?? null;
}

async function readCachedStickyThread(postId: string): Promise<string | null> {
  const key = scoreThreadKey(postId);
  const cachedId = await redis.get(key);
  if (!cachedId) return null;

  try {
    const comment = await reddit.getCommentById(cachedId as `t1_${string}`);
    const validParent =
      comment.id === cachedId &&
      comment.postId === postId &&
      comment.parentId === postId &&
      comment.body === SCORE_THREAD_TEXT &&
      !comment.removed &&
      !comment.spam;
    if (!validParent) {
      await redis.del(key);
      return null;
    }

    if (!comment.stickied || !comment.isDistinguished()) {
      await comment.distinguish(true);
    }
    return comment.id;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function ensureStickyScoreThread(postId: string): Promise<string> {
  const cached = await readCachedStickyThread(postId);
  if (cached) return cached;

  const key = scoreThreadKey(postId);
  const lockKey = key + ':lock';
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, {
    nx: true,
    expiration: new Date(Date.now() + THREAD_LOCK_TTL_MS),
  });

  if (acquired !== 'OK') {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const winner = await readCachedStickyThread(postId);
      if (winner) return winner;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ScoreCommentThreadError('The WRDLINK score thread is being repaired. No score comment was submitted. Please retry shortly.');
  }

  try {
    const secondCheck = await readCachedStickyThread(postId);
    if (secondCheck) return secondCheck;

    let comments;
    try {
      comments = await reddit.getComments({
        postId: postId as `t3_${string}`,
        limit: 1000,
        pageSize: 100,
      }).all();
    } catch (error) {
      console.error('Could not inspect the WRDLINK post before repairing its score thread:', error);
      throw new ScoreCommentThreadError();
    }

    const matchingThreads = comments.filter((comment) =>
      comment.postId === postId &&
      comment.parentId === postId &&
      comment.body === SCORE_THREAD_TEXT &&
      !comment.removed &&
      !comment.spam
    );

    const existingThread =
      matchingThreads.find((comment) => comment.stickied && comment.isDistinguished()) ??
      matchingThreads[0];

    if (existingThread) {
      try {
        if (!existingThread.stickied || !existingThread.isDistinguished()) {
          await existingThread.distinguish(true);
        }

        // Repair legacy duplicate marker comments. Exactly one matching thread
        // remains distinguished and pinned; failures stop score publication.
        for (const duplicate of matchingThreads) {
          if (duplicate.id === existingThread.id) continue;
          if (duplicate.stickied || duplicate.isDistinguished()) {
            await duplicate.undistinguish();
          }
        }
      } catch (error) {
        console.error('Could not establish one WRDLINK sticky score thread:', error);
        throw new ScoreCommentThreadError();
      }

      await redis.set(key, existingThread.id, {
        expiration: new Date(Date.now() + THREAD_CACHE_TTL_SECONDS * 1000),
      });
      return existingThread.id;
    }

    try {
      const comment = await reddit.submitComment({
        id: postId as `t3_${string}`,
        text: SCORE_THREAD_TEXT,
        runAs: 'APP',
      });
      await comment.distinguish(true);
      await redis.set(key, comment.id, {
        expiration: new Date(Date.now() + THREAD_CACHE_TTL_SECONDS * 1000),
      });
      return comment.id;
    } catch (error) {
      console.error('Could not create or pin the WRDLINK score thread:', error);
      throw new ScoreCommentThreadError();
    }
  } finally {
    if (await redis.get(lockKey) === token) await redis.del(lockKey);
  }
}

async function persistSubmission(
  postId: string,
  key: string,
  commentId: string
): Promise<void> {
  await redis.set(key, JSON.stringify({ status: 'submitted', commentId }), {
    expiration: new Date(Date.now() + SUBMISSION_TTL_SECONDS * 1000),
  });
  await redis.hSet(scoreSubmissionIndexKey(postId), { [commentId]: key });
  await redis.expire(
    scoreSubmissionIndexKey(postId),
    SUBMISSION_INDEX_TTL_SECONDS
  );
}

async function clearSubmission(
  postId: string,
  key: string,
  commentId?: string
): Promise<void> {
  await redis.del(key);
  if (commentId) {
    await redis.hDel(scoreSubmissionIndexKey(postId), [commentId]);
  }
}

async function verifyCachedSubmittedComment(options: {
  postId: string;
  parentId: string;
  userId: string;
  text: string;
  commentId: string;
}): Promise<'valid' | 'removed'> {
  const { postId, parentId, userId, text, commentId } = options;
  try {
    const comment = await reddit.getCommentById(commentId as `t1_${string}`);
    if (
      comment.postId !== postId ||
      comment.parentId !== parentId ||
      comment.authorId !== userId ||
      comment.body !== text
    ) {
      throw new ScoreCommentPendingError();
    }
    return comment.removed || comment.spam ? 'removed' : 'valid';
  } catch (error) {
    if (error instanceof ScoreCommentPendingError) throw error;
    throw new ScoreCommentPendingError(
      'WRDLINK could not verify the previous Reddit comment. Check your comment history before trying again.'
    );
  }
}

async function submitUserCommentOnce(options: {
  postId: string;
  parentId: string;
  userId: string;
  scope: string;
  destination: 'sticky-reply' | 'custom-top-level';
  text: string;
  canSubmit: () => Promise<boolean>;
}): Promise<{ commentId: string; alreadySubmitted: boolean }> {
  const { postId, parentId, userId, scope, destination, text, canSubmit } = options;
  const key = scoreSubmissionKey(postId, userId, scope, destination);

  const reconcilePending = async (
    state: ScoreSubmissionState | null
  ): Promise<{ commentId: string; alreadySubmitted: boolean } | null> => {
    if (!state) return null;

    if (state.status === 'submitted') {
      const status = await verifyCachedSubmittedComment({
        postId, parentId, userId, text, commentId: state.commentId,
      });
      if (status === 'valid') {
        return { commentId: state.commentId, alreadySubmitted: true };
      }
      await clearSubmission(postId, key, state.commentId);
      return null;
    }

    try {
      const existingId = await findExistingComment(postId, parentId, userId, text);
      if (!existingId) return null;
      await persistSubmission(postId, key, existingId);
      return { commentId: existingId, alreadySubmitted: true };
    } catch (error) {
      console.error('Could not reconcile a pending WRDLINK comment:', error);
      throw new ScoreCommentPendingError();
    }
  };

  const raw = await redis.get(key);
  if (raw) {
    const state = parseSubmissionState(raw);
    if (!state) throw new ScoreCommentPendingError();
    const cached = await reconcilePending(state);
    if (cached) return cached;
    if (state.status === 'pending') throw new ScoreCommentPendingError();
  }

  // Redis can be reset independently of Reddit. Reconcile against the actual
  // post before creating a new user action.
  try {
    const existingId = await findExistingComment(postId, parentId, userId, text);
    if (existingId) {
      await persistSubmission(postId, key, existingId);
      return { commentId: existingId, alreadySubmitted: true };
    }
  } catch (error) {
    console.error('Could not inspect Reddit before score sharing:', error);
    throw new ScoreCommentPendingError();
  }

  const claimed = await redis.set(key, JSON.stringify({ status: 'pending' }), {
    nx: true,
    expiration: new Date(Date.now() + SUBMISSION_TTL_SECONDS * 1000),
  });
  if (claimed !== 'OK') {
    const raced = await redis.get(key);
    const state = raced ? parseSubmissionState(raced) : null;
    const recovered = await reconcilePending(state);
    if (recovered) return recovered;
    throw new ScoreCommentPendingError();
  }

  if (!await canSubmit()) {
    await redis.del(key);
    throw new ScoreCommentRateLimitError();
  }

  try {
    const comment = await reddit.submitComment({
      id: parentId as `t1_${string}` | `t3_${string}`,
      text,
      runAs: 'USER',
    });
    await persistSubmission(postId, key, comment.id);
    return { commentId: comment.id, alreadySubmitted: false };
  } catch (error) {
    // Retain the pending marker after uncertain outcomes. The next explicit
    // attempt first searches Reddit, preventing an accidental duplicate.
    console.error('WRDLINK user comment outcome is uncertain:', error);
    throw new ScoreCommentPendingError();
  }
}

export async function submitScoreCommentOnce(options: {
  postId: string;
  userId: string;
  scope: string;
  text: string;
  canSubmit: () => Promise<boolean>;
}): Promise<{ commentId: string; alreadySubmitted: boolean }> {
  const parentId = await ensureStickyScoreThread(options.postId);
  return submitUserCommentOnce({
    ...options,
    parentId,
    destination: 'sticky-reply',
  });
}

export async function submitCustomScoreCommentOnce(options: {
  postId: string;
  userId: string;
  scope: string;
  text: string;
  canSubmit: () => Promise<boolean>;
}): Promise<{ commentId: string; alreadySubmitted: boolean }> {
  const post = await reddit.getPostById(options.postId as `t3_${string}`);
  if (post.removed || post.spam) {
    throw new ScoreCommentThreadError('This Reddit post is no longer available for comments.');
  }
  return submitUserCommentOnce({
    ...options,
    parentId: options.postId,
    destination: 'custom-top-level',
  });
}

export async function cleanupDeletedScoreComment(
  postId: string,
  commentId: string
): Promise<void> {
  const indexKey = scoreSubmissionIndexKey(postId);
  const submissionKey = await redis.hGet(indexKey, commentId);
  if (submissionKey) await redis.del(submissionKey);
  await redis.hDel(indexKey, [commentId]);

  const threadKey = scoreThreadKey(postId);
  if (await redis.get(threadKey) === commentId) await redis.del(threadKey);
}

export async function cleanupDeletedScorePost(postId: string): Promise<void> {
  const indexKey = scoreSubmissionIndexKey(postId);
  const indexed = await redis.hGetAll(indexKey);
  const submissionKeys = indexed ? Object.values(indexed) : [];
  await Promise.all(submissionKeys.map((key) => redis.del(key)));
  await Promise.all([indexKey, scoreThreadKey(postId), scoreThreadKey(postId) + ':lock'].map((key) => redis.del(key)));
}
