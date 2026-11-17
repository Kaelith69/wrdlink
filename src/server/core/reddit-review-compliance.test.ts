import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const splashCss = source('../../client/splash.css');
const splashTsx = source('../../client/splash.tsx');
const gameCss = source('../../client/index.css');
const dailyCss = source('../../client/daily.css');
const gameTsx = source('../../client/game.tsx');
const dailyTsx = source('../../client/daily-challenge.tsx');
const confirmationTsx = source('../../client/score-comment-confirmation.tsx');
const scoreComments = source('./score-comments.ts');
const campaignRoutes = source('../routes/api.ts');
const dailyRoutes = source('../routes/daily.ts');
const serverIndex = source('../index.ts');
const config = JSON.parse(source('../../../devvit.json')) as {
  post: { entrypoints: Record<string, { entry: string }> };
  permissions: { reddit: { asUser: string[] } };
  triggers: Record<string, string>;
};

void test('Devvit keeps the inline launch and expanded game as distinct entrypoints', () => {
  assert.equal(config.post.entrypoints.default?.entry, 'splash.html');
  assert.equal(config.post.entrypoints.game?.entry, 'game.html');
  assert.match(source('../../client/splash.html'), /splash\.tsx/);
  assert.match(source('../../client/game.html'), /game\.tsx/);
  assert.ok(config.permissions.reddit.asUser.includes('SUBMIT_COMMENT'));
});

void test('inline Daily splash does not lock the document or require inner scrolling', () => {
  assert.doesNotMatch(splashCss, /html\s*:\s*has\(\.daily-splash\)|body\s*:\s*has\(\.daily-splash\)/i);
  const rootRuleBlocks = [
    ...splashCss.matchAll(/(?:^|\n)\s*(?:html\s*,\s*body\s*,\s*#root|html|body|#root|\.splash-page|\.daily-splash)\s*\{([^}]*)\}/g),
  ].map((match) => match[1] ?? '').join('\n');
  assert.doesNotMatch(rootRuleBlocks, /overflow(?:-y)?\s*:\s*(?:hidden|auto|scroll)|overscroll-behavior(?:-y)?\s*:\s*(?:none|contain)|touch-action\s*:\s*none/i);
  assert.match(rootRuleBlocks, /overflow:\s*visible/i);
  assert.match(splashCss, /\.daily-splash\s*\{[^}]*height:\s*auto/s);
  assert.match(splashCss, /\.daily-splash\s*\{[^}]*min-height:\s*100svh/s);
  assert.match(splashCss, /\.daily-splash-stage\s*\{[^}]*max-height:\s*none/s);
});

void test('inline splash contains no wheel, touch, pointer, or keyboard scroll interception', () => {
  assert.doesNotMatch(splashTsx, /preventDefault\s*\(|stopPropagation\s*\(/);
  assert.doesNotMatch(splashTsx, /addEventListener\s*\(\s*['"](?:wheel|touchstart|touchmove|pointermove|keydown|keyup)['"]/i);
  assert.doesNotMatch(splashTsx, /setPointerCapture|releasePointerCapture/);
  assert.match(splashTsx, /requestExpandedMode\(event\.nativeEvent,\s*['"]game['"]\)/);
});

void test('vertical internal scrolling remains in the expanded game styles only', () => {
  assert.match(gameCss, /\.game-workspace[\s\S]*?overflow-y:\s*auto/);
  assert.match(dailyCss, /\.daily-game-page[\s\S]*?overflow-y:\s*auto/);
  assert.match(dailyCss, /\.daily-game-page\s+\.daily-extras\s*\{[^}]*overflow:\s*visible/s);
  assert.match(gameCss, /\.game-page[\s\S]*?overflow:\s*hidden/);
});

void test('generic campaign score comments are exclusively routed through the sticky reply helper', () => {
  const routeStart = campaignRoutes.indexOf("api.post('/share/campaign/comment'");
  const routeEnd = campaignRoutes.indexOf("api.post('/share/campaign/custom-comment'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const genericRoute = campaignRoutes.slice(routeStart, routeEnd);
  assert.match(genericRoute, /text:\s*campaignShareText\(state\)/);
  assert.match(genericRoute, /submitScoreCommentOnce\(/);
  assert.doesNotMatch(genericRoute, /body\.commentary|body\.text/);
  assert.match(scoreComments, /const parentId = await ensureStickyScoreThread\(options\.postId\)/);
  assert.match(scoreComments, /destination:\s*'sticky-reply'/);
  assert.match(scoreComments, /runAs:\s*'USER'/);
});

void test('generic Daily score comments are exclusively routed through the sticky reply helper', () => {
  const routeStart = dailyRoutes.indexOf("dailyApi.post('/share/comment'");
  const routeEnd = dailyRoutes.indexOf("dailyApi.post('/share/custom-comment'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const genericRoute = dailyRoutes.slice(routeStart, routeEnd);
  assert.match(genericRoute, /text:\s*formatDailyShareText\(result,\s*profile\.currentStreak\)/);
  assert.match(genericRoute, /submitScoreCommentOnce\(/);
  assert.doesNotMatch(genericRoute, /body\.commentary|body\.text/);
});

void test('custom top level comments require validated commentary and server generated score text', () => {
  assert.match(campaignRoutes, /validateMeaningfulCommentary\(commentary\)/);
  assert.match(dailyRoutes, /validateMeaningfulCommentary\(body\.commentary\)/);
  assert.match(campaignRoutes, /formatCustomScoreComment\(validation\.value,\s*campaignShareText\(state\)\)/);
  assert.match(dailyRoutes, /formatCustomScoreComment\([\s\S]*?formatDailyShareText\(result,\s*profile\.currentStreak\)/);
  assert.match(scoreComments, /parentId:\s*options\.postId,[\s\S]*?destination:\s*'custom-top-level'/);
});

void test('Campaign and Daily require a separate preview confirmation before generic or custom comments', () => {
  assert.match(gameTsx, /onClick=\{\(\) => setScoreCommentDialog\('score'\)\}/);
  assert.match(gameTsx, /onConfirm=\{confirmCampaignComment\}/);
  assert.match(gameTsx, /function confirmCampaignComment\(\)[\s\S]*?void shareCampaign\('comment'\)/);
  assert.match(dailyTsx, /onClick=\{\(\) => setScoreCommentDialog\('score'\)\}/);
  assert.match(dailyTsx, /onConfirm=\{confirmDailyComment\}/);
  assert.match(dailyTsx, /function confirmDailyComment\(\)[\s\S]*?void shareDailyComment\('comment'\)/);
  assert.match(confirmationTsx, /role="dialog"/);
  assert.match(confirmationTsx, /aria-modal="true"/);
  assert.match(confirmationTsx, /Confirm and comment as me/);
  assert.match(confirmationTsx, /public Reddit comment under your Reddit username/);
  assert.match(confirmationTsx, /<pre className="score-comment-preview">\{preview\}<\/pre>/);
});

void test('score comment records are cleaned on Reddit comment and post deletion', () => {
  assert.equal(config.triggers.onCommentDelete, '/internal/triggers/on-comment-delete');
  assert.equal(config.triggers.onPostDelete, '/internal/triggers/on-post-delete');
  assert.match(serverIndex, /cleanupDeletedScoreComment\(body\.postId,\s*body\.commentId\)/);
  assert.match(serverIndex, /cleanupDeletedScorePost\(body\.postId\)/);
  assert.match(scoreComments, /redis\.hGet\(indexKey,\s*commentId\)/);
  assert.match(scoreComments, /redis\.hGetAll\(indexKey\)/);
});

void test('comment submission has an authenticated user id, verified post context, and separate idempotency destination', () => {
  assert.match(campaignRoutes, /const userId = context\.userId/);
  assert.match(campaignRoutes, /const postId = context\.postId/);
  assert.match(dailyRoutes, /const userId = context\.userId/);
  assert.match(dailyRoutes, /const postId = context\.postId/);
  assert.match(scoreComments, /runAs:\s*'USER'/);
  assert.match(scoreComments, /destination: 'sticky-reply' \| 'custom-top-level'/);
  assert.match(scoreComments, /nx:\s*true/);
});
