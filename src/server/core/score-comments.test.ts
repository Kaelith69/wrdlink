import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type FakeCommentOptions = {
  id: string;
  postId: string;
  parentId: string;
  body: string;
  authorId: string;
  stickied?: boolean;
  distinguished?: boolean;
  removed?: boolean;
  spam?: boolean;
};

type FakeComment = FakeCommentOptions & {
  isDistinguished: () => boolean;
  distinguish: (makeSticky?: boolean) => Promise<void>;
  undistinguish: () => Promise<void>;
};

const keyValues = new Map<string, string>();
const hashValues = new Map<string, Map<string, string>>();
const comments: FakeComment[] = [];
const submissions: Array<{ id: string; text: string; runAs: string }> = [];
let sequence = 0;
let currentUserId = 't2_test_player';
let appUserId = 't2_wrdlink_app';
let throwAfterUserSubmit = false;
let failDistinguish = false;

function makeComment(options: FakeCommentOptions): FakeComment {
  let stickied = options.stickied ?? false;
  let distinguished = options.distinguished ?? false;
  return {
    ...options,
    get stickied() { return stickied; },
    get removed() { return options.removed ?? false; },
    get spam() { return options.spam ?? false; },
    isDistinguished: () => distinguished,
    distinguish: async (makeSticky = false) => {
      if (failDistinguish) throw new Error('moderator permission denied');
      distinguished = true;
      stickied = makeSticky;
    },
    undistinguish: async () => {
      distinguished = false;
      stickied = false;
    },
  };
}

const redis = {
  async get(key: string) {
    return keyValues.get(key) ?? null;
  },
  async set(key: string, value: string, options?: { nx?: boolean }) {
    if (options?.nx && keyValues.has(key)) return null;
    keyValues.set(key, value);
    return 'OK';
  },
  async del(key: string) {
    keyValues.delete(key);
    return 1;
  },
  async hSet(key: string, values: Record<string, string>) {
    const hash = hashValues.get(key) ?? new Map<string, string>();
    for (const [field, value] of Object.entries(values)) hash.set(field, value);
    hashValues.set(key, hash);
    return Object.keys(values).length;
  },
  async hGet(key: string, field: string) {
    return hashValues.get(key)?.get(field) ?? null;
  },
  async hGetAll(key: string) {
    return Object.fromEntries(hashValues.get(key) ?? []);
  },
  async hDel(key: string, fields: string[]) {
    const hash = hashValues.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) if (hash.delete(field)) removed += 1;
    return removed;
  },
  async expire() { return true; },
};

const reddit = {
  getComments(options: { postId: string; commentId?: string; limit?: number }) {
    return {
      all: async () => comments.filter((comment) =>
        comment.postId === options.postId &&
        comment.parentId === (options.commentId ?? options.postId)
      ).slice(0, options.limit ?? 1000),
    };
  },
  async getCommentById(id: string) {
    const comment = comments.find((item) => item.id === id);
    if (!comment) throw new Error('comment not found');
    return comment;
  },
  async getPostById(id: string) {
    return { id, removed: false, spam: false };
  },
  async submitComment(options: { id: string; text: string; runAs: 'APP' | 'USER' }) {
    const postId = options.id.startsWith('t3_')
      ? options.id
      : comments.find((item) => item.id === options.id)?.postId;
    if (!postId) throw new Error('parent comment not found');
    const comment = makeComment({
      id: 't1_test' + (++sequence),
      postId,
      parentId: options.id,
      body: options.text,
      authorId: options.runAs === 'USER' ? currentUserId : appUserId,
    });
    comments.push(comment);
    submissions.push({ id: options.id, text: options.text, runAs: options.runAs });
    if (options.runAs === 'USER' && throwAfterUserSubmit) {
      throwAfterUserSubmit = false;
      throw new Error('simulated response timeout after Reddit accepted the comment');
    }
    return comment;
  },
};

mock.module('@devvit/web/server', { exports: { reddit, redis } });
const {
  submitScoreCommentOnce,
  submitCustomScoreCommentOnce,
  ScoreCommentPendingError,
  ScoreCommentThreadError,
} = await import('./score-comments.ts');

function reset(): void {
  keyValues.clear();
  hashValues.clear();
  comments.length = 0;
  submissions.length = 0;
  sequence = 0;
  currentUserId = 't2_test_player';
  appUserId = 't2_wrdlink_app';
  throwAfterUserSubmit = false;
  failDistinguish = false;
}

function options(scope: string, text = 'WRDLINK Campaign score: 42') {
  return {
    postId: 't3_testpost',
    userId: currentUserId,
    scope,
    text,
    canSubmit: async () => true,
  };
}

void test('generic score sharing creates an app-owned sticky thread and replies as the player', async () => {
  reset();
  const result = await submitScoreCommentOnce(options('campaign:session-one:puzzle-one'));

  const thread = comments.find((comment) => comment.body.includes('WRDLINK score sharing thread'));
  const score = comments.find((comment) => comment.body === 'WRDLINK Campaign score: 42');

  assert.ok(thread);
  assert.equal(thread.authorId, appUserId);
  assert.equal(thread.parentId, 't3_testpost');
  assert.equal(thread.stickied, true);
  assert.equal(thread.isDistinguished(), true);
  assert.ok(score);
  assert.equal(score.authorId, currentUserId);
  assert.equal(score.parentId, thread.id);
  assert.equal(submissions[0]?.runAs, 'APP');
  assert.equal(submissions[1]?.runAs, 'USER');
  assert.equal(result.commentId, score.id);
  assert.equal(result.alreadySubmitted, false);
});

void test('concurrent identical score requests create at most one player score comment', async () => {
  reset();
  const input = options('daily:2026-11-17');
  const outcomes = await Promise.allSettled([
    submitScoreCommentOnce(input),
    submitScoreCommentOnce(input),
    submitScoreCommentOnce(input),
  ]);

  const playerScores = comments.filter((comment) =>
    comment.body === input.text && comment.authorId === currentUserId
  );
  const threads = comments.filter((comment) =>
    comment.body.includes('WRDLINK score sharing thread')
  );

  assert.equal(playerScores.length, 1);
  assert.equal(threads.length, 1);
  assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled'));
  assert.ok(outcomes.every((outcome) =>
    outcome.status === 'fulfilled' ||
    (outcome.status === 'rejected' && outcome.reason instanceof ScoreCommentPendingError)
  ));
});

void test('an uncertain Reddit response is reconciled before any retry can duplicate the comment', async () => {
  reset();
  const input = options('campaign:session-two:puzzle-two');
  throwAfterUserSubmit = true;

  await assert.rejects(
    submitScoreCommentOnce(input),
    (error: unknown) => error instanceof ScoreCommentPendingError
  );

  const reconciled = await submitScoreCommentOnce(input);
  const playerScores = comments.filter((comment) =>
    comment.body === input.text && comment.authorId === currentUserId
  );

  assert.equal(playerScores.length, 1);
  assert.equal(reconciled.alreadySubmitted, true);
  assert.equal(reconciled.commentId, playerScores[0]?.id);
});

void test('Reddit comments are consulted after Redis state loss before a new score is submitted', async () => {
  reset();
  const input = options('daily:2026-11-16');
  const first = await submitScoreCommentOnce(input);
  keyValues.clear();
  hashValues.clear();

  const second = await submitScoreCommentOnce(input);
  const playerScores = comments.filter((comment) =>
    comment.body === input.text && comment.authorId === currentUserId
  );

  assert.equal(playerScores.length, 1);
  assert.equal(second.alreadySubmitted, true);
  assert.equal(second.commentId, first.commentId);
});

void test('a sticky thread permission failure fails closed and never posts a top-level generic score', async () => {
  reset();
  failDistinguish = true;

  await assert.rejects(
    submitScoreCommentOnce(options('daily:2026-11-15')),
    (error: unknown) => error instanceof ScoreCommentThreadError
  );

  assert.equal(comments.filter((comment) => comment.authorId === currentUserId).length, 0);
  assert.equal(submissions.filter((submission) => submission.runAs === 'USER').length, 0);
});

void test('custom commentary score comments are top-level and still submitted as the player', async () => {
  reset();
  const input = options(
    'campaign:session-three:puzzle-three',
    'I found the final word path surprisingly difficult but satisfying.'
  );
  const result = await submitCustomScoreCommentOnce(input);
  const custom = comments.find((comment) => comment.body === input.text);

  assert.ok(custom);
  assert.equal(custom.authorId, currentUserId);
  assert.equal(custom.parentId, input.postId);
  assert.equal(submissions.find((submission) => submission.text === input.text)?.runAs, 'USER');
  assert.equal(result.alreadySubmitted, false);
});
