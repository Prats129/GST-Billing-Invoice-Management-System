import { useEffect, useState } from 'react';
import { fetchHealth, fetchReadiness } from './api.js';
import { Workspace } from './Workspace.js';

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
    <Workspace
      connection={{ api, database }}
      onCheck={() => setAttempt((value) => value + 1)}
    />
  );
}
