import './splash.css';

import { StrictMode, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { MouseEvent } from 'react';
import { requestExpandedMode } from '@devvit/web/client';

export function Splash() {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');

  async function play(event: MouseEvent<HTMLButtonElement>) {
    if (launching) return;

    setLaunching(true);
    setError('');

    try {
      await requestExpandedMode(event.nativeEvent, 'game');
    } catch (reason) {
      console.error('Could not open WRDLINK:', reason);
      setError('The game could not open here. Try again from the post.');
      setLaunching(false);
    }
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
        <button className="start-button" onClick={play} disabled={launching}>
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
