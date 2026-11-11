import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { dailyApi } from './routes/daily';

const app = new Hono();

app.route('/api', api);
app.route('/api/daily', dailyApi);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
