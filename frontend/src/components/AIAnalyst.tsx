import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api';
import { useLive } from '../ws';
import { fmt } from '../format';
import { computeTech, patternList, answer, stanceColor } from '../ai';
import type { AiAnswer } from '../ai';
import type { HistoryRow } from '../types';

interface Msg {
  role: 'user' | 'ai';
  text: string;
  bullets?: string[];
  tone?: string;
}

const CHIPS = ['Should I buy or sell?', 'Breakout levels / support-resistance', 'Fair value & valuation', 'Hidden patterns', 'What news is out?', 'Compare with a competitor'];

export default function AIAnalyst({ upper, prompt, onPromptConsumed }: { upper: string; prompt?: string | null; onPromptConsumed?: () => void }) {
  const fundamentals = useLive((s) => s.fundamentals);
  const snapshots = useLive((s) => s.snapshots);
  const newsBySymbol = useLive((s) => s.newsBySymbol);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const lastPrompt = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    get<{ rows: HistoryRow[] }>(`/api/chart?symbol=${encodeURIComponent(upper)}&range=1mo`)
      .then((r) => {
        if (live && Array.isArray(r.rows)) setRows(r.rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [upper]);

  const ctx = useMemo(() => {
    const analysis = fundamentals[upper] ?? null;
    return {
      symbol: upper,
      name: analysis?.name ?? upper,
      snap: snapshots[upper] ?? null,
      analysis,
      news: (newsBySymbol[upper.toUpperCase()] ?? []).slice(0, 8),
      rows,
      peers: analysis?.peers ?? [],
      tech: computeTech(rows),
      stocks: fundamentals,
      snapshots,
    };
  }, [upper, fundamentals, snapshots, newsBySymbol, rows]);

  const patterns = useMemo(() => patternList(ctx), [ctx]);

  const post = (q: string) => {
    const qq = q.trim();
    if (!qq || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: qq }]);
    // tiny delay so the UI paints the question first
    setTimeout(() => {
      let a: AiAnswer;
      try {
        a = answer(qq, ctx);
      } catch (e) {
        a = { text: `Couldn't answer that yet — ${e instanceof Error ? e.message : 'unknown error'}. Try one of the quick questions.`, tone: 'HOLD' };
      }
      setMsgs((m) => [...m, { role: 'ai', text: a.text, bullets: a.bullets, tone: a.tone }]);
      setBusy(false);
    }, 320);
  };

  useEffect(() => {
    if (prompt && prompt !== lastPrompt.current) {
      lastPrompt.current = prompt;
      post(prompt);
      onPromptConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  const tech = ctx.tech;
  const analysis = ctx.analysis;
  const opinion = analysis?.opinion;

  return (
    <div>
      <div className="ai-panel-grid">
        <div className="panel ai-view" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-title">
            <h3>Our view</h3>
            <span className="hint">separate short-term (technical) vs long-term (fundamental) opinions</span>
          </div>
          <div className="ai-views">
            <div className="ai-view-card">
              <div className="ai-view-head">
                <span className="ai-view-ttl">Technical — short term</span>
                <span className="ai-stance" style={{ color: stanceColor(tech?.verdict.stance ?? 'UNKNOWN'), borderColor: stanceColor(tech?.verdict.stance ?? 'UNKNOWN') }}>
                  {tech ? `${tech.verdict.stance} · ${tech.verdict.conviction}%` : 'pending'}
                </span>
              </div>
              {tech ? (
                <div>
                  <div className="ai-trend">
                    Trend: <b>{tech.verdict.trend}</b> · last {fmt(tech.price)} ({tech.changePct >= 0 ? '+' : ''}{tech.changePct.toFixed(2)}%)
                  </div>
                  <ul className="ai-sigs">
                    {tech.verdict.why.slice(0, 4).map((w, i) => (
                      <li key={i} className={i === 0 ? 'first' : ''}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="dim" style={{ fontSize: 12 }}>Load candles to unlock the short-term read (chart L2 via relay or Technical tab).</div>
              )}
            </div>

            <div className="ai-view-card">
              <div className="ai-view-head">
                <span className="ai-view-ttl">Fundamental — long term (3–5y)</span>
                <span className="ai-stance" style={{ color: stanceColor(opinion?.stance ?? 'UNKNOWN'), borderColor: stanceColor(opinion?.stance ?? 'UNKNOWN') }}>
                  {opinion ? `${opinion.stance} · ${opinion.conviction}%` : analysis ? `${analysis.verdict.rating} · ${analysis.verdict.score}/100` : 'pending'}
                </span>
              </div>
              {opinion ? (
                <div>
                  <div className="ai-thesis">{opinion.thesis}</div>
                  <div className="ai-risks">
                    <span className="ai-risks-ttl">Risks</span>
                    <ul>{opinion.risks.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                </div>
              ) : (
                <div className="dim" style={{ fontSize: 12 }}>The long-term opinion is generated by the automation pipeline — appears after the next run.</div>
              )}
            </div>
          </div>
        </div>

        <div className="panel ai-patterns">
          <div className="panel-title">
            <h3>Hidden patterns &amp; data points</h3>
            <span className="hint">deterministic scan of price, valuation, governance &amp; news</span>
          </div>
          {patterns.length ? (
            <ul className="ai-pattern-list">
              {patterns.map((p, i) => (
                <li key={i}>
                  <span className={`ai-pdot ${p.bias}`} />
                  <span className="ai-plabel">{p.label}</span>
                  <span className="ai-pdetail">{p.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">Pattern scan pending — load chart data for {upper} first.</div>
          )}
        </div>

        <div className="panel ai-chat">
          <div className="panel-title">
            <h3>Ask the analyst</h3>
            <span className="hint">answers computed locally from live &amp; CI data — free, no API keys</span>
          </div>
          <div className="ai-chips">
            {CHIPS.map((c) => (
              <button key={c} className="chip" onClick={() => post(c)} disabled={busy}>{c}</button>
            ))}
          </div>
          <div className="ai-msgs">
            {msgs.length === 0 && <div className="dim" style={{ fontSize: 12, padding: 8 }}>Ask anything: "buy or sell?", "fair value?", "hidden patterns?", "compare vs TCS", "news", "management risk"…</div>}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}`}>
                <div className="ai-msg-role">{m.role === 'user' ? 'You' : 'Analyst'}</div>
                <div className="ai-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                {m.bullets && (
                  <ul className="ai-msg-bullets">
                    {m.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="ai-msg ai typing">Analyst is thinking…</div>}
            <div ref={endRef} />
          </div>
          <div className="ai-input-row">
            <input
              className="input"
              placeholder={`Ask about ${upper}…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  post(input);
                  setInput('');
                }
              }}
            />
            <button className="btn primary" onClick={() => { post(input); setInput(''); }} disabled={busy || !input.trim()}>
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}