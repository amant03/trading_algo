import { Link, useParams } from 'react-router-dom';
import { chapterKey, findModule, moduleMinutes } from '../learn/curriculum';
import { useLearn } from '../learn/progress';
import { LearnBar, Missing } from '../learn/view';

export default function LearnModulePage() {
  const { moduleSlug } = useParams();
  const mod = findModule(moduleSlug);
  const read = useLearn((s) => s.read);
  if (!mod) return <Missing what="module" />;

  const readCount = mod.chapters.filter((ch) => read[chapterKey(mod.slug, ch.slug)]).length;
  const next = mod.chapters.find((ch) => !read[chapterKey(mod.slug, ch.slug)]) ?? mod.chapters[0];

  return (
    <div className="learn">
      <p className="learn-kicker">
        <Link to="/learn">Learn</Link>
        <span> / Module</span>
      </p>
      <header className="learn-module-head">
        <div>
          <h1>{mod.title}</h1>
          <p className="learn-lead">{mod.blurb}</p>
        </div>
        <div className="learn-status compact">
          <span className={`learn-level ${mod.level.toLowerCase()}`}>{mod.level}</span>
          <div className="learn-meta">
            {mod.chapters.length} chapters · {moduleMinutes(mod)} min
          </div>
          <LearnBar done={readCount} total={mod.chapters.length} />
          <Link to={`/learn/${mod.slug}/${next.slug}`} className="btn amber-fill learn-continue">
            {readCount === 0 ? 'Start module' : readCount === mod.chapters.length ? 'Review from the start' : 'Continue'}
          </Link>
        </div>
      </header>

      <ol className="learn-chapters">
        {mod.chapters.map((ch, i) => {
          const id = chapterKey(mod.slug, ch.slug);
          const on = !!read[id];
          return (
            <li key={ch.slug}>
              <Link to={`/learn/${mod.slug}/${ch.slug}`} className={on ? 'done' : ''}>
                <span className="learn-tick" aria-hidden="true">
                  {on ? '✓' : String(i + 1).padStart(2, '0')}
                </span>
                <span className="learn-ch-title">{ch.title}</span>
                <span className="learn-meta">{ch.minutes} min · {ch.quiz.length} checks</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
