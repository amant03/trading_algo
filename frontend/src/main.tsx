import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { connectLive } from './ws';
import { useAuth } from './auth';

connectLive();
// Revalidate any cached session (drops dead tokens, keeps the rest).
void useAuth.getState().refresh();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
