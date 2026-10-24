import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MODULES, chapterKey, findChapter } from '../learn/curriculum';
import { questionId, useLearn } from '../learn/progress';
import { Blocks, Missing } from '../learn/view';
import { cls } from '../format';

export default function LearnChapterPage() {
  const { moduleSlug, chapterSlug } = useParams();
  const hit = findChapter(moduleSlug, chapterSlug);
  const read = useLearn((s) => s.read);
  const picks = useLearn((s) => s.picks);
  const markRead = useLearn((s) => s.markRead);
  const pick = useLearn((s) => s.pick);
  const touch = useLearn((s) => s.touch);

  const id = hit ? chapterKey(hit.module.slug, hit.chapter.slug) : '';

  useEffect(() => {
    if (id) touch(id);
  }, [id, touch]);

  if (!hit) return <Missing what="chapter" />;

  const { module: mod, chapter, index, moduleIndex } = hit;
  const prev = index > 0 ? mod.chapters[index - 1] : undefined;
  const next = index < mod.chapters.length - 1 ? mod.chapters[index + 1] : undefined;
  const nextMod = MODULES[moduleIndex + 1];
  const on = !!read[id];
  const correct = chapter.quiz.filter((q, i) => picks[questionId(id, i)] === q.answer).length;

  return (
    <div className="learn learn-read">
      <nav className="learn-rail" aria-label="Chapters in this module">
        <Link to={`/learn/${mod.slug}`} className="learn-rail-mod">
          {mod.title}
        </Link>
        {mod.chapters.map((ch, i) => {
          const key = chapterKey(mod.slug, ch.slug);
          const current = ch.slug === chapter.slug;
          return (
            <Link key={ch.slug} to={`/learn/${mod.slug}/${ch.slug}`} className={cls(current && 'on')} aria-current={current ? 'page' : undefined}>
              <span className={cls('learn-tick', read[key] && 'done')}>{read[key] ? '✓' : i + 1}</span>
              <span>{ch.title}</span>
            </Link>
          );
        })}
      </nav>

      <article className="learn-article">
        <p className="learn-kicker">
          <Link to="/learn">Learn</Link>
          <span> / </span>
          <Link to={`/learn/${mod.slug}`}>{mod.title}</Link>
          <span>
            {' '}
            / {index + 1} of {mod.chapters.length} · {chapter.minutes} min
          </span>
        </p>
        <h1>{chapter.title}</h1>
        <Blocks blocks={chapter.blocks} />

        {chapter.related && chapter.related.length > 0 && (
          <div className="learn-related">
            {chapter.related.map((rel) => (
              <Link key={rel.to} to={rel.to} className="btn">
                {rel.label}
              </Link>
            ))}
          </div>
        )}

        <section className="learn-quiz" aria-label="Check yourself">
          <div className="learn-quiz-head">
            <h2>Check yourself</h2>
            <span className="learn-meta">
              {correct}/{chapter.quiz.length} right
            </span>
          </div>
          {chapter.quiz.map((q, qi) => {
            const qid = questionId(id, qi);
            const chosen = picks[qid];
            const revealed = chosen !== undefined;
            return (
              <fieldset key={qid} className="learn-q">
                <legend>
                  {qi + 1}. {q.prompt}
                </legend>
                {q.choices.map((choice, ci) => {
                  const isPick = chosen === ci;
                  const isAnswer = q.answer === ci;
                  return (
                    <button
                      key={choice}
                      type="button"
                      className={cls(
                        'learn-choice',
                        revealed && isAnswer && 'right',
                        revealed && isPick && !isAnswer && 'wrong',
                      )}
                      aria-pressed={isPick}
                      onClick={() => pick(qid, ci)}
                    >
                      <span className="learn-choice-key">{String.fromCharCode(65 + ci)}</span>
                      {choice}
                    </button>
                  );
                })}
                {revealed && <p className={cls('learn-why', chosen === q.answer ? 'right' : 'wrong')}>{q.why}</p>}
              </fieldset>
            );
          })}
        </section>

        <div className="learn-actions">
          <button type="button" className={cls('btn', on && 'amber-fill')} onClick={() => markRead(id, !on)}>
            {on ? 'Marked read' : 'Mark as read'}
          </button>
          <span className="learn-meta">Marking read is how the module list keeps score. The checks are practice.</span>
        </div>

        <nav className="learn-pager">
          {prev ? (
            <Link to={`/learn/${mod.slug}/${prev.slug}`} className="learn-page-link">
              <span className="learn-meta">Previous</span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={`/learn/${mod.slug}/${next.slug}`} className="learn-page-link next">
              <span className="learn-meta">Next</span>
              {next.title}
            </Link>
          ) : nextMod ? (
            <Link to={`/learn/${nextMod.slug}`} className="learn-page-link next">
              <span className="learn-meta">Next module</span>
              {nextMod.title}
            </Link>
          ) : (
            <Link to="/learn" className="learn-page-link next">
              <span className="learn-meta">Done</span>
              Back to modules
            </Link>
          )}
        </nav>
      </article>
    </div>
  );
}
