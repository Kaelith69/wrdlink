import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';

const app = new Hono();

app.route('/api', api);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
