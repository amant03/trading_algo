import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MODULES, chapterKey, flatChapters, moduleMinutes, findChapter } from '../learn/curriculum';
import { useLearn } from '../learn/progress';
import type { Level } from '../learn/types';
import { LearnBar } from '../learn/view';

const FILTERS: Array<Level | 'All'> = ['All', 'Beginner', 'Intermediate', 'Advanced'];

export default function LearnHome() {
  const read = useLearn((s) => s.read);
  const last = useLearn((s) => s.last);
  const reset = useLearn((s) => s.reset);
  const [filter, setFilter] = useState<Level | 'All'>('All');
  const [confirmReset, setConfirmReset] = useState(false);

  const flat = useMemo(() => flatChapters(), []);
  const done = flat.filter((h) => read[chapterKey(h.module.slug, h.chapter.slug)]).length;
  const continueHit = findChapter(last?.split('/')[0], last?.split('/')[1]) ?? flat.find((h) => !read[chapterKey(h.module.slug, h.chapter.slug)]) ?? flat[0];

  const visible = MODULES.filter((m) => filter === 'All' || m.level === filter);

  return (
    <div className="learn">
      <header className="learn-hero">
        <div>
          <p className="learn-kicker">Learn · {flat.length} chapters</p>
          <h1>
            Read the market <em>before you size it.</em>
          </h1>
          <p className="learn-lead">
            Eight modules on the Indian cash and derivatives markets, written for this paper terminal.
            Start with how a price is printed. Finish with a checklist you can fail on purpose.
            Progress stays in this browser.
          </p>
        </div>
        <aside className="learn-status">
          <div className="learn-status-num">
            <span className="mono">{done}</span>
            <span className="dim">/ {flat.length}</span>
          </div>
          <div className="learn-meta">chapters marked read</div>
          <LearnBar done={done} total={flat.length} />
          {continueHit && (
            <Link
              to={`/learn/${continueHit.module.slug}/${continueHit.chapter.slug}`}
              className="btn amber-fill learn-continue"
            >
              {done === 0 ? 'Start with chapter 1' : `Continue · ${continueHit.chapter.title}`}
            </Link>
          )}
        </aside>
      </header>

      <div className="learn-tools">
        <div className="learn-filters" role="tablist" aria-label="Filter by level">
          {FILTERS.map((level) => (
            <button
              key={level}
              type="button"
              role="tab"
              aria-selected={filter === level}
              className={filter === level ? 'on' : ''}
              onClick={() => setFilter(level)}
            >
              {level}
            </button>
          ))}
        </div>
        {done > 0 && !confirmReset && (
          <button type="button" className="learn-reset" onClick={() => setConfirmReset(true)}>
            Reset progress
          </button>
        )}
        {confirmReset && (
          <span className="learn-reset-confirm">
            Clear every check on this browser?
            <button
              type="button"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Clear
            </button>
            <button type="button" onClick={() => setConfirmReset(false)}>
              Keep
            </button>
          </span>
        )}
      </div>

      <ol className="learn-index">
        {visible.map((mod) => {
          const n = MODULES.indexOf(mod) + 1;
          const readCount = mod.chapters.filter((ch) => read[chapterKey(mod.slug, ch.slug)]).length;
          return (
            <li key={mod.slug}>
              <Link to={`/learn/${mod.slug}`} className="learn-row">
                <span className="learn-num">{String(n).padStart(2, '0')}</span>
                <span>
                  <span className="learn-row-title">{mod.title}</span>
                  <span className="learn-blurb">{mod.blurb}</span>
                  <LearnBar done={readCount} total={mod.chapters.length} />
                </span>
                <span className="learn-row-meta">
                  <span className={`learn-level ${mod.level.toLowerCase()}`}>{mod.level}</span>
                  <span className="learn-meta">
                    {mod.chapters.length} chapters · {moduleMinutes(mod)} min
                  </span>
                  <span className="learn-meta">
                    {readCount}/{mod.chapters.length} read
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="learn-foot">
        Original lessons for this terminal. Not affiliated with any broker academy, and not investment advice.
        Prices can be live. Orders on this site stay simulated.
      </p>
    </div>
  );
}
