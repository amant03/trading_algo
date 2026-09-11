import { NavLink, Route, Routes } from 'react-router-dom';
import Topbar from './components/Topbar';
import Ticker from './components/Ticker';
import Sidebar from './components/Sidebar';
import StatusBanner from './components/StatusBanner';
import Footer from './components/Footer';
import RequireAuth from './components/RequireAuth';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Trading from './pages/Trading';
import Algorithms from './pages/Algorithms';
import Watchlist from './pages/Watchlist';
import Paper from './pages/Paper';
import Login from './pages/Login';
import Signup from './pages/Signup';
import About from './pages/About';
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
            <Route path="/trading" element={<RequireAuth><Trading /></RequireAuth>} />
            <Route path="/algorithms" element={<RequireAuth><Algorithms /></RequireAuth>} />
            <Route path="/watchlist" element={<RequireAuth><Watchlist /></RequireAuth>} />
            <Route path="/paper" element={<Paper />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </div>
      </div>
      <Footer />
      <Toasts />
    </div>
  );
}
