import { reddit, redis } from '@devvit/web/server';

const STICKY_TTL_SECONDS = 60 * 24 * 60 * 60;
const LOCK_TTL_MS = 30_000;
const SCORE_THREAD_TEXT = [
  '**WRDLINK score sharing thread**',
  '',
  'Post your automatically formatted game scores as replies here. Score comments are submitted only when a player chooses to comment, and appear under their Reddit username.',
].join('\n');

export async function ensureStickyScoreThread(postId: string): Promise<string> {
  const key = `wrdlink:v1:score-thread:${postId}`;
  const existing = await redis.get(key);
  if (existing) return existing;

  const lockKey = key + ':lock';
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const acquired = await redis.set(lockKey, token, {
    nx: true,
    expiration: new Date(Date.now() + LOCK_TTL_MS),
  });

  if (acquired !== 'OK') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pinnedId = await redis.get(key);
      if (pinnedId) return pinnedId;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The WRDLINK score thread is being created. Please retry shortly.');
  }

  try {
    const cached = await redis.get(key);
    if (cached) return cached;

    const comment = await reddit.submitComment({
      id: postId,
      text: SCORE_THREAD_TEXT,
      runAs: 'APP',
    });
    await comment.distinguish(true);
    await redis.set(key, comment.id, {
      expiration: new Date(Date.now() + STICKY_TTL_SECONDS * 1000),
    });
    return comment.id;
  } finally {
    if (await redis.get(lockKey) === token) await redis.del(lockKey);
  }
}
