import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './daily.css';

type DailyResult = {
  date: string;
  start: string;
  target: string;
  words: string[];
  moves: number;
  score: number;
  optimalMoves: number;
  hintsUsed: number;
  completedAt: number;
};

type DailyProfile = {
  totalCompleted: number;
  totalScore: number;
  totalMoves: number;
  currentStreak: number;
  bestStreak: number;
  lastDailyDate: string | null;
  graceTokens: number;
  badges: string[];
};

type BoardEntry = {
  rank: number;
  username: string;
  score: number;
  moves: number;
  completedCount: number;
};

type BoardResponse = {
  entries: BoardEntry[];
  currentUserRank: number | null;
};

type Props = { sessionId: string; onClose: () => void };

const emptyProfile: DailyProfile = {
  totalCompleted: 0, totalScore: 0, totalMoves: 0,
  currentStreak: 0, bestStreak: 0, lastDailyDate: null, graceTokens: 0, badges: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDailyResult(value: unknown): value is DailyResult {
  return isRecord(value) && typeof value.date === 'string' && typeof value.start === 'string' &&
    typeof value.target === 'string' && Array.isArray(value.words) &&
    value.words.every((word) => typeof word === 'string') &&
    typeof value.moves === 'number' && typeof value.score === 'number' &&
    typeof value.optimalMoves === 'number' && typeof value.hintsUsed === 'number' &&
    typeof value.completedAt === 'number';
}

function isDailyProfile(value: unknown): value is DailyProfile {
  return isRecord(value) && typeof value.totalCompleted === 'number' &&
    typeof value.totalScore === 'number' && typeof value.totalMoves === 'number' &&
    typeof value.currentStreak === 'number' && typeof value.bestStreak === 'number' &&
    (typeof value.lastDailyDate === 'string' || value.lastDailyDate === null) &&
    typeof value.graceTokens === 'number' && Array.isArray(value.badges) &&
    value.badges.every((badge) => typeof badge === 'string');
}

function isBoardResponse(value: unknown): value is BoardResponse {
  return isRecord(value) && Array.isArray(value.entries) &&
    value.entries.every((entry) => isRecord(entry) && typeof entry.rank === 'number' &&
      typeof entry.username === 'string' && typeof entry.score === 'number' &&
      typeof entry.moves === 'number' && typeof entry.completedCount === 'number') &&
    (typeof value.currentUserRank === 'number' || value.currentUserRank === null);
}

function isDailyInit(value: unknown): value is {
  date: string;
  puzzle: { id: string; start: string; target: string; optimalMoves: number };
  words: string[];
  score: number;
  completed: boolean;
  result: DailyResult | null;
  profile: DailyProfile;
  ranked: boolean;
} {
  return isRecord(value) && typeof value.date === 'string' && isRecord(value.puzzle) &&
    typeof value.puzzle.id === 'string' && typeof value.puzzle.start === 'string' &&
    typeof value.puzzle.target === 'string' && typeof value.puzzle.optimalMoves === 'number' &&
    Array.isArray(value.words) && value.words.every((word) => typeof word === 'string') &&
    typeof value.score === 'number' && typeof value.completed === 'boolean' &&
    (value.result === null || isDailyResult(value.result)) &&
    isDailyProfile(value.profile) && typeof value.ranked === 'boolean';
}

function isDailyMoveResponse(value: unknown): value is {
  valid: boolean; complete: boolean; message: string; words: string[]; score: number;
  result: DailyResult | null; profile: DailyProfile | null; newBadges: string[];
  graceUsed?: boolean; graceEarned?: boolean; ranked?: boolean;
} {
  return isRecord(value) && typeof value.valid === 'boolean' &&
    typeof value.complete === 'boolean' && typeof value.message === 'string' &&
    Array.isArray(value.words) && value.words.every((word) => typeof word === 'string') &&
    typeof value.score === 'number' && (value.result === null || isDailyResult(value.result)) &&
    (value.profile === null || isDailyProfile(value.profile)) &&
    Array.isArray(value.newBadges) && value.newBadges.every((badge) => typeof badge === 'string');
}

function isShareResponse(value: unknown): value is { success: boolean; permalink?: string } {
  return isRecord(value) && value.success === true &&
    (value.permalink === undefined || typeof value.permalink === 'string');
}

async function request<T>(url: string, validate: (value: unknown) => value is T, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error : 'The daily challenge request failed.';
      throw new Error(message);
    }
    if (!validate(payload)) throw new Error('The daily challenge response was invalid.');
    return payload;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('The request timed out. Check your connection and try again.', { cause });
    }
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}

const badgeNames: Record<string, string> = {
  FIRST_SOLVE: 'First solve',
  FIVE_SOLVES: '5 puzzles',
  TWENTY_FIVE_SOLVES: '25 puzzles',
  HUNDRED_SOLVES: '100 puzzles',
  OPTIMAL_PATH: 'Optimal path',
  PERFECT_SOLVE: 'Perfect solve',
  STREAK_3: '3 day streak',
  STREAK_7: '7 day streak',
  STREAK_30: '30 day streak',
};

const achievementGoals = [
  { id: 'FIRST_SOLVE', target: 1, description: 'Complete your first daily puzzle', value: (p: DailyProfile) => p.totalCompleted },
  { id: 'FIVE_SOLVES', target: 5, description: 'Complete five daily puzzles', value: (p: DailyProfile) => p.totalCompleted },
  { id: 'TWENTY_FIVE_SOLVES', target: 25, description: 'Complete 25 daily puzzles', value: (p: DailyProfile) => p.totalCompleted },
  { id: 'HUNDRED_SOLVES', target: 100, description: 'Complete 100 daily puzzles', value: (p: DailyProfile) => p.totalCompleted },
  { id: 'STREAK_3', target: 3, description: 'Maintain a three day streak', value: (p: DailyProfile) => p.bestStreak },
  { id: 'STREAK_7', target: 7, description: 'Maintain a seven day streak', value: (p: DailyProfile) => p.bestStreak },
  { id: 'STREAK_30', target: 30, description: 'Maintain a 30 day streak', value: (p: DailyProfile) => p.bestStreak },
  { id: 'OPTIMAL_PATH', target: 1, description: 'Solve a puzzle in the optimal number of moves', value: (p: DailyProfile) => p.badges.includes('OPTIMAL_PATH') ? 1 : 0 },
  { id: 'PERFECT_SOLVE', target: 1, description: 'Find an optimal path without hints or penalties', value: (p: DailyProfile) => p.badges.includes('PERFECT_SOLVE') ? 1 : 0 },
];

export function DailyChallenge({ sessionId, onClose }: Props) {
  const [date, setDate] = useState('');
  const [puzzle, setPuzzle] = useState<{ id: string; start: string; target: string; optimalMoves: number } | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [entry, setEntry] = useState('');
  const [score, setScore] = useState(25);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<DailyResult | null>(null);
  const [profile, setProfile] = useState<DailyProfile>(emptyProfile);
  const [ranked, setRanked] = useState(false);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'alltime'>('daily');
  const [metric, setMetric] = useState<'score' | 'moves'>('score');
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState('');
  const [error, setError] = useState('');
  const [useVirtualKeyboard, setUseVirtualKeyboard] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const boardRequestId = useRef(0);
  const puzzleLoadStarted = useRef(false);

  const loadBoard = useCallback(async () => {
    const requestId = ++boardRequestId.current;
    setBoardLoading(true);
    setBoardError('');
    setMyRank(null);
    try {
      const data = await request<BoardResponse>(`/api/daily/leaderboard?period=${period}&metric=${metric}`, isBoardResponse);
      if (requestId !== boardRequestId.current) return;
      setBoard(data.entries);
      setMyRank(data.currentUserRank);
    } catch (cause) {
      if (requestId === boardRequestId.current) {
        setBoardError(cause instanceof Error ? cause.message : 'Could not load leaderboard.');
      }
    } finally {
      if (requestId === boardRequestId.current) setBoardLoading(false);
    }
  }, [period, metric]);

  const loadPuzzle = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request('/api/daily/init', isDailyInit, {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      setDate(data.date);
      setPuzzle(data.puzzle);
      setWords(data.words);
      setScore(data.score);
      setCompleted(data.completed);
      setResult(data.result);
      setProfile(data.profile);
      setRanked(data.ranked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load today’s puzzle.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (puzzleLoadStarted.current) return;
    puzzleLoadStarted.current = true;
    void Promise.resolve().then(() => loadPuzzle());
  }, [loadPuzzle]);
  useEffect(() => { void Promise.resolve().then(() => loadBoard()); }, [loadBoard]);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse), (any-pointer: coarse)');
    const update = () => setUseVirtualKeyboard(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function handleVirtualKey(key: string) {
    if (busy || completed) return;
    if (key === 'BACKSPACE') {
      setEntry((current) => current.slice(0, -1));
      return;
    }
    if (!/^[A-Z]$/.test(key)) return;
    setEntry((current) => current.length < 4 ? current + key : current);
  }

  async function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!puzzle || busy || completed) return;
    const word = entry.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(word)) {
      setError('Enter a four letter word.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/daily/validate', isDailyMoveResponse, {
        method: 'POST',
        body: JSON.stringify({ sessionId, date, puzzleId: puzzle.id, word }),
      });
      setWords(data.words);
      setScore(data.score);
      if (!data.valid) {
        setError(data.message);
        return;
      }
      setEntry('');
      if (data.complete) {
        setCompleted(true);
        setResult(data.result);
        if (data.profile) setProfile(data.profile);
        setRanked(Boolean(data.ranked));
        const messages = [data.message];
        if (data.graceUsed) messages.push('Your streak grace day was used.');
        if (data.graceEarned) messages.push('You earned a streak grace token.');
        if (data.newBadges.length) messages.push('New badges: ' + data.newBadges.map((badge) => badgeNames[badge] ?? badge).join(', '));
        setShareMessage(messages.join(' '));
        await loadBoard();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit that word.');
    } finally {
      setBusy(false);
    }
  }

  async function shareResult(kind: 'post' | 'comment') {
    if (!result || !ranked || busy) return;
    setBusy(true);
    setError('');
    setShareMessage('');
    try {
      const data = await request(`/api/daily/share/${kind}`, isShareResponse, {
        method: 'POST',
        body: JSON.stringify({ date }),
      });
      setShareMessage(kind === 'post'
        ? 'Your result was posted to the community.'
        : 'Your result was shared as a comment on this game post.');
      if (data.permalink) setShareMessage('Your result was posted. Open it from your Reddit profile.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share your result.');
    } finally {
      setBusy(false);
    }
  }

  let moveLabel = 'Highest score';
  if (metric === 'moves') moveLabel = period === 'daily' ? 'Fewest moves' : 'Fewest average moves';
  const periodLabel = period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'All time';

  if (loading) {
    return <main className="daily-screen"><div className="daily-shell daily-state"><button className="daily-back" type="button" onClick={onClose}>← Campaign</button><p className="daily-muted">Preparing today’s shared puzzle…</p><div className="daily-loading-track"><span /></div></div></main>;
  }

  if (!puzzle) {
    return <main className="daily-screen"><div className="daily-shell daily-state"><button className="daily-back" type="button" onClick={onClose}>← Campaign</button><p className="daily-error" role="alert">{error || 'Daily puzzle unavailable.'}</p><button className="daily-retry" type="button" onClick={() => void loadPuzzle()}>Retry daily challenge</button></div></main>;
  }

  return (
    <main className={`daily-screen ${completed ? 'is-complete' : ''}`}>
      <div className="daily-shell">
        <header className="daily-header">
          <button className="daily-back" type="button" onClick={onClose}>← Campaign</button>
          <span className="daily-kicker">WRDLINK · DAILY</span>
          <span className="daily-date">{date}</span>
        </header>

        <section className="daily-intro">
          <div>
            <p className="daily-eyebrow">ONE SHARED PUZZLE</p>
            <h1>Daily challenge</h1>
            <p>Same words for everyone. One new path each day.</p>
          </div>
          <div className="daily-streak"><strong>{profile.currentStreak}</strong><span>DAY STREAK</span></div>
        </section>

        <section className="daily-puzzle-card">
          <div className="daily-endpoints">
            <div><span>START</span><strong>{puzzle.start}</strong></div>
            <i aria-hidden="true">→</i>
            <div><span>TARGET</span><strong>{puzzle.target}</strong></div>
          </div>
          <div className="daily-stats">
            <div><strong>{words.length - 1}</strong><span>MOVES</span></div>
            <div><strong>{score}</strong><span>SCORE</span></div>
            <div><strong>{puzzle.optimalMoves}</strong><span>OPTIMAL</span></div>
          </div>
          <ol className="daily-chain">
            {words.map((word, index) => <li className={word === puzzle.target ? 'is-target' : ''} key={`${word}-${index}`}><span>{String(index).padStart(2, '0')}</span><b>{word}</b></li>)}
          </ol>

          {!completed ? (
            <>
            <form className="daily-entry" onSubmit={submitMove}>
              <label className="sr-only" htmlFor="daily-word-entry">Next four letter word</label>
              <input id="daily-word-entry" value={entry} onChange={(event) => setEntry(event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4))} placeholder="NEXT WORD" maxLength={4} autoComplete="off" autoCapitalize="characters" spellCheck={false} readOnly={useVirtualKeyboard} disabled={busy} aria-describedby={useVirtualKeyboard ? 'daily-keyboard-help' : undefined}/>
              <button type="submit" disabled={busy || entry.length !== 4}>{busy ? 'Checking…' : 'Submit'}</button>
            </form>
            {useVirtualKeyboard && !completed && (
              <div className="daily-virtual-keyboard" aria-label="On screen letter keyboard">
                <p id="daily-keyboard-help" className="daily-keyboard-label">TAP LETTERS TO BUILD YOUR WORD</p>
                {['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map((row, index) => (
                  <div className="daily-virtual-keyboard-row" key={row}>
                    {[...row].map((letter) => (
                      <button className="daily-virtual-key" key={letter} type="button"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => handleVirtualKey(letter)}
                        disabled={busy || entry.length >= 4} aria-label={letter}>{letter}</button>
                    ))}
                    {index === 2 && <button className="daily-virtual-key daily-key-utility" type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => handleVirtualKey('BACKSPACE')}
                      disabled={busy || entry.length === 0} aria-label="Delete last letter">⌫</button>}
                  </div>
                ))}
              </div>
            )}
            </>
          ) : (
            <div className="daily-complete">
              <span>✓</span>
              <div><strong>Connected.</strong><small>{result?.moves ?? words.length - 1} moves · {result?.score ?? score} points</small></div>
            </div>
          )}
          {error && <p className="daily-error" role="alert">{error}</p>}
          {shareMessage && <p className="daily-success" role="status">{shareMessage}</p>}
          {completed && result && (
            <div className="daily-share">
              <div className="daily-share-preview">
                <strong>WRDLINK DAILY · {date}</strong>
                <span>{result.start} → {result.target}</span>
                <small>{result.moves} moves · {result.score} points · Completed</small>
                <code>{result.words.join(' → ')}</code>
                <a href="https://www.reddit.com/r/WRDLINK/" target="_blank" rel="noreferrer">Play WRDLINK ↗</a>
              </div>
              {ranked ? (
                <>
                <p className="daily-muted">These actions publish under your Reddit account.</p>
                <div className="daily-share-actions">
                  <button type="button" onClick={() => void shareResult('post')} disabled={busy}>Post result as you</button>
                  <button type="button" className="daily-secondary" onClick={() => void shareResult('comment')} disabled={busy}>Comment as you</button>
                </div>
                </>
              ) : <p className="daily-muted">Sign in to save a ranked result and share it to Reddit.</p>}
            </div>
          )}
        </section>

        <section className="daily-profile">
          <div><strong>{profile.totalCompleted}</strong><span>DAILY SOLVES</span></div>
          <div><strong>{profile.bestStreak}</strong><span>BEST STREAK</span></div>
          <div><strong>{profile.graceTokens}</strong><span>GRACE TOKENS</span></div>
          <div><strong>{profile.totalScore}</strong><span>TOTAL SCORE</span></div>
        </section>

        <section className="daily-leaderboard">
          <div className="daily-section-heading"><div><p className="daily-eyebrow">COMMUNITY RANKINGS</p><h2>Leaderboard</h2></div>{myRank !== null && <span className="daily-rank">YOUR RANK #{myRank}</span>}</div>
          <div className="daily-controls">
            <div className="daily-tabs">
              {(['daily', 'weekly', 'alltime'] as const).map((value) => <button type="button" className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>{value === 'daily' ? 'Daily' : value === 'weekly' ? 'Weekly' : 'Community'}</button>)}
            </div>
            <div className="daily-tabs metric-tabs">
              <button type="button" className={metric === 'score' ? 'active' : ''} onClick={() => setMetric('score')}>Score</button>
              <button type="button" className={metric === 'moves' ? 'active' : ''} onClick={() => setMetric('moves')}>Moves</button>
            </div>
          </div>
          <p className="daily-muted">{periodLabel} · {moveLabel}</p>
          {boardLoading ? <p className="daily-loading-message" role="status">Loading community rankings…</p> : boardError ? <div className="daily-board-error"><p className="daily-error" role="alert">{boardError}</p><button className="daily-refresh" type="button" onClick={() => void loadBoard()}>Retry leaderboard</button></div> : board.length ? (
            <ol className="daily-board">
              {board.map((item) => <li key={item.rank}><span className="daily-board-rank">{String(item.rank).padStart(2, '0')}</span><strong>{item.username}</strong><span>{metric === 'score' ? item.score + ' pts' : item.moves + ' moves'}</span></li>)}
            </ol>
          ) : <p className="daily-empty">No completed runs yet. Set the first mark.</p>}
          {!boardLoading && !boardError && <button className="daily-refresh" type="button" onClick={() => void loadBoard()}>Refresh leaderboard</button>}
        </section>

        <section className="daily-achievements">
          <div className="daily-section-heading"><div><p className="daily-eyebrow">PLAYER PROGRESSION</p><h2>Achievements</h2></div></div>
          <div className="daily-achievement-grid">
            {achievementGoals.map((goal) => {
              const progress = Math.min(goal.target, goal.value(profile));
              const earned = profile.badges.includes(goal.id);
              return <div className={`daily-achievement-item ${earned ? 'is-earned' : ''}`} key={goal.id}>
                <span className="daily-achievement-icon" aria-hidden="true">{earned ? '✦' : '◇'}</span>
                <div><strong>{badgeNames[goal.id]}</strong><small>{goal.description}</small><span className="daily-achievement-progress">{progress}/{goal.target}</span></div>
              </div>;
            })}
          </div>
          <p className="daily-muted">A grace token protects one missed day. Earn one every seven consecutive completions, up to two. Daily puzzles reset at 00:00 UTC, which is 05:30 IST.</p>
        </section>
      </div>
    </main>
  );
}
