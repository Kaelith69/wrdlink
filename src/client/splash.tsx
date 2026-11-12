import './splash.css';

import { StrictMode, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';

type DailyPostData = {
  kind?: unknown;
  date?: unknown;
  start?: unknown;
  target?: unknown;
};

type DailyPreview = {
  profile: {
    currentStreak: number;
    bestStreak: number;
    totalPoints: number;
  } | null;
  highScore: number | null;
  highScoreMoves: number | null;
  hasHighScore: boolean;
};

const postData = context.postData as unknown as DailyPostData | undefined;
const dailyDate = typeof postData?.date === 'string' ? postData.date : '';
const dailyStart = typeof postData?.start === 'string' ? postData.start : '';
const dailyTarget = typeof postData?.target === 'string' ? postData.target : '';
const isDailyPost = postData?.kind === 'daily-challenge' &&
  /^\\d{4}-\\d{2}-\\d{2}$/.test(dailyDate) &&
  /^[A-Z]{4}$/.test(dailyStart) &&
  /^[A-Z]{4}$/.test(dailyTarget);

function formatDate(value: string): string {
  const date = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function Splash() {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<DailyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(isDailyPost);
  const launchRequested = useRef(false);

  useEffect(() => {
    if (!isDailyPost) return;
    let active = true;
    fetch(`/api/daily/post-preview?date=${encodeURIComponent(dailyDate)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Daily stats are temporarily unavailable.');
        return await response.json() as DailyPreview;
      })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((reason: unknown) => {
        console.warn('Could not load WRDLINK Daily preview stats:', reason);
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function play(event: MouseEvent<HTMLButtonElement>) {
    if (launchRequested.current || launching) return;

    launchRequested.current = true;
    setLaunching(true);
    setError('');

    try {
      await requestExpandedMode(event.nativeEvent, 'game');
    } catch (reason) {
      console.error('Could not open WRDLINK:', reason);
      setError('The game could not open here. Try again from the post.');
      launchRequested.current = false;
      setLaunching(false);
    }
  }

  if (isDailyPost) {
    const profile = preview?.profile;
    const highScoreLabel = previewLoading
      ? 'Loading'
      : preview?.hasHighScore && preview.highScore !== null
        ? `${preview.highScore} pts`
        : 'UP FOR GRABS';

    return (
      <main className="splash-page daily-splash">
        <section className="splash-stage daily-splash-stage" aria-label="Today's WRDLINK Daily challenge">
          <div className="daily-post-kicker">
            <span>WRDLINK DAILY</span>
            <span>{formatDate(dailyDate)}</span>
          </div>
          <h1>Can you connect these words?</h1>
          <p className="daily-post-intro">One letter at a time. Find the word bridge that gets you to the target.</p>

          <div className="daily-word-bridge" aria-label={`Start word ${dailyStart}, target word ${dailyTarget}`}>
            <strong className="daily-start-word">{dailyStart}</strong>
            <span aria-hidden="true">→</span>
            <strong className="daily-target-word">{dailyTarget}</strong>
          </div>

          <div className="daily-post-rules">
            <span>THE RULES</span>
            <p>Change exactly one letter per move.</p>
            <p>Every step must be a valid four letter word.</p>
            <p>Do not reuse a word.</p>
          </div>

          <div className="daily-post-stats">
            <div className="daily-post-stat">
              <span>YOUR CURRENT STREAK</span>
              <strong>{profile ? `${profile.currentStreak} days` : 'Sign in to track'}</strong>
            </div>
            <div className="daily-post-stat">
              <span>YOUR BEST STREAK</span>
              <strong>{profile ? `${profile.bestStreak} days` : 'Sign in to track'}</strong>
            </div>
            <div className="daily-post-stat">
              <span>YOUR TOTAL POINTS</span>
              <strong>{profile ? profile.totalPoints.toLocaleString('en-US') : 'Sign in to track'}</strong>
            </div>
            <div className="daily-post-stat daily-high-score">
              <span>TODAY'S HIGH SCORE</span>
              <strong>{highScoreLabel}</strong>
              {preview?.highScoreMoves !== null && preview?.highScoreMoves !== undefined && (
                <small>{preview.highScoreMoves} moves</small>
              )}
            </div>
          </div>

          <p className="daily-post-challenge">
            Can you beat today's high score? Can you solve it in fewer moves?
          </p>

          <button className="start-button daily-play-button" onClick={play} disabled={launching} aria-busy={launching}>
            {launching ? 'Opening puzzle…' : "PLAY TODAY'S PUZZLE"}
            {!launching && <span aria-hidden="true">→</span>}
          </button>
          {launching && <div className="daily-launch-progress" role="status" aria-live="polite">Opening your daily challenge…</div>}
          {error && <p className="launch-error" role="alert">{error}</p>}
          <p className="daily-post-footnote">Your streak and points are personal. Today's high score is shared with everyone.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="splash-page">
      <section className="splash-stage" aria-label="WRDLINK word transformation game">
        <span className="splash-line splash-line-top" aria-hidden="true" />
        <div className="logo-lockup">
          <div className="logo-row logo-row-violet">
            {['W', 'R', 'D'].map((letter, index) => (
              <span className="logo-tile" key={letter} style={{ '--tile-index': index } as CSSProperties}>{letter}</span>
            ))}
          </div>
          <div className="logo-row logo-row-tangerine">
            {['L', 'I', 'N', 'K'].map((letter, index) => (
              <span className="logo-tile" key={letter} style={{ '--tile-index': index + 3 } as CSSProperties}>{letter}</span>
            ))}
          </div>
          <span className="splash-line splash-line-bottom" aria-hidden="true" />
        </div>
        <p className="splash-subtitle">WORD TRANSFORMATION GAME</p>
        <p className="splash-instructions">Change one letter at a time. Use real four letter words, never repeat a word, and reach the target to complete the puzzle.</p>
        <button className="start-button" onClick={play} disabled={launching} aria-busy={launching}>
          {launching ? 'Opening…' : 'Play puzzle'}
        </button>
        {error && <p className="launch-error" role="alert">{error}</p>}
      </section>
      <div className="splash-progress" aria-label="Game introduction progress">
        <span /><span className="active" /><span />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
