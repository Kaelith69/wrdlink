import assert from 'node:assert/strict';
import { Hono } from 'hono';
import test from 'node:test';
import { SCORE_SHARE_MAX_BODY_BYTES, scoreShareBodyLimit } from './request-limits.ts';

void test('score sharing rejects oversized request bodies before endpoint logic runs', async () => {
  let handlerCalled = false;
  const app = new Hono().post('/score', scoreShareBodyLimit, (c) => {
    handlerCalled = true;
    return c.json({ accepted: true });
  });

  const acceptedBody = JSON.stringify({ date: '2026-11-17' });
  const accepted = await app.request('/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: acceptedBody,
  });
  assert.equal(accepted.status, 200);
  assert.equal(handlerCalled, true);

  handlerCalled = false;
  const oversized = await app.request('/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commentary: 'x'.repeat(SCORE_SHARE_MAX_BODY_BYTES + 100) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(handlerCalled, false);
  const response = await oversized.json() as { code?: string };
  assert.equal(response.code, 'REQUEST_TOO_LARGE');
});
