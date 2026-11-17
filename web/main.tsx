import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Report, Scenario, ScenarioResult, LaneResult, TimelineEvent } from '../src/types';
import './styles.css';

type History = Pick<Report, 'id' | 'createdAt' | 'summary' | 'durationMs'>;
type Job = { id: string; status: string; completed: number; total: number; current: string; error?: string; report?: Report };
const time = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const recordedDemo = import.meta.env.VITE_RECORDED_DEMO === 'true';
let recordedPromise: Promise<Report> | undefined;
const recorded = () => recordedPromise ??= fetch('./evidence.json').then(r => { if (!r.ok) throw new Error('Recorded evidence is unavailable'); return r.json() as Promise<Report>; });
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (recordedDemo) {
    if (init?.method && init.method !== 'GET') throw new Error('This is a recorded demo. Run locally for fresh executions.');
    const r = await recorded();
    if (path === '/api/scenarios') return r.scenarios.map(s => s.scenario) as T;
    if (path === '/api/runs') return [r] as T;
    return { status: 'complete', report: r } as T;
  }
 const r = await fetch(path, init); const value = await r.json(); if (!r.ok) throw new Error(value.error ?? 'Request failed'); return value; }
function Glyph({ name }: { name: 'grid' | 'clock' | 'layers' | 'arrow' | 'download' | 'check' }) {
  const paths = { grid: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z', clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', layers: 'm3 7 9-4 9 4-9 4-9-4m0 5 9 4 9-4m-18 5 9 4 9-4', arrow: 'M5 12h14m-6-6 6 6-6 6', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', check: 'm5 12 4 4L19 6' };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
function App() {
  const [catalog, setCatalog] = useState<Scenario[]>([]), [selected, setSelected] = useState<string[]>([]), [report, setReport] = useState<Report>(), [history, setHistory] = useState<History[]>([]);
  const [page, setPage] = useState('lab'), [activeId, setActiveId] = useState('lost-response'), [tab, setTab] = useState('timeline'), [job, setJob] = useState<Job>(), [error, setError] = useState(''), [inspected, setInspected] = useState<TimelineEvent>(), [filter, setFilter] = useState('All');
  const busy = job?.status === 'running';
  const refreshHistory = () => api<History[]>('/api/runs').then(setHistory);
  useEffect(() => { void Promise.all([api<Scenario[]>('/api/scenarios'), api<History[]>('/api/runs')]).then(([s, h]) => { setCatalog(s); setSelected(s.map(x => x.id)); setHistory(h); if (recordedDemo) void recorded().then(setReport); }).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let alive = true;
    const interval = setInterval(() => { void api<Job>(`/api/runs/${job.id}`).then(value => {
      if (!alive) return; setJob(value);
      if (value.status === 'complete' && value.report) { setReport(value.report); setActiveId(value.report.scenarios[0].scenario.id); setInspected(undefined); void refreshHistory(); }
      if (value.status === 'error') setError(value.error ?? 'Rehearsal failed');
    }).catch(e => { if (alive) { setError(e.message); setJob(undefined); } }); }, 300);
    return () => { alive = false; clearInterval(interval); };
  }, [job?.id, job?.status]);
  const run = async () => { if (recordedDemo) { try { setReport(await recorded()); setPage('lab'); } catch (e) { setError((e as Error).message); } return; } setError(''); setPage('lab'); setInspected(undefined); try { setJob(await api<Job>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarios: selected }) })); } catch (e) { setError((e as Error).message); } };
  const openRun = async (id: string) => { try { const result = await api<Job>(`/api/runs/${id}`); if (result.report) { setReport(result.report); setActiveId(result.report.scenarios[0].scenario.id); setPage('lab'); setInspected(undefined); } } catch (e) { setError((e as Error).message); } };
  const active = report?.scenarios.find(s => s.scenario.id === activeId);
  const choose = (id: string) => { setActiveId(id); setInspected(undefined); };
  const visible = catalog.filter(s => filter === 'All' || s.category === filter);
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="ActionLedger home"><span className="brand-mark">A<span>↗</span></span><span>Action<span className="brand-light">Ledger</span></span></a>
      <div className="workspace"><span className="workspace-icon">L</span><div>Reliability lab<small>Local workspace</small></div><span className="workspace-dot"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{([['lab', 'Rehearsals', 'grid'], ['history', 'Run history', 'clock'], ['method', 'How it works', 'layers']] as const).map(([id, name, icon]) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id)}><Glyph name={icon}/>{name}{id === 'history' && <span className="nav-count">{history.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="stack-label">POWERED BY</div><div className="stack-name">Composio <span>×</span> SQLite <span>×</span> OTel</div><div className="environment"><span className="pulse-dot"/> Synthetic environment</div><p>No credentials. No live writes.<br/>A reproducible engineering pilot.</p><a href="https://github.com/liorma6/actionledger" target="_blank" rel="noreferrer">Explore the source <span>↗</span></a></div>
    </aside>
    <main>
      <header className="topbar"><div><span className="breadcrumb">Agent operations</span><span className="slash">/</span>{page === 'lab' ? 'Rehearsals' : page === 'history' ? 'Run history' : 'Method'}</div><div className="top-right"><span className="version">{recordedDemo ? 'RECORDED DEMO' : 'PILOT 0.1'}</span><span className="avatar">LM</span></div></header>
      <div className="content">
        <div className="heading-row"><div><div className="eyebrow">{page === 'history' ? 'PERSISTENT EVIDENCE' : page === 'method' ? 'THE CONTRACT' : 'ACTION RELIABILITY LAB'}</div><h1>{page === 'lab' ? 'A response is not the whole story.' : page === 'history' ? 'Every run leaves a receipt.' : 'Know what actually happened.'}</h1><p className="subtitle">{page === 'lab' ? 'Rehearse uncertain outcomes. Inspect real side effects. Recover with evidence.' : page === 'history' ? 'Completed rehearsals are stored in SQLite and survive a restart.' : 'A durable decision record between an agent’s intent and a provider’s side effect.'}</p></div>{page === 'lab' && <button className="primary" onClick={run} disabled={busy || !selected.length} data-testid="run-suite"><span className={busy ? 'spinner' : ''}>{!busy && '▶'}</span>{recordedDemo ? 'Inspect recorded run' : busy ? 'Rehearsing…' : `Run ${selected.length} scenario${selected.length === 1 ? '' : 's'}`}<span className="button-key">↵</span></button>}</div>
        {error && <div role="alert" className="error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {busy && <div className="progress" role="status"><div><span className="spinner"/> {job.current}<strong>{job.completed} / {job.total}</strong></div><progress value={job.completed} max={job.total}/></div>}
        {page === 'lab' && <>
          {recordedDemo && <div className="recorded-banner" role="note"><strong>Recorded evidence, interactive explorer.</strong> This public preview displays a completed local SDK rehearsal. It does not execute tools. <a href="https://github.com/liorma6/actionledger#run-a-fresh-rehearsal">Run a fresh rehearsal ↗</a></div>}
          <div className="metrics">
            <Metric label="SCENARIOS EXECUTED" value={report ? String(report.summary.scenarios).padStart(2, '0') : '—'} detail="Isolated, paired environments"/>
            <Metric label="INVARIANT VIOLATIONS" value={report ? `${report.summary.baselineViolations} → ${report.summary.guardedViolations}` : '— → —'} detail="Unsafe caller → guarded caller" accent/>
            <Metric label="PROVIDER WRITES" value={report ? `${report.summary.baselineWrites} → ${report.summary.guardedWrites}` : '— → —'} detail="Measured mutations, including chat"/>
            <Metric label="UNCERTAIN ACTIONS HELD" value={report ? String(report.summary.held).padStart(2, '0') : '—'} detail="Held is safe. Held is not done."/>
          </div>
          <div className="workbench">
            <section className="scenario-panel" aria-label="Scenario selection"><div className="panel-heading"><h2>Fault scenarios <span>{catalog.length}</span></h2><button className="text-button" disabled={busy || recordedDemo} onClick={() => setSelected(selected.length === catalog.length ? [] : catalog.map(s => s.id))}>{selected.length === catalog.length ? 'Clear' : 'Select all'}</button></div><label className="filter-label">Category<select aria-label="Scenario category" value={filter} onChange={e => setFilter(e.target.value)}>{['All', 'Recovery', 'Concurrency', 'Identity', 'Control'].map(x => <option key={x}>{x}</option>)}</select></label>
              <div className="scenario-list">{visible.map((s, index) => { const result = report?.scenarios.find(r => r.scenario.id === s.id); return <div key={s.id} className={`scenario-item ${activeId === s.id ? 'selected' : ''}`}><input type="checkbox" aria-label={`Include ${s.name}`} checked={selected.includes(s.id)} disabled={busy || recordedDemo} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(x => x !== s.id))}/><button className="scenario-button" onClick={() => choose(s.id)}><span className="scenario-index">{String(catalog.indexOf(s) + 1).padStart(2, '0')}<span className={result ? 'scenario-complete' : ''}>{result ? '●' : '○'}</span></span><strong>{s.name}</strong><small>{s.short}</small></button></div>; })}</div>
              <div className="scope-note"><span>◎</span><p>Actual SDK requests.<br/>Local, simulated providers.</p></div>
            </section>
            <section className="detail-panel" aria-label="Scenario result">
              <div className="detail-heading"><div><div className="eyebrow">{catalog.find(s => s.id === activeId)?.category ?? 'RECOVERY'} / REHEARSAL</div><h2>{catalog.find(s => s.id === activeId)?.name ?? 'Select a scenario'}</h2></div>{active ? <span className="badge good"><Glyph name="check"/>Guard checks {active.guarded.invariants.filter(x => x.passed).length}/{active.guarded.invariants.length}</span> : <span className="badge neutral">Not yet run</span>}</div>
              <p className="scenario-description">{catalog.find(s => s.id === activeId)?.description}</p>
              {active ? <>
                <div className="comparison"><Lane lane={active.baseline} title="Caller retries" sub="Intentionally unsafe application policy"/><div className="compare-arrow">→</div><Lane lane={active.guarded} title="ActionLedger" sub="Durable identity + outcome evidence"/></div>
                <div className="tabs" role="tablist" aria-label="Evidence view">{['timeline', 'state', 'receipts'].map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); setInspected(undefined); }}>{t === 'timeline' ? 'Execution timeline' : t === 'state' ? 'Provider state' : `Action receipts (${active.guarded.receipts.length})`}</button>)}</div>
                <div role="tabpanel">{tab === 'timeline' ? <div className="timeline-grid"><Timeline lane={active.baseline} label="CALLER RETRIES" onInspect={setInspected}/><Timeline lane={active.guarded} label="GUARDED EXECUTION" onInspect={setInspected}/></div> : tab === 'state' ? <ProviderState result={active}/> : <div className="receipts">{active.guarded.receipts.length ? active.guarded.receipts.map(r => <article className="receipt" key={r.key}><div><span className={`badge ${r.state === 'COMMITTED' ? 'good' : 'warn'}`}>{r.state}</span><strong>{r.action.tool}</strong></div><p>{r.reason}</p><dl><dt>Intent</dt><dd>{r.action.intent}</dd><dt>Account</dt><dd>{r.action.account}</dd><dt>Fingerprint</dt><dd className="mono">{r.fingerprint.slice(0, 24)}…</dd></dl><details><summary>Inspect durable receipt</summary><pre>{JSON.stringify(r, null, 2)}</pre></details></article>) : <div className="compact-empty">Blocked before claim. No action was dispatched or recorded.</div>}</div>}</div>
                {inspected && <aside className="inspector" aria-label="Event inspector"><div><strong>{inspected.title}</strong><button aria-label="Close inspector" onClick={() => setInspected(undefined)}>×</button></div><p>{inspected.detail}</p>{inspected.data && <pre>{JSON.stringify(inspected.data, null, 2)}</pre>}</aside>}
                <div className="invariants"><h3>Contract checks</h3>{active.guarded.invariants.map(i => <div className="invariant" key={i.id}><span className={i.passed ? 'check-icon' : 'bad-icon'}>{i.passed ? '✓' : '×'}</span><span>{i.label}<small>{i.observed}</small></span><span className={`badge ${i.passed ? 'good' : 'warn'}`}>{i.passed ? 'Pass' : 'Fail'}</span></div>)}</div>
              </> : <div className="empty-state"><div className="empty-flow"><span>Intent</span><i>→</i><span className="empty-ledger">Ledger</span><i>→</i><span>Effect</span></div><h3>Put the failure in motion.</h3><p>Run a rehearsal to compare the same fault with and without a durable action record. Every metric comes from the resulting provider state.</p><button className="secondary" onClick={run} disabled={busy || !selected.length}>Start selected rehearsal <Glyph name="arrow"/></button></div>}
            </section>
          </div>
          {report && <div className="evidence-bar"><div><span className="evidence-icon"><Glyph name="layers"/></span><div><strong>Evidence bundle ready</strong><small>{time(report.createdAt)} · {(report.durationMs / 1000).toFixed(1)}s · SHA-256 {report.digest.slice(0, 12)}…</small></div></div><div><a className="export-link" href={recordedDemo ? './traces.otlp.json' : `/api/runs/${report.id}/otel`} download><Glyph name="download"/>OTel traces</a><a className="secondary" href={recordedDemo ? './evidence.json' : `/api/runs/${report.id}/export`} download><Glyph name="download"/>Download evidence</a></div></div>}
          <p className="footer-note">Current Composio SDKs do not automatically retry tool execution. The baseline deliberately retries at the application layer. This lab measures a local protocol contract, not live provider behavior.</p>
        </>}
        {page === 'history' && <section className="history panel">{history.length ? <><div className="history-head"><span>REHEARSAL</span><span>SCENARIOS</span><span>VIOLATIONS</span><span>STATUS</span></div>{history.map(h => <button className="history-row" key={h.id} onClick={() => void openRun(h.id)}><span><strong>{time(h.createdAt)}</strong><small>{h.id.slice(0, 8)} · {(h.durationMs / 1000).toFixed(1)}s</small></span><span>{h.summary.scenarios} scenarios</span><span>{h.summary.baselineViolations} → {h.summary.guardedViolations}</span><span className="badge good">Evidence ready ↗</span></button>)}</> : <div className="empty-state"><h3>No completed runs yet.</h3><p>Your first rehearsal will appear here.</p><button className="secondary" onClick={() => setPage('lab')}>Open rehearsals</button></div>}</section>}
        {page === 'method' && <Method/>}
      </div>
    </main>
  </div>;
}
function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: boolean }) { return <div className={`metric ${accent ? 'accent' : ''}`}><div className="metric-label">{label}</div><strong>{value}</strong><small>{detail}</small></div>; }
function Lane({ lane, title, sub }: { lane: LaneResult; title: string; sub: string }) {
  const violations = lane.invariants.filter(i => !i.passed).length, unknown = lane.receipts.some(r => r.state === 'UNKNOWN');
  return <div className={`lane ${lane.mode === 'guarded' ? 'guarded' : ''}`}><div className="lane-title"><span className={`lane-dot ${lane.mode === 'guarded' ? 'green' : ''}`}/><strong>{title}</strong><span className={`mini-state ${violations ? 'danger' : unknown ? 'amber' : ''}`}>{violations ? `${violations} failed` : unknown ? 'Held' : 'Passed'}</span></div><p>{sub}</p><div className="lane-numbers"><div><b>{lane.after.writes}</b><span>provider writes</span></div><div><b>{lane.sdkRequests}</b><span>SDK requests</span></div></div></div>;
}
function Timeline({ lane, label, onInspect }: { lane: LaneResult; label: string; onInspect: (e: TimelineEvent) => void }) { return <div className="timeline"><div className="timeline-label">{label}</div>{lane.timeline.map(e => <button key={e.sequence} className={`timeline-event ${e.level}`} onClick={() => onInspect(e)}><span className="event-node">{e.kind === 'provider' ? '↗' : e.kind === 'ledger' ? '▤' : e.kind === 'decision' ? '◇' : '·'}</span><span><strong>{e.title}</strong><small>{e.detail}</small></span><span className="event-order">{String(e.sequence).padStart(2, '0')}</span></button>)}</div>; }
function ProviderState({ result }: { result: ScenarioResult }) {
  return <div className="provider-state">{[['Before', result.guarded.before], ['Caller retries · after', result.baseline.after], ['ActionLedger · after', result.guarded.after]].map(([label, value]) => { const world = value as LaneResult['after']; return <div key={String(label)} className="world"><h3>{String(label)}</h3><div className="table-scroll"><table><thead><tr><th>Resource / account</th><th>State</th><th>Version</th></tr></thead><tbody>{world.events.map(e => <tr key={e.id}><td><strong>{e.id}</strong><small>{e.account}</small></td><td>{e.summary}<small>{e.start}</small></td><td className="mono">{e.etag}</td></tr>)}</tbody></table></div><div className="message-count">Chat notifications: <strong>{world.messages.length}</strong>{world.messages.map(m => <span key={m.id}> · {m.text}</span>)}</div></div>; })}</div>;
}
function Method() { return <div className="method"><section className="method-lead panel"><span className="badge good">MECHANISM, NOT MAGIC</span><h2>Uncertainty is a state.<br/>Not a reason to repeat a write.</h2><p>ActionLedger records a tenant-scoped intent before dispatch. It binds the actor, connected account, tool version and canonical inputs. Repeated callers receive the existing receipt. Changed inputs are blocked.</p><div className="method-steps">{[['01', 'Claim', 'An atomic SQLite transaction reserves the intent.'], ['02', 'Dispatch', 'The published Composio SDK makes the request.'], ['03', 'Resolve', 'Acknowledgment or unique provider evidence commits the receipt.'], ['04', 'Hold', 'An ambiguous result stays UNKNOWN. Dependent actions wait.']].map(([n, t, d]) => <div key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div></section><div className="method-columns"><section className="panel"><h3>What is real in this pilot</h3><ul><li>Published Composio TypeScript SDK, making HTTP calls</li><li>Post-commit socket failures and concurrent callers</li><li>SQLite transactions, durable receipts and restart tests</li><li>OpenTelemetry spans and downloadable evidence</li><li>React interface tested in desktop and mobile browsers</li></ul></section><section className="panel"><h3>What still requires validation</h3><ul><li>Hosted Composio and live provider behavior</li><li>Provider-specific durable correlation and consistency</li><li>Identity authentication, production authorization and encryption</li><li>Cross-region durability, recovery operations and retention</li><li>Customer demand, purchasing intent and commercial value</li></ul></section></div><div className="method-warning"><strong>No universal exactly-once guarantee.</strong><p>A held action may have succeeded or may never have reached its provider. The pilot deliberately favors review over an unsafe retry. The evidence digest detects accidental changes; it is not a cryptographic signature or tamper-proof audit trail.</p></div></div>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
