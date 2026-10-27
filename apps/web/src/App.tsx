import { useEffect, useState } from 'react';
import { fetchHealth, fetchReadiness } from './api.js';

export function App() {
  const [api, setApi] = useState('Checking…');
  const [database, setDatabase] = useState('Checking…');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    setApi('Checking…');
    setDatabase('Checking…');
    void Promise.allSettled([
      fetchHealth(controller.signal).then(
        () => {
          if (!controller.signal.aborted) setApi('Connected');
        },
        () => {
          if (!controller.signal.aborted) setApi('Unavailable');
        },
      ),
      fetchReadiness(controller.signal).then(
        () => {
          if (!controller.signal.aborted) setDatabase('Ready');
        },
        () => {
          if (!controller.signal.aborted)
            setDatabase('Unavailable or migration pending');
        },
      ),
    ]).finally(() => clearTimeout(timer));
    // Timeout must leave the initial checking state, while unmount remains silent.
    const timeoutState = setTimeout(() => {
      setApi((v) => (v === 'Checking…' ? 'Timed out' : v));
      setDatabase((v) => (v === 'Checking…' ? 'Timed out' : v));
    }, 8100);
    return () => {
      clearTimeout(timer);
      clearTimeout(timeoutState);
      controller.abort();
    };
  }, [attempt]);
  return (
    <main>
      <p className="eyebrow">GST BILLING PLATFORM</p>
      <h1>A reliable foundation.</h1>
      <p className="intro">
        The shared platform for local Windows installations and online
        businesses.
      </p>
      <section aria-labelledby="connection-title">
        <h2 id="connection-title">Development connectivity</h2>
        <dl aria-live="polite">
          <div>
            <dt>API · v1</dt>
            <dd>{api}</dd>
          </div>
          <div>
            <dt>PostgreSQL</dt>
            <dd>{database}</dd>
          </div>
        </dl>
        <button onClick={() => setAttempt((value) => value + 1)}>
          Check again
        </button>
      </section>
      <p className="notice">
        Phase 1 foundation. Billing and GST calculation are not available.
      </p>
    </main>
  );
}
