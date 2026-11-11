import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateRankScore, dailyRankScore, earnedBadges, isoWeekKey, updateDailyStreak, utcDateKey, type DailyProfile } from './daily.ts';

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
  const badges = earnedBadges(profile({ totalCompleted: 25, currentStreak: 7, badges: ['FIRST_SOLVE'] }), 4, 4, 0);
  assert.deepEqual(badges, ['FIVE_SOLVES', 'FIRST_SOLVE', 'OPTIMAL_PATH', 'PERFECT_SOLVE', 'STREAK_3', 'STREAK_7', 'TWENTY_FIVE_SOLVES']);
});


void test('daily score and move rankings use deterministic composite scores', () => {
  const highScore = dailyRankScore(48, 2, 1000, 'score');
  const lowScore = dailyRankScore(42, 2, 1000, 'score');
  assert.ok(highScore < lowScore);

  const fewerMoves = dailyRankScore(45, 3, 2000, 'moves');
  const moreMoves = dailyRankScore(45, 4, 1000, 'moves');
  assert.ok(fewerMoves < moreMoves);

  const earlierTie = dailyRankScore(45, 3, 1000, 'score');
  const laterTie = dailyRankScore(45, 3, 2000, 'score');
  assert.ok(earlierTie < laterTie);
});

void test('weekly and all time ranking uses aggregate score and average moves', () => {
  const stronger = aggregateRankScore(400, 30, 10, 'score');
  const weaker = aggregateRankScore(350, 30, 10, 'score');
  assert.ok(stronger < weaker);

  const fewerAverageMoves = aggregateRankScore(350, 25, 10, 'moves');
  const moreAverageMoves = aggregateRankScore(400, 35, 10, 'moves');
  assert.ok(fewerAverageMoves < moreAverageMoves);
});
