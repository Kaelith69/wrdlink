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

function createDailyRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(16) + '-' + Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);
}

function pendingDailyRequestId(date: string, word: string): string {
  const key = `wrdlink-daily-pending:${date}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isRecord(parsed) && parsed.word === word && typeof parsed.id === 'string' &&
        /^[a-f0-9-]{20,80}$/i.test(parsed.id)) return parsed.id;
    const id = createDailyRequestId();
    window.sessionStorage.setItem(key, JSON.stringify({ word, id }));
    return id;
  } catch {
    return createDailyRequestId();
  }
}

function clearPendingDailyRequestId(date: string, requestId: string): void {
  try {
    const key = `wrdlink-daily-pending:${date}`;
    const raw = window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isRecord(parsed) && parsed.id === requestId) window.sessionStorage.removeItem(key);
  } catch { /* Session storage is optional. */ }
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
  const shareFeedbackRef = useRef<HTMLParagraphElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const boardRequestId = useRef(0);
  const puzzleLoadStarted = useRef(false);
  const pendingMoveRequest = useRef<{ date: string; word: string; id: string } | null>(null);
  const chainListRef = useRef<HTMLOListElement | null>(null);

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
    if (!completed || (!shareMessage && !error)) return;
    const feedback = shareFeedbackRef.current;
    if (!feedback) return;
    const frame = window.requestAnimationFrame(() => {
      feedback.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completed, shareMessage, error]);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [helpOpen]);

  useEffect(() => {
    const list = chainListRef.current;
    if (!list) return;
    list.scrollTo({
      top: list.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [words]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px), (pointer: coarse), (any-pointer: coarse)');
    const update = () => setUseVirtualKeyboard(media.matches || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
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
    const pending = pendingMoveRequest.current;
    const requestId = pending?.date === date && pending.word === word
      ? pending.id : pendingDailyRequestId(date, word);
    pendingMoveRequest.current = { date, word, id: requestId };
    try {
      const data = await request('/api/daily/validate', isDailyMoveResponse, {
        method: 'POST',
        body: JSON.stringify({ sessionId, date, puzzleId: puzzle.id, word, requestId }),
      });
      clearPendingDailyRequestId(date, requestId);
      pendingMoveRequest.current = null;
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
    return <main className="game-page daily-screen daily-game-page state-page"><div className="state-mark">WRDLINK</div><section className="loading-progress"><div className="loading-heading"><span className="loading-kicker">WRDLINK DAILY</span><h1>Preparing today’s puzzle</h1><p>Connecting the shared word ladder.</p></div><div className="loading-track"><span className="loading-fill" /></div></section></main>;
  }

  if (!puzzle) {
    return <main className="game-page daily-screen daily-game-page state-page"><div className="state-mark">WRDLINK</div><p className="state-error" role="alert">{error || 'Daily puzzle unavailable.'}</p><button className="ink-button" type="button" onClick={() => void loadPuzzle()}>Retry daily challenge</button><button className="secondary-button" type="button" onClick={onClose}>← Campaign</button></main>;
  }

  return (
    <main className={`game-page daily-game-page ${completed ? 'is-complete' : ''}`}>
      <header className="game-header daily-game-header">
        <div className="wordmark" aria-label="WRDLINK Daily challenge">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>WRDLINK</span>
          <span className="level-badge">DAILY</span>
        </div>
        <div className="header-right daily-header-actions">
          <div className="header-count" aria-label={'Score ' + score + ', moves ' + (words.length - 1)}>
            <span className="score-pill"><span className="metric-label">SCORE</span><strong>{score}</strong></span>
            <span className="moves-pill"><span className="metric-label">MOVES</span><strong>{words.length - 1}</strong></span>
          </div>
          <button className="mode-switch is-daily" type="button" onClick={onClose} aria-label="Daily mode selected. Switch to Campaign." aria-pressed={true} title="Switch to Campaign"><span className="mode-switch-option mode-switch-campaign-option" aria-hidden="true">CAMP</span><span className="mode-switch-option mode-switch-daily-option" aria-hidden="true">DAILY</span><span className="mode-switch-thumb" aria-hidden="true" /></button>
          <div className="header-hint-button daily-streak-indicator" aria-label={profile.currentStreak + ' day streak'} title={profile.currentStreak + ' day streak'}>
            <span aria-hidden="true">🔥</span><span className="header-hint-cost">{profile.currentStreak}</span>
          </div>
          <button className="header-help-button daily-guide-button" type="button" onClick={() => setHelpOpen(true)} aria-label="How to play today's daily challenge" title="How to play" aria-haspopup="dialog" aria-controls="daily-how-to-dialog" aria-expanded={helpOpen}>!</button>
        </div>
      </header>

      <div className="hint-confirmation-backdrop help-backdrop" id="daily-how-to-dialog" hidden={!helpOpen}>
        <section className="hint-confirmation help-dialog daily-help-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-help-title" aria-describedby="daily-help-intro">
          <div className="help-dialog-header">
            <span className="help-kicker">WRDLINK DAILY FIELD GUIDE</span>
            <button className="help-close-button" type="button" aria-label="Close daily guide" onClick={() => setHelpOpen(false)}>×</button>
          </div>
          <h2 id="daily-help-title">How to play</h2>
          <p id="daily-help-intro">Build a word ladder from today's shared start word to its target. Every step must be a real word and change exactly one letter.</p>

          <div className="help-section">
            <h3>The rules</h3>
            <ol className="help-rules">
              <li><strong>Change one letter.</strong> Each new word must be the same length as the previous word and differ by exactly one letter.</li>
              <li><strong>Use real words.</strong> Every entry must be a valid four letter word in the game's word list.</li>
              <li><strong>No repeats.</strong> A word can appear only once in your chain.</li>
              <li><strong>Reach the target.</strong> The target word must be the final word in your chain. You cannot continue after reaching it.</li>
            </ol>
          </div>

          <div className="help-section">
            <h3>Example ladder</h3>
            <div className="help-example" aria-label="COLD changes to CORD, then CARD, WARD, and WARM">
              {['COLD', 'CORD', 'CARD', 'WARD', 'WARM'].map((word, index) => (
                <span className="help-example-step" key={word}>
                  <strong>{word}</strong>
                  {index < 4 && <span aria-hidden="true">→</span>}
                </span>
              ))}
            </div>
            <p className="help-example-note">COLD → CORD changes L to R. CORD → CARD changes O to A. Continue one letter at a time until WARM.</p>
          </div>

          <div className="help-section">
            <h3>Scoring</h3>
            <ul className="help-rules">
              <li>You begin each daily puzzle with <strong>25 points</strong>.</li>
              <li>Every submitted move costs <strong>1 point</strong>, whether the word is accepted or rejected.</li>
              <li>Completing the puzzle awards <strong>25 points</strong>.</li>
              <li>Your score and move count are saved with your daily result and used for community rankings.</li>
            </ul>
          </div>

          <div className="help-section">
            <h3>Daily challenge rules</h3>
            <ul className="help-rules">
              <li>Everyone gets the <strong>same four letter puzzle</strong> for the day. There is one shared start word and target word.</li>
              <li>The puzzle resets at <strong>00:00 UTC (05:30 IST)</strong>. A new shared puzzle is then available.</li>
              <li>Daily results count toward your <strong>daily, weekly and all time</strong> community leaderboard standings.</li>
              <li>Complete consecutive daily puzzles to build your streak. A grace token can protect one missed day, and you can hold up to <strong>two</strong>.</li>
              <li>Daily puzzles do not use Campaign hints. Find the word ladder yourself, one letter at a time.</li>
            </ul>
          </div>

          <p>On touch devices, tap the on screen letter keys to build your word, then tap Submit. Your current chain remains visible as you play.</p>
          <button className="ink-button help-done-button" type="button" onClick={() => setHelpOpen(false)}>Got it</button>
        </section>
      </div>

      <section className="daily-guide" aria-labelledby="daily-guide-title">
        <div className="daily-guide-heading">
          <div>
            <p className="daily-guide-kicker">TODAY'S SHARED PUZZLE</p>
            <h1 id="daily-guide-title">Daily challenge <span>{date}</span></h1>
          </div>
        </div>
      </section>

      <div className="daily-game-content">
        <div className="game-workspace">
          <section className="route-panel daily-route-panel" aria-label={'Start word ' + puzzle.start + ', target word ' + puzzle.target}>
            <div className="route-end" aria-label={'Start word: ' + puzzle.start}>
              <div className="word-display" aria-hidden="true">{[...puzzle.start].map((letter, index) => <span key={index}>{letter}</span>)}</div>
            </div>
            <div className="route-connector" aria-hidden="true"><i /></div>
            <div className="route-end route-end-target" aria-label={'Target word: ' + puzzle.target}>
              <div className="word-display word-display-target" aria-hidden="true">{[...puzzle.target].map((letter, index) => <span key={index}>{letter}</span>)}</div>
            </div>
          </section>

          <section className="chain-panel card-panel" aria-label="Your word chain">
            <div className="panel-heading"><h2>Word ladder</h2></div>
            <ol className="chain-list" ref={chainListRef}>
              {words.map((word, index) => (
                <li className={word === puzzle.target ? 'chain-final' : ''} key={`${word}-${index}`}>
                  <span>{String(index).padStart(2, '0')}</span>
                  <b>{word}</b>
                </li>
              ))}
            </ol>
          </section>

          {!completed ? (
            <section className="entry-panel card-panel">
              <div className="entry-heading">
                <h2>Your next word</h2>
                <p>Daily challenge · {date} · Optimal path: {puzzle.optimalMoves} moves</p>
              </div>
              <form onSubmit={submitMove}>
                <label className="sr-only" htmlFor="daily-word-entry">Next four letter word</label>
                <input
                  id="daily-word-entry"
                  value={entry}
                  onChange={(event) => setEntry(event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4))}
                  placeholder="NEXT WORD"
                  maxLength={4}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  readOnly={useVirtualKeyboard}
                  disabled={busy}
                  aria-describedby={useVirtualKeyboard ? 'daily-keyboard-help' : undefined}
                />
                <button className="ink-button" type="submit" disabled={busy || entry.length !== 4}>
                  {busy ? 'Checking…' : 'Submit'} <span aria-hidden="true">→</span>
                </button>
              </form>
              {useVirtualKeyboard && (
                <div className="virtual-keyboard" aria-label="On screen letter keyboard">
                  <p id="daily-keyboard-help" className="virtual-keyboard-label">TAP LETTERS TO BUILD YOUR WORD</p>
                  {['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map((row, index) => (
                    <div className="virtual-keyboard-row" key={row}>
                      {[...row].map((letter) => (
                        <button className="virtual-key" key={letter} type="button"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => handleVirtualKey(letter)}
                          disabled={busy || entry.length >= 4} aria-label={letter}>{letter}</button>
                      ))}
                      {index === 2 && (
                        <button className="virtual-key virtual-key-utility" type="button"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => handleVirtualKey('BACKSPACE')}
                          disabled={busy || entry.length === 0} aria-label="Delete last letter">⌫</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {error && <p className="game-message error" role="alert">{error}</p>}
              {shareMessage && <p className="game-message" role="status">{shareMessage}</p>}
              <div className="entry-actions">
                <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Back to campaign</button>
              </div>
            </section>
          ) : (
            <section className="finish-panel daily-finish-panel" aria-labelledby="daily-completion-title">
              <h2 id="daily-completion-title">Daily challenge complete!</h2>
              <p className="finish-bonus">{result?.moves ?? words.length - 1} moves · {result?.score ?? score} points · Optimal: {puzzle.optimalMoves} moves</p>
              {shareMessage && <p ref={shareFeedbackRef} className="game-message daily-share-feedback" role="status">{shareMessage}</p>}
              {error && <p ref={shareFeedbackRef} className="game-message error daily-share-feedback" role="alert">{error}</p>}
              <p className="daily-campaign-prompt">Ready for another round? Your Campaign is waiting.</p>
              <button className="ink-button finish-next-button daily-campaign-button" type="button" onClick={onClose}>
                Play Campaign <span aria-hidden="true">→</span>
              </button>
              {result && (
                <section className="campaign-share-card" aria-label="Share completed daily puzzle">
                  <div className="campaign-share-preview">
                    <strong>WRDLINK DAILY · {date}</strong>
                    <b>{result.start} → {result.target}</b>
                  </div>
                  {ranked ? (
                    <>
                      <p>Sharing publishes under your Reddit account.</p>
                      <div className="campaign-share-actions">
                        <button type="button" onClick={() => void shareResult('post')} disabled={busy}>Post result as you</button>
                        <button type="button" onClick={() => void shareResult('comment')} disabled={busy}>Comment as you</button>
                      </div>
                    </>
                  ) : <p>Sign in to save a ranked result and share it to Reddit.</p>}
                </section>
              )}
            </section>
          )}
        </div>

        <section className="daily-extras" aria-label="Daily challenge progress and community">
          <section className="daily-profile card-panel">
            <div><strong>{profile.totalCompleted}</strong><span>DAILY SOLVES</span></div>
            <div><strong>{profile.bestStreak}</strong><span>BEST STREAK</span></div>
            <div><strong>{profile.graceTokens}</strong><span>GRACE TOKENS</span></div>
            <div><strong>{profile.totalScore}</strong><span>TOTAL SCORE</span></div>
          </section>

          <section className="daily-leaderboard card-panel">
            <div className="daily-section-heading">
              <div><p className="daily-eyebrow">COMMUNITY RANKINGS</p><h2>Leaderboard</h2></div>
              {myRank !== null && <span className="daily-rank">YOUR RANK #{myRank}</span>}
            </div>
            <div className="daily-controls">
              <div className="daily-tabs">
                {(['daily', 'weekly', 'alltime'] as const).map((value) => (
                  <button type="button" className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>
                    {value === 'daily' ? 'Daily' : value === 'weekly' ? 'Weekly' : 'Community'}
                  </button>
                ))}
              </div>
              <div className="daily-tabs metric-tabs">
                <button type="button" className={metric === 'score' ? 'active' : ''} onClick={() => setMetric('score')}>Score</button>
                <button type="button" className={metric === 'moves' ? 'active' : ''} onClick={() => setMetric('moves')}>Moves</button>
              </div>
            </div>
            <p className="daily-muted">{periodLabel} · {moveLabel}</p>
            {boardLoading ? <p className="daily-loading-message" role="status">Loading community rankings…</p> : boardError ? (
              <div className="daily-board-error">
                <p className="daily-error" role="alert">{boardError}</p>
                <button className="daily-refresh" type="button" onClick={() => void loadBoard()}>Retry leaderboard</button>
              </div>
            ) : board.length ? (
              <ol className="daily-board">
                {board.map((item) => <li key={item.rank}><span className="daily-board-rank">{String(item.rank).padStart(2, '0')}</span><strong>{item.username}</strong><span>{metric === 'score' ? item.score + ' pts' : item.moves + ' moves'}</span></li>)}
              </ol>
            ) : <p className="daily-empty">No completed runs yet. Set the first mark.</p>}
            {!boardLoading && !boardError && <button className="daily-refresh" type="button" onClick={() => void loadBoard()}>Refresh leaderboard</button>}
          </section>

          <section className="daily-achievements card-panel">
            <div className="daily-section-heading"><div><p className="daily-eyebrow">PLAYER PROGRESSION</p><h2>Achievements</h2></div></div>
            <div className="daily-achievement-grid">
              {achievementGoals.map((goal) => {
                const progress = Math.min(goal.target, goal.value(profile));
                const earned = profile.badges.includes(goal.id);
                return (
                  <div className={`daily-achievement-item ${earned ? 'is-earned' : ''}`} key={goal.id}>
                    <span className="daily-achievement-icon" aria-hidden="true">{earned ? '✦' : '◇'}</span>
                    <div><strong>{badgeNames[goal.id]}</strong><small>{goal.description}</small><span className="daily-achievement-progress">{progress}/{goal.target}</span></div>
                  </div>
                );
              })}
            </div>
            <p className="daily-muted">A grace token protects one missed day. Earn one every seven consecutive completions, up to two. Daily puzzles reset at 00:00 UTC, which is 05:30 IST.</p>
          </section>
        </section>
      </div>
    </main>
  );
}
