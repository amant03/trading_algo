import { NavLink, Route, Routes } from 'react-router-dom';
import Topbar from './components/Topbar';
import Ticker from './components/Ticker';
import Sidebar from './components/Sidebar';
import StatusBanner from './components/StatusBanner';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Trading from './pages/Trading';
import Algorithms from './pages/Algorithms';
import Watchlist from './pages/Watchlist';
import Paper from './pages/Paper';
import { Toasts } from './components/Toasts';

export default function App() {
  return (
    <div className="app">
      <div className="grain" />
      <Topbar />
      <StatusBanner />
      <Ticker />
      <div className="main">
        <Sidebar />
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stock/:symbol" element={<Stock />} />
            <Route path="/trading" element={<Trading />} />
            <Route path="/algorithms" element={<Algorithms />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/paper" element={<Paper />} />
          </Routes>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
