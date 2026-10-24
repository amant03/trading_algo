import { Route, Routes, useLocation } from 'react-router-dom';
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
import Test from './pages/Test';
import Login from './pages/Login';
import Signup from './pages/Signup';
import About from './pages/About';
import VibeTrading from './pages/VibeTrading';
import US from './pages/US';
import NotFound from './pages/NotFound';
import LearnHome from './pages/LearnHome';
import LearnModulePage from './pages/LearnModule';
import LearnChapterPage from './pages/LearnChapter';
import Seo from './components/Seo';
import { Toasts } from './components/Toasts';
import './learn.css';

export default function App() {
  const learning = useLocation().pathname.startsWith('/learn');
  return (
    <div className="app">
      <div className="grain" />
      <a className="skip-link" href="#main">Skip to content</a>
      <Seo />
      <Topbar />
      <StatusBanner />
      <Ticker />
      <div className={learning ? 'main learn-main' : 'main'}>
        {!learning && <Sidebar />}
        <main className="content" id="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/learn" element={<LearnHome />} />
            <Route path="/learn/:moduleSlug" element={<LearnModulePage />} />
            <Route path="/learn/:moduleSlug/:chapterSlug" element={<LearnChapterPage />} />
            <Route path="/stock/:symbol" element={<Stock />} />
            <Route path="/trading" element={<RequireAuth><Trading /></RequireAuth>} />
            <Route path="/algorithms" element={<RequireAuth><Algorithms /></RequireAuth>} />
            <Route path="/watchlist" element={<RequireAuth><Watchlist /></RequireAuth>} />
            <Route path="/test" element={<Test />} />
            <Route path="/paper" element={<Paper />} />
            <Route path="/vibe" element={<VibeTrading />} />
            <Route path="/us" element={<US />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <Footer />
      <Toasts />
    </div>
  );
}
