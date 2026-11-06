import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse, MoveValidationResponse, Puzzle } from '../shared/api';

type GameStatus = 'playing' | 'won' | 'lost' | 'error';
let fallbackSessionId = '';

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
    if (!fallbackSessionId) fallbackSessionId = createId();
    return fallbackSessionId;
  }
}

function isInitResponse(value: unknown): value is InitResponse {
  if (!isRecord(value) || !('puzzle' in value)) return false;
  const puzzle = value.puzzle;
  return isRecord(puzzle) && 'id' in puzzle &&
    'start' in puzzle && 'target' in puzzle && 'wordLength' in puzzle &&
    'optimalMoves' in puzzle &&
    typeof puzzle.id === 'string' && typeof puzzle.start === 'string' &&
    typeof puzzle.target === 'string' && typeof puzzle.wordLength === 'number' &&
    typeof puzzle.optimalMoves === 'number' &&
    typeof value.sessionId === 'string' &&
    typeof value.gameScore === 'number' &&
    typeof value.level === 'number';
}

function isValidationResponse(value: unknown): value is MoveValidationResponse {
  return isRecord(value) && 'valid' in value &&
    'complete' in value && 'message' in value && 'movesUsed' in value &&
    typeof value.valid === 'boolean' &&
    typeof value.complete === 'boolean' && typeof value.message === 'string' &&
    typeof value.movesUsed === 'number' && typeof value.pointsAwarded === 'number' &&
    typeof value.gameScore === 'number' &&
    typeof value.reset === 'boolean' && typeof value.failed === 'boolean';
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
  const [gameScore, setGameScore] = useState(0);
  const [celebrationPoints, setCelebrationPoints] = useState<number | null>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useMemo(() => getSessionId(), []);

  function commitPuzzle(data: InitResponse) {
    const update = () => {
      setPuzzle(data.puzzle);
      setWords([data.puzzle.start]);
      setEntry('');
      setLevel(data.level);
      setGameScore(data.gameScore);
      setCelebrationPoints(null);
    };
    const startViewTransition = Reflect.get(document, 'startViewTransition');
    if (typeof startViewTransition === 'function') {
      startViewTransition.call(document, update);
    } else {
      update();
    }
  }

  const loadPuzzle = useCallback(async (signal?: AbortSignal, newGame = false) => {
    await Promise.resolve();
    if (signal?.aborted) return;
    setLoading(true);
    setStatus('playing');
    setMessage('');
    try {
      const newGameQuery = newGame ? '&newGame=true' : '';
      const response = await fetch(`/api/init?sessionId=${encodeURIComponent(sessionId)}${newGameQuery}`, signal ? { signal } : undefined);
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

  const movesUsed = words.length - 1;
  async function startNewPuzzle() {
    if (busy) return;
    setBusy(true);
    try {
      await loadPuzzle(undefined, true);
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
        body: JSON.stringify({ sessionId, puzzleId: puzzle.id, words: [...words, candidate] }),
      });
      if (!response.ok) throw new Error(`Validation failed with status ${response.status}`);
      const result: unknown = await response.json();
      if (!isValidationResponse(result)) throw new Error('The validation response was invalid.');
      if (!result.valid) {
        if (result.failed) {
          setWords([puzzle.start]);
          setEntry('');
          setStatus('lost');
        }
        setMessage(result.message);
        setMessageType('error');
        return;
      }
      setWords((previous) => [...previous, candidate]);
      setEntry('');
      setMessage(result.message);
      setMessageType('info');
      setGameScore(result.gameScore);
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
        <div className="header-context">Lv {level}</div>
        <div className="header-tools">
          <div className="header-count"><span>{gameScore} pts</span><span>{movesUsed} moves</span></div>
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
            <div className="entry-actions">
              <button className="secondary-button" onClick={() => void startNewPuzzle()} disabled={busy}>Start new puzzle</button>
            </div>
          </section>
        ) : status === 'won' ? (
          <section className="finish-panel">
            <h2>Complete</h2>
            <p>{puzzle.target} reached in {movesUsed} moves. {message}</p>
            <button className="ink-button" onClick={() => void loadPuzzle()}>Next level · {level + 1}</button>
          </section>
        ) : (
          <section className="finish-panel">
            <h2>Try again</h2>
            <p>The target was {puzzle.target}.</p>
            <button className="secondary-button" onClick={() => void loadPuzzle()}>Start new puzzle</button>
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
