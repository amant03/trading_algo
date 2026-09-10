import { useLive } from '../ws';
import { timeAgo } from '../format';

/** Contextual strip under the topbar explaining the current data source. */
export default function StatusBanner() {
  const mode = useLive((s) => s.mode);
  const overview = useLive((s) => s.overview);
  if (mode === 'live' || mode === 'relay') return null;

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
          No live feed right now — showing the last automation snapshot.
          The GitHub Actions pipeline refreshes this data on every run,
          and live prices kick in during market hours.
          {updated ? <em> Snapshot from {timeAgo(updated)}</em> : null}
        </span>
      )}
      {mode === 'offline' && (
        <span>
          Connecting to NSE quotes and the latest snapshot&hellip; if this stays here, the live relay is still warming up.
        </span>
      )}
    </div>
  );
}
