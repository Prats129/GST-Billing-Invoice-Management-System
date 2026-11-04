import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';
import './workspace.css';
import './focused-workspace.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
