import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';
import './workspace.css';
import './focused-workspace.css';
import './theme.css';
import { applyAppearance } from './appearance.js';
import { defaultAppearance } from '@gst/contracts';

applyAppearance(
  defaultAppearance,
  window.matchMedia('(prefers-color-scheme: dark)').matches,
);

const root = document.getElementById('root');
if (!root) throw new Error('Application root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
