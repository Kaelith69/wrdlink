import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { formatDailyPostContent, utcDateKey } from './core/daily';
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
      entry: 'game',
      textFallback: { text: body },
    });

    await redis.set(publishedKey, JSON.stringify({
      postId: post.id,
      permalink: post.permalink,
      title,
    }), {
      expiration: new Date(Date.now() + DAILY_POST_TTL_MS),
    });

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

async function publishInitialDailyPost(c: Parameters<Parameters<typeof app.post>[1]>[0]) {
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

app.post('/internal/triggers/on-app-install', publishInitialDailyPost);
app.post('/internal/triggers/on-app-upgrade', publishInitialDailyPost);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
