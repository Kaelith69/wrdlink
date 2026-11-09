import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse, MoveValidationResponse, Puzzle } from '../shared/api';

type GameStatus = 'playing' | 'won' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getSessionId(): string {
  const key = 'wrdlink-session';
  const createId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = createId();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch (error) {
    console.error('WRDLINK browser session storage is unavailable:', error);
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function isInitResponse(value: unknown): value is InitResponse {
  if (!isRecord(value) || !isRecord(value.puzzle)) return false;
  return typeof value.puzzle.id === 'string' && typeof value.puzzle.title === 'string' &&
    typeof value.puzzle.start === 'string' && typeof value.puzzle.target === 'string' &&
    typeof value.puzzle.wordLength === 'number' && typeof value.puzzle.optimalMoves === 'number' &&
    typeof value.sessionId === 'string' && typeof value.gameScore === 'number' &&
    typeof value.level === 'number' && Array.isArray(value.words) &&
    value.words.every((word) => typeof word === 'string') &&
    typeof value.hintsUsed === 'number' && typeof value.movesUsed === 'number' &&
    typeof value.completed === 'boolean';
}

function isMoveResponse(value: unknown): value is MoveValidationResponse {
  return isRecord(value) && typeof value.valid === 'boolean' &&
    typeof value.complete === 'boolean' && typeof value.message === 'string' &&
    typeof value.movesUsed === 'number' && typeof value.pointsAwarded === 'number' &&
    typeof value.gameScore === 'number' && Array.isArray(value.words) &&
    value.words.every((word) => typeof word === 'string') &&
    typeof value.level === 'number' && typeof value.hintsUsed === 'number';
}

function Word({ word, target = false }: { word: string; target?: boolean }) {
  return (
    <div className={`word-display ${target ? 'word-display-target' : ''}`} aria-label={word}>
      {[...word].map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
    </div>
  );
}

function LoadingProgress() {
  return (
    <div className="loading-progress" aria-label="Loading puzzle">
      <div className="loading-letters" aria-hidden="true">
        {'WRDLINK'.split('').map((letter, index) => (
          <span className="loading-tile" key={`${letter}-${index}`} style={{ '--tile-index': index } as CSSProperties}>
            {letter}
          </span>
        ))}
      </div>
      <div className="loading-track" role="progressbar" aria-label="Loading puzzle" aria-busy="true">
        <span className="loading-fill" />
      </div>
      <p className="loading-label" role="status">Loading puzzle</p>
    </div>
  );
}

export function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [entry, setEntry] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error'>('info');
  const [status, setStatus] = useState<GameStatus>('playing');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(1);
  const [gameScore, setGameScore] = useState(25);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const [hintConfirmation, setHintConfirmation] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const stored = window.localStorage.getItem('wrdlink-theme');
      return stored === 'light' || stored === 'dark' ? stored : 'dark';
    } catch (error) {
      console.warn('WRDLINK theme storage is unavailable:', error);
      return 'dark';
    }
  });
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useMemo(() => getSessionId(), []);

  const movesUsed = words.length - 1;
  const nextHintCost = 5 + hintsUsed;
  const hintTotalCost = nextHintCost + 1;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const commitPuzzle = (data: InitResponse) => {
    const update = () => {
      setPuzzle(data.puzzle);
      setWords(data.words);
      setEntry('');
      setLevel(data.level);
      setGameScore(data.gameScore);
      setHintsUsed(data.hintsUsed);
      setStatus(data.completed ? 'won' : 'playing');
      setCelebrationPoints(null);
      setHintConfirmation(false);
    };
    const startViewTransition = Reflect.get(document, 'startViewTransition');
    if (typeof startViewTransition === 'function') startViewTransition.call(document, update);
    else update();
  };

  const loadPuzzle = useCallback(async (
    signal?: AbortSignal,
    options: { newGame?: boolean; nextLevel?: boolean } = {}
  ) => {
    if (signal?.aborted) return;
    setLoading(true);
    setStatus('playing');
    setMessage('');
    try {
      const query = new URLSearchParams({ sessionId });
      if (options.newGame) query.set('newGame', 'true');
      if (options.nextLevel) query.set('nextLevel', 'true');
      const response = await fetch(`/api/init?${query.toString()}`, signal ? { signal } : undefined);
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const data: unknown = await response.json();
      if (!isInitResponse(data)) throw new Error('The puzzle response was invalid.');
      commitPuzzle(data);
    } catch (error) {
      if (signal?.aborted) return;
      console.error('WRDLINK initialization failed:', error);
      setStatus('error');
      setMessage('The puzzle could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadPuzzle(controller.signal));
    return () => {
      controller.abort();
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    };
  }, [loadPuzzle]);

  async function startNewGame() {
    if (busy) return;
    setBusy(true);
    try {
      await loadPuzzle(undefined, { newGame: true });
    } finally {
      setBusy(false);
    }
  }

  async function startNextLevel() {
    if (busy || status !== 'won') return;
    setBusy(true);
    try {
      await loadPuzzle(undefined, { nextLevel: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!puzzle || busy || status !== 'playing') return;
    const candidate = entry.trim().toUpperCase();
    if (!new RegExp(`^[A-Z]{${puzzle.wordLength}}$`).test(candidate)) {
      setMessage(`Use ${puzzle.wordLength} letters.`);
      setMessageType('error');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, puzzleId: puzzle.id, word: candidate }),
      });
      if (!response.ok) throw new Error(`Validation failed with status ${response.status}`);
      const result: unknown = await response.json();
      if (!isMoveResponse(result)) throw new Error('The validation response was invalid.');
      setMessage(result.message);
      setMessageType(result.valid ? 'info' : 'error');
      if (!result.valid) return;
      setWords(result.words);
      setGameScore(result.gameScore);
      setHintsUsed(result.hintsUsed);
      setEntry('');
      if (result.complete) {
        setStatus('won');
        setCelebrationPoints(result.pointsAwarded);
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
        celebrationTimer.current = setTimeout(() => setCelebrationPoints(null), 1800);
      }
    } catch (error) {
      console.error('WRDLINK move validation failed:', error);
      setMessage('Connection lost. Your chain is unchanged.');
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmHint() {
    if (!puzzle || busy || status !== 'playing') return;
    setHintConfirmation(false);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, puzzleId: puzzle.id }),
      });
      if (!response.ok) throw new Error(`Hint failed with status ${response.status}`);
      const result: unknown = await response.json();
      if (!isRecord(result) || typeof result.valid !== 'boolean' ||
          typeof result.complete !== 'boolean' || typeof result.message !== 'string' ||
          !Array.isArray(result.words) || !result.words.every((word) => typeof word === 'string') ||
          typeof result.gameScore !== 'number' || typeof result.hintsUsed !== 'number' ||
          typeof result.pointsAwarded !== 'number') {
        throw new Error('The hint response was invalid.');
      }
      setMessage(result.message);
      setMessageType(result.valid ? 'info' : 'error');
      if (result.valid) {
        setWords(result.words);
        setGameScore(result.gameScore);
        setHintsUsed(result.hintsUsed);
        if (result.complete) {
          setStatus('won');
          setCelebrationPoints(result.pointsAwarded);
          if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
          celebrationTimer.current = setTimeout(() => setCelebrationPoints(null), 1800);
        }
      }
    } catch (error) {
      console.error('WRDLINK hint failed:', error);
      setMessage('The hint could not be applied. Your points were not changed.');
      setMessageType('error');
    } finally {
      setBusy(false);
    }
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem('wrdlink-theme', next);
    } catch (error) {
      console.warn('WRDLINK theme preference could not be saved:', error);
    }
  };

  if (loading) {
    return (
      <main className="game-page state-page">
        <div className="state-mark">WRDLINK</div>
        <LoadingProgress />
      </main>
    );
  }

  if (!puzzle || status === 'error') {
    return (
      <main className="game-page state-page">
        <div className="state-mark">WRD<span>LINK</span></div>
        <p className="state-error" role="alert">{message}</p>
        <button className="ink-button" onClick={() => void loadPuzzle()}>Try again</button>
      </main>
    );
  }

  return (
    <main className={`game-page ${celebrationPoints !== null ? 'is-celebrating' : ''}`}>
      <header className="game-header">
        <div className="wordmark" aria-label="WRDLINK">WRDLINK</div>
        <div className="header-context">LV{level}</div>
        <div className="header-tools">
          <div className="header-count">
            <span>{gameScore} pts</span>
            <span>{movesUsed} moves</span>
          </div>
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
          <button
            className="header-hint-button"
            type="button"
            title={`Hint costs ${nextHintCost} points plus one move point`}
            aria-label={`Use hint for ${hintTotalCost} total points`}
            onClick={() => setHintConfirmation(true)}
            disabled={busy || status !== 'playing' || gameScore < hintTotalCost}
          >
            <span aria-hidden="true">✦</span>
            <span className="header-hint-cost">−{nextHintCost}</span>
          </button>
        </div>
      </header>

      <div className="game-workspace" aria-live="polite">
        {status === 'won' && celebrationPoints !== null && (
          <div className="completion-celebration" role="status" aria-label={`Level ${level} complete. ${celebrationPoints} points awarded`}>
            <span className="celebration-spark spark-one" />
            <span className="celebration-spark spark-two" />
            <div className="completion-score">
              <span>Level {level} complete</span>
              <strong>+{celebrationPoints} points</strong>
            </div>
            <span className="celebration-spark spark-three" />
            <span className="celebration-spark spark-four" />
          </div>
        )}
        <section className="route-panel" aria-label="Puzzle route">
          <div className="route-end">
            <span className="route-label">Start</span>
            <Word word={puzzle.start} />
          </div>
          <div className="route-line" aria-hidden="true"><span>→</span></div>
          <div className="route-end route-end-target">
            <span className="route-label">Target</span>
            <Word word={puzzle.target} target />
          </div>
        </section>

        <section className="chain-panel" aria-label="Your word chain">
          <div className="panel-caption"><span>Word chain</span><span>{movesUsed} moves</span></div>
          <ol className="chain-list">
            {words.map((word, index) => (
              <li className={word === puzzle.target ? 'chain-final' : ''} key={`${word}-${index}`}>
                <span>{String(index).padStart(2, '0')}</span>
                <b>{word}</b>
              </li>
            ))}
          </ol>
        </section>

        {status === 'playing' ? (
          <section className="entry-panel">
            <div className="entry-heading">
              <div><span className="panel-caption">Next move</span><strong>Change one letter</strong></div>
            </div>
            <form onSubmit={submitMove}>
              <label className="sr-only" htmlFor="word-entry">Next {puzzle.wordLength} letter word</label>
              <input
                id="word-entry"
                value={entry}
                onChange={(event) => setEntry(event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, puzzle.wordLength))}
                placeholder="NEXT WORD"
                maxLength={puzzle.wordLength}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={busy}
              />
              <button className="ink-button" type="submit" disabled={busy || entry.length !== puzzle.wordLength}>
                {busy ? 'Checking…' : 'Submit'} <span aria-hidden="true">→</span>
              </button>
            </form>
            {message && <p className={`game-message ${messageType}`} role={messageType === 'error' ? 'alert' : 'status'}>{message}</p>}

            <section className="hint-confirmation" hidden={!hintConfirmation} aria-label="Confirm hint">
              <h2>Use a hint?</h2>
              <p>The next word on a shortest route will be submitted automatically.</p>
              <div className="hint-confirm-cost">
                <span>Hint price plus move</span>
                <strong>{hintTotalCost} pts</strong>
              </div>
              <div className="hint-confirm-balance">
                <span>Remaining score</span>
                <strong>{Math.max(0, gameScore - hintTotalCost)} pts</strong>
              </div>
              <div className="hint-confirm-actions">
                <button className="secondary-button" type="button" onClick={() => setHintConfirmation(false)}>Cancel</button>
                <button className="ink-button" type="button" onClick={() => void confirmHint()} disabled={busy || gameScore < hintTotalCost}>Use hint</button>
              </div>
            </section>

            <div className="entry-actions">
              <button className="secondary-button" type="button" onClick={() => void startNewGame()} disabled={busy}>New game</button>
            </div>
          </section>
        ) : (
          <section className="finish-panel">
            <h2>Connected!</h2>
            <p>{puzzle.target} reached in {movesUsed} moves. {message}</p>
            {hintsUsed > 0 && <p>You used {hintsUsed} campaign hints. Next hint price: {5 + hintsUsed} points.</p>}
            <p className="finish-score">{gameScore} points remaining</p>
            <button className="ink-button" type="button" onClick={() => void startNextLevel()} disabled={busy}>
              Next level · {level + 1} <span aria-hidden="true">→</span>
            </button>
            <div className="entry-actions">
              <button className="secondary-button" type="button" onClick={() => void startNewGame()} disabled={busy}>Start new game</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
