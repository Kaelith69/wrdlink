import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { formatDailyPostContent, utcDateKey } from './core/daily';
import { cleanupDeletedScoreComment, cleanupDeletedScorePost, ensureStickyScoreThread } from './core/score-comments';
import { api } from './routes/api';
import { dailyApi, getSharedDailyPuzzle } from './routes/daily';

const app = new Hono();
const DAILY_POST_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const DAILY_POST_LOCK_MS = 5 * 60 * 1000;

app.route('/api', api);
app.route('/api/daily', dailyApi);

async function publishDailyPuzzlePost(subredditName: string) {
  const date = utcDateKey();
  const publishedKey = `wrdlink:v2:daily:reddit-post:${date}`;
  const existing = await redis.get(publishedKey);
  if (existing) return { status: 'already_published' as const, date };

  const lockKey = publishedKey + ':lock';
  const lockToken = randomUUID();
  const acquired = await redis.set(lockKey, lockToken, {
    nx: true,
    expiration: new Date(Date.now() + DAILY_POST_LOCK_MS),
  });
  if (acquired !== 'OK') return { status: 'already_running' as const, date };

  try {
    const published = await redis.get(publishedKey);
    if (published) return { status: 'already_published' as const, date };

    const puzzle = await getSharedDailyPuzzle(date);
    const { title, body } = formatDailyPostContent(date, puzzle);
    const post = await reddit.submitCustomPost({
      subredditName,
      title,
      entry: 'default',
      postData: {
        kind: 'daily-challenge',
        date,
        start: puzzle.start,
        target: puzzle.target,
      },
      textFallback: { text: body },
    });

    await redis.set(publishedKey, JSON.stringify({
      postId: post.id,
      permalink: post.permalink,
      title,
    }), {
      expiration: new Date(Date.now() + DAILY_POST_TTL_MS),
    });
    try {
      await ensureStickyScoreThread(post.id);
    } catch (error) {
      console.error('Could not create the WRDLINK Daily score thread. It will be retried when a player shares a score.', error);
    }

    return { status: 'published' as const, date, postId: post.id, permalink: post.permalink };
  } finally {
    if (await redis.get(lockKey) === lockToken) await redis.del(lockKey);
  }
}

app.post('/internal/scheduler/daily-puzzle-post', async (c) => {
  const subredditName = context.subredditName;
  if (!subredditName) {
    return c.json({ status: 'error', message: 'Subreddit context is unavailable.' }, 500);
  }
  try {
    return c.json(await publishDailyPuzzlePost(subredditName));
  } catch (error) {
    console.error('Failed to publish the WRDLINK Daily post.', error);
    return c.json({ status: 'error', message: 'Daily post publishing failed.' }, 500);
  }
});

async function publishInitialDailyPost(c: Context) {
  const subredditName = context.subredditName;
  if (!subredditName) return c.json({ status: 'ignored' });
  try {
    await publishDailyPuzzlePost(subredditName);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('Failed to publish the initial WRDLINK Daily post.', error);
    return c.json({ status: 'error' }, 500);
  }
}

app.post('/internal/triggers/on-comment-delete', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== 'object' || body === null ||
      !('commentId' in body) || typeof body.commentId !== 'string' ||
      !('postId' in body) || typeof body.postId !== 'string' ||
      !/^t1_[a-z0-9]+$/i.test(body.commentId) ||
      !/^t3_[a-z0-9]+$/i.test(body.postId)) {
    return c.json({ status: 'ignored' }, 400);
  }

  try {
    await cleanupDeletedScoreComment(body.postId, body.commentId);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('WRDLINK could not clean up deleted score comment data:', error);
    return c.json({ status: 'error' }, 500);
  }
});

app.post('/internal/triggers/on-post-delete', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== 'object' || body === null ||
      !('postId' in body) || typeof body.postId !== 'string' ||
      !/^t3_[a-z0-9]+$/i.test(body.postId)) {
    return c.json({ status: 'ignored' }, 400);
  }

  try {
    await cleanupDeletedScorePost(body.postId);
    return c.json({ status: 'ok' });
  } catch (error) {
    console.error('WRDLINK could not clean up deleted post score data:', error);
    return c.json({ status: 'error' }, 500);
  }
});

app.post('/internal/triggers/on-app-install', publishInitialDailyPost);
app.post('/internal/triggers/on-app-upgrade', publishInitialDailyPost);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
