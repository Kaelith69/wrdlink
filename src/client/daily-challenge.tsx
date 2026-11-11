import { useCallback, useEffect, useState } from 'react';
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string' ? payload.error : 'The daily challenge request failed.';
    throw new Error(message);
  }
  return payload as T;
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
  const [error, setError] = useState('');
  const [shareMessage, setShareMessage] = useState('');

  const loadBoard = useCallback(async () => {
    try {
      const data = await request<BoardResponse>(`/api/daily/leaderboard?period=${period}&metric=${metric}`);
      setBoard(data.entries ?? []);
      setMyRank(data.currentUserRank ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load leaderboard.');
    }
  }, [period, metric]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<{
      date: string;
      puzzle: { id: string; start: string; target: string; optimalMoves: number };
      words: string[];
      score: number;
      completed: boolean;
      result: DailyResult | null;
      profile: DailyProfile;
      ranked: boolean;
    }>('/api/daily/init', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }).then((data) => {
      if (!active) return;
      setDate(data.date);
      setPuzzle(data.puzzle);
      setWords(data.words);
      setScore(data.score);
      setCompleted(data.completed);
      setResult(data.result);
      setProfile(data.profile ?? emptyProfile);
      setRanked(data.ranked);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load today’s puzzle.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => { void loadBoard(); }, [loadBoard]);

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
      const data = await request<{
        valid: boolean;
        complete: boolean;
        message: string;
        words: string[];
        score: number;
        result: DailyResult | null;
        profile: DailyProfile | null;
        newBadges: string[];
        graceUsed?: boolean;
        graceEarned?: boolean;
        ranked?: boolean;
      }>('/api/daily/validate', {
        method: 'POST',
        body: JSON.stringify({ sessionId, date, puzzleId: puzzle.id, word }),
      });
      setWords(data.words);
      setScore(data.score);
      setEntry('');
      if (!data.valid) {
        setError(data.message);
        return;
      }
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
      const data = await request<{ success: boolean; permalink?: string }>(`/api/daily/share/${kind}`, {
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

  const moveLabel = metric === 'moves' ? 'Fewest moves' : 'Highest score';
  const periodLabel = period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'All time';

  if (loading) {
    return <main className="daily-screen"><div className="daily-shell"><button className="daily-back" onClick={onClose}>← Campaign</button><p className="daily-muted">Preparing today’s shared puzzle…</p></div></main>;
  }

  if (!puzzle) {
    return <main className="daily-screen"><div className="daily-shell"><button className="daily-back" onClick={onClose}>← Campaign</button><p className="daily-error">{error || 'Daily puzzle unavailable.'}</p></div></main>;
  }

  return (
    <main className="daily-screen">
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
            {words.map((word, index) => <li className={word === puzzle.target ? 'is-target' : ''} key={index}><span>{String(index + 1).padStart(2, '0')}</span><b>{word}</b></li>)}
          </ol>

          {!completed ? (
            <form className="daily-entry" onSubmit={submitMove}>
              <input value={entry} onChange={(event) => setEntry(event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4))} placeholder="NEXT WORD" maxLength={4} autoComplete="off" spellCheck={false} disabled={busy}/>
              <button type="submit" disabled={busy || entry.length !== 4}>{busy ? 'Checking…' : 'Submit'}</button>
            </form>
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
                <small>Play again tomorrow · r/WRDLINK</small>
              </div>
              {ranked ? (
                <p className="daily-muted">These actions publish under your Reddit account.</p>
                <div className="daily-share-actions">
                  <button type="button" onClick={() => void shareResult('post')} disabled={busy}>Post result as you</button>
                  <button type="button" className="daily-secondary" onClick={() => void shareResult('comment')} disabled={busy}>Comment as you</button>
                </div>
              ) : <p className="daily-muted">Sign in to save a ranked result and share it to Reddit.</p>}
            </div>
          )}
        </section>

        <section className="daily-profile">
          <div><strong>{profile.totalCompleted}</strong><span>PUZZLES</span></div>
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
          {board.length ? (
            <ol className="daily-board">
              {board.map((item) => <li key={item.rank}><span className="daily-board-rank">{String(item.rank).padStart(2, '0')}</span><strong>{item.username}</strong><span>{metric === 'score' ? item.score + ' pts' : item.moves + ' moves'}</span></li>)}
            </ol>
          ) : <p className="daily-empty">No completed runs yet. Set the first mark.</p>}
          <button className="daily-refresh" type="button" onClick={() => void loadBoard()}>Refresh leaderboard</button>
        </section>

        <section className="daily-achievements">
          <div className="daily-section-heading"><div><p className="daily-eyebrow">PLAYER PROGRESSION</p><h2>Achievements</h2></div></div>
          {profile.badges.length ? <div className="daily-badges">{profile.badges.map((badge) => <span key={badge}>✦ {badgeNames[badge] ?? badge}</span>)}</div> : <p className="daily-muted">Complete daily puzzles to unlock badges.</p>}
          <p className="daily-muted">A grace token protects one missed day. Earn one every seven consecutive completions, up to two.</p>
        </section>
      </div>
    </main>
  );
}
