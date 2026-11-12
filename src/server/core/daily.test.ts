import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRankScore, dailyRankScore, earnedBadges, formatDailyPostContent, formatDailyShareText, isoWeekKey, updateDailyStreak, utcDateKey, type DailyProfile } from './daily.ts';

const profile = (patch: Partial<DailyProfile> = {}): DailyProfile => ({
  totalCompleted: 0, totalScore: 0, totalMoves: 0,
  currentStreak: 0, bestStreak: 0, lastDailyDate: null, graceTokens: 0, badges: [],
  ...patch,
});

void test('UTC date and ISO week keys are stable across year boundaries', () => {
  assert.equal(utcDateKey(new Date('2026-01-01T23:00:00.000Z')), '2026-01-01');
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2026-12-31'), '2026-W53');
});

void test('streak increments for consecutive daily completions', () => {
  const result = updateDailyStreak(profile({ currentStreak: 4, bestStreak: 4, lastDailyDate: '2026-11-10' }), '2026-11-11');
  assert.equal(result.currentStreak, 5);
  assert.equal(result.graceUsed, false);
});

void test('one missed day consumes one grace token without breaking the streak', () => {
  const result = updateDailyStreak(profile({ currentStreak: 6, bestStreak: 6, lastDailyDate: '2026-11-09', graceTokens: 1 }), '2026-11-11');
  assert.equal(result.currentStreak, 7);
  assert.equal(result.graceUsed, true);
  assert.equal(result.graceTokens, 0);
});

void test('a streak earns a grace token every seven days, capped at two', () => {
  const result = updateDailyStreak(profile({ currentStreak: 6, lastDailyDate: '2026-11-10' }), '2026-11-11');
  assert.equal(result.currentStreak, 7);
  assert.equal(result.graceEarned, true);
  assert.equal(result.graceTokens, 1);
  const capped = updateDailyStreak(profile({ currentStreak: 13, lastDailyDate: '2026-11-10', graceTokens: 2 }), '2026-11-11');
  assert.equal(capped.graceTokens, 2);
});

void test('long gaps reset streak and repeated same day is idempotent', () => {
  const reset = updateDailyStreak(profile({ currentStreak: 12, bestStreak: 12, lastDailyDate: '2026-11-01', graceTokens: 0 }), '2026-11-11');
  assert.equal(reset.currentStreak, 1);
  const repeated = updateDailyStreak(profile({ currentStreak: 3, bestStreak: 4, lastDailyDate: '2026-11-11', graceTokens: 1 }), '2026-11-11');
  assert.equal(repeated.currentStreak, 3);
  assert.equal(repeated.graceTokens, 1);
});

void test('achievement badges are persistent and milestone based', () => {
  const badges = earnedBadges(profile({ totalCompleted: 25, currentStreak: 7, badges: ['FIRST_SOLVE'] }), 4, 4, 0, 46);
  assert.deepEqual(badges, ['FIRST_SOLVE', 'FIVE_SOLVES', 'OPTIMAL_PATH', 'PERFECT_SOLVE', 'STREAK_3', 'STREAK_7', 'TWENTY_FIVE_SOLVES']);
});


void test('daily score and move rankings use deterministic composite scores', () => {
  const highScore = dailyRankScore(48, 2, 1000, 'score');
  const lowScore = dailyRankScore(42, 2, 1000, 'score');
  assert.ok(highScore < lowScore);

  const fewerMovesEvenWhenLater = dailyRankScore(45, 3, 86_399_000, 'score');
  const moreMovesEvenWhenEarlier = dailyRankScore(45, 4, 1_000, 'score');
  assert.ok(fewerMovesEvenWhenLater < moreMovesEvenWhenEarlier);

  const higherScoreEvenWhenLater = dailyRankScore(46, 4, 86_399_000, 'moves');
  const lowerScoreEvenWhenEarlier = dailyRankScore(45, 4, 1_000, 'moves');
  assert.ok(higherScoreEvenWhenLater < lowerScoreEvenWhenEarlier);

  const earlierTie = dailyRankScore(45, 3, 1_000, 'score');
  const laterTie = dailyRankScore(45, 3, 2_000, 'score');
  assert.ok(earlierTie < laterTie);

  const millisecondTie = dailyRankScore(45, 3, 1_001, 'score');
  assert.ok(earlierTie < millisecondTie);
});

void test('weekly and all time ranking uses aggregate score and average moves', () => {
  const stronger = aggregateRankScore(400, 30, 10, 'score');
  const weaker = aggregateRankScore(350, 30, 10, 'score');
  assert.ok(stronger < weaker);

  const fewerAverageMoves = aggregateRankScore(350, 25, 10, 'moves');
  const moreAverageMoves = aggregateRankScore(1_000_000, 26, 10, 'moves');
  assert.ok(fewerAverageMoves < moreAverageMoves);
});

void test('perfect solve requires the maximum possible score without failed attempts', () => {
  const perfect = earnedBadges(profile({ totalCompleted: 1 }), 4, 4, 0, 46);
  assert.ok(perfect.includes('PERFECT_SOLVE'));
  const penalized = earnedBadges(profile({ totalCompleted: 1 }), 4, 4, 0, 45);
  assert.equal(penalized.includes('PERFECT_SOLVE'), false);
  assert.ok(penalized.includes('OPTIMAL_PATH'));
});


void test('daily share copy contains progress only and never exposes the solution path', () => {
  const message = formatDailyShareText({
    date: '2026-11-12', start: 'LANK', target: 'HELM', moves: 9, score: 35,
  }, 4);
  assert.equal(message, [
    'WRDLINK Daily Challenge',
    'Puzzle: LANK → HELM',
    'Date: 2026-11-12',
    'Finished in 9 moves',
    'Streak: 4 days',
    'Points: 35',
    'Think you can beat it? Give today’s puzzle a try!',
  ].join('\n\n'));
  assert.equal(message.includes('HOLK'), false);
  assert.equal(message.includes('Solution:'), false);
  assert.equal(message.includes('>!'), false);
  assert.equal(message.includes('reddit.com'), false);
});


void test('daily Reddit post copy is concise and uses the dated shared puzzle details', () => {
  const post = formatDailyPostContent('2026-11-12', {
    start: 'LANK', target: 'HELM', optimalMoves: 5,
  });
  assert.equal(post.title, 'Can you get from LANK to HELM? | WRDLINK Daily');
  assert.equal(post.body, [
    '**12 November 2026**',
    '**Start:** LANK',
    '**Target:** HELM',
    '**Optimal:** 5 moves',
    'Change exactly one letter per move. Every intermediate word must be valid. Do not reuse words.',
    "Open the post to play today's challenge.",
  ].join('\\n\\n'));
  assert.equal(post.body.includes('Solution'), false);
  assert.equal(post.body.includes('>!'), false);
  assert.throws(() => formatDailyPostContent('2026-13-40', {
    start: 'LANK', target: 'HELM', optimalMoves: 5,
  }), /date/i);
});
