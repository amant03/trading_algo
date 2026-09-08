import { useLive } from '../ws';
import { timeAgo } from '../format';

/** Contextual strip under the topbar explaining the current data source. */
export default function StatusBanner() {
  const mode = useLive((s) => s.mode);
  const overview = useLive((s) => s.overview);
  if (mode === 'live') return null;

  const updated = overview?.updatedAt ?? null;

  return (
    <div className={`status-banner status-${mode}`}>
      <span className="sb-icon">ⓘ</span>
      {mode === 'polling' && (
        <span>
          Backend reachable over REST — polling every 4s. WebSocket stream unavailable
          (deployed frontends proxy REST only).
          {updated ? <em> Updated {timeAgo(updated)}</em> : null}
        </span>
      )}
      {mode === 'snapshot' && (
        <span>
          No live backend right now — showing the last automation snapshot.
          The GitHub Actions pipeline refreshes this data on every run.
          {updated ? <em> Snapshot from {timeAgo(updated)}</em> : null}
        </span>
      )}
      {mode === 'offline' && (
        <span>
          Backend unreachable and no snapshot available yet. Start the stack locally with
          <code>npm run start:all</code> — or wait for the next automation run to publish one.
        </span>
      )}
    </div>
  );
}
