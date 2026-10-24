import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './fonts-face.css';
import './index.css';
import { connectLive } from './ws';
import { useAuth } from './auth';

connectLive();
// Revalidate any cached session (drops dead tokens, keeps the rest).
void useAuth.getState().refresh();

// Old links used hash routes (/#/stock/RELIANCE). Browsers never send the
// hash to the server, so those URLs could not be indexed as separate pages.
// Promote them to real paths before the router reads the address bar.
function promoteHashUrl(): void {
  const hash = window.location.hash;
  if (!hash.startsWith('#/')) return;
  const raw = hash.slice(1);
  const q = raw.indexOf('?');
  const path = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? window.location.search : raw.slice(q);
  const next = (path.startsWith('/') ? path : `/${path}`) + query;
  window.history.replaceState(null, '', next);
}
promoteHashUrl();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
