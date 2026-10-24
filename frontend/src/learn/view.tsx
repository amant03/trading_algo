import { Link } from 'react-router-dom';
import type { Block } from '../learn/types';

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="learn-prose">
      {blocks.map((block, i) => {
        if (block.kind === 'p') return <p key={i}>{block.text}</p>;
        if (block.kind === 'h') return <h2 key={i}>{block.text}</h2>;
        if (block.kind === 'ul') {
          return (
            <ul key={i}>
              {block.items.map((item, n) => (
                <li key={n}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'note') {
          return (
            <aside key={i} className="learn-note">
              {block.text}
            </aside>
          );
        }
        return (
          <figure key={i} className="learn-example">
            <figcaption>{block.title}</figcaption>
            {block.lines.map((line, n) => (
              <div key={n}>{line}</div>
            ))}
          </figure>
        );
      })}
    </div>
  );
}

export function LearnBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="learn-bar" role="img" aria-label={`${done} of ${total} chapters read`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Missing({ what }: { what: string }) {
  return (
    <div className="learn">
      <p className="learn-kicker">Learn</p>
      <h1>That {what} is not in the curriculum.</h1>
      <p className="learn-lead">The catalogue is the full list. Nothing else is published under this path.</p>
      <Link to="/learn" className="btn amber-fill">
        Back to modules
      </Link>
    </div>
  );
}
