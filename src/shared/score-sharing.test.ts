import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCampaignScoreComment,
  formatDailyScoreComment,
  formatCustomScoreComment,
  validateMeaningfulCommentary,
} from './score-sharing.ts';

void test('campaign score comment preview uses real line breaks and server score fields', () => {
  const value = formatCampaignScoreComment({
    level: 12,
    start: 'COLD',
    target: 'WARM',
    moves: 7,
    score: 43,
    words: ['COLD', 'CORD', 'CARD', 'WARD', 'WARM'],
  });
  assert.match(value, /WRDLINK Campaign · Level 12/);
  assert.match(value, /Moves: 7 · Score: 43/);
  assert.match(value, /\n\nSolution:/);
  assert.equal(value.includes('\\n\\n'), false);
});

void test('daily score comment preview preserves the daily result and streak', () => {
  const value = formatDailyScoreComment({
    date: '2026-11-17',
    start: 'COLD',
    target: 'WARM',
    moves: 6,
    score: 44,
    currentStreak: 7,
  });
  assert.match(value, /Date: 2026-11-17/);
  assert.match(value, /Streak: 7 days/);
  assert.match(value, /Points: 44/);
});

void test('meaningful commentary requires user authored content, not an empty or generated score template', () => {
  assert.equal(validateMeaningfulCommentary('').valid, false);
  assert.equal(validateMeaningfulCommentary('WRDLINK Daily Challenge Points: 400').valid, false);
  assert.equal(validateMeaningfulCommentary('nice nice nice nice nice').valid, false);
  assert.equal(validateMeaningfulCommentary('This puzzle was surprisingly clever and I enjoyed finding the final ladder.').valid, true);
});

void test('custom score comment contains the user message and generated score as separate sections', () => {
  const userMessage = 'This puzzle was surprisingly clever and I enjoyed finding the final ladder.';
  const score = 'WRDLINK Daily Challenge\n\nPoints: 44';
  assert.equal(formatCustomScoreComment(userMessage, score), userMessage + '\n\n' + score);
  assert.throws(() => formatCustomScoreComment('Great job', score), /at least 25 characters/i);
});
