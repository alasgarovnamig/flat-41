import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MOCK } from './env';
import { App } from './App';
import './index.css';

async function start() {
  // Dev-only fixture mode: statically false in production builds, so the mock module is tree-shaken away.
  if (import.meta.env.DEV && MOCK) {
    const { installMockApi } = await import('./mock/server');
    installMockApi();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
