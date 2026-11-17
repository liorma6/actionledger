import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runSuite, scenarios } from './lab.js';
import { asOtlp } from './telemetry.js';
import { readJson } from './twin.js';
import type { Report } from './types.js';

export async function startApp(port = 8789, root = resolve('runtime')) {
  await mkdir(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'reports.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, created TEXT NOT NULL, body TEXT NOT NULL)');
  type Job = { id: string; status: 'running' | 'complete' | 'error'; completed: number; total: number; current: string; error?: string };
  const jobs = new Map<string, Job>(); let active = false;
  const assets = resolve('public');
  const reportById = (id: string): Report | undefined => { const row = db.prepare('SELECT body FROM reports WHERE id=?').get(id) as { body: string } | undefined; return row && JSON.parse(row.body); };
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown, extra: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }); res.end(JSON.stringify(value)); };
    try {
      const address = server.address(); const livePort = typeof address === 'object' && address ? address.port : port;
      const origin = `http://127.0.0.1:${livePort}`;
      if (req.headers.host !== `127.0.0.1:${livePort}` && req.headers.host !== `localhost:${livePort}`) { json(403, { error: 'Loopback host required' }); return; }
      const url = new URL(req.url ?? '/', origin);
      if (req.method === 'GET' && url.pathname === '/api/scenarios') { json(200, scenarios); return; }
      if (req.method === 'GET' && url.pathname === '/api/runs') {
        const rows = db.prepare('SELECT body FROM reports ORDER BY created DESC LIMIT 30').all() as { body: string }[];
        json(200, rows.map(row => { const r = JSON.parse(row.body) as Report; return { id: r.id, createdAt: r.createdAt, summary: r.summary, durationMs: r.durationMs }; })); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        if (req.headers.origin && ![origin, `http://localhost:${livePort}`].includes(req.headers.origin)) { json(403, { error: 'Same-origin requests required' }); return; }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') { json(415, { error: 'JSON required' }); return; }
        let input: unknown;
        try { input = await readJson(req); } catch { json(400, { error: 'Invalid or oversized JSON' }); return; }
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'scenarios')) { json(400, { error: 'Only scenario selection is accepted' }); return; }
        const ids = (input as { scenarios?: unknown }).scenarios;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > scenarios.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !scenarios.some(s => s.id === id))) { json(400, { error: 'Select one to eight unique known scenarios' }); return; }
        if (active) { json(409, { error: 'A rehearsal is already running' }); return; }
        const id = randomUUID(); const job: Job = { id, status: 'running', completed: 0, total: ids.length, current: 'Starting isolated worlds' }; jobs.set(id, job); active = true;
        void runSuite(ids, root, (completed, name) => { job.completed = completed; job.current = name; }, id).then(report => {
          db.prepare('INSERT INTO reports(id,created,body) VALUES (?,?,?)').run(report.id, report.createdAt, JSON.stringify(report)); job.status = 'complete'; job.current = 'Evidence ready';
        }).catch(error => { job.status = 'error'; job.error = error instanceof Error ? error.message : 'Rehearsal failed'; }).finally(() => { active = false; });
        json(202, job); return;
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(export|otel))?$/);
      if (req.method === 'GET' && match) {
        const report = reportById(match[1]);
        if (report) {
          const extra: Record<string, string> = match[2] ? { 'content-disposition': `attachment; filename="actionledger-${report.id.slice(0, 8)}${match[2] === 'otel' ? '-otel' : ''}.json"` } : {};
          json(200, match[2] === 'otel' ? asOtlp(report.scenarios.flatMap(s => [...s.baseline.spans, ...s.guarded.spans])) : match[2] ? report : { status: 'complete', report }, extra); return;
        }
        const job = jobs.get(match[1]); if (job && !match[2]) { json(200, job); return; }
        json(404, { error: 'Run not found' }); return;
      }
      if (url.pathname.startsWith('/api/')) { json(404, { error: 'Route not found' }); return; }
      if (req.method !== 'GET') { json(405, { error: 'Method not allowed' }); return; }
      const path = resolve(assets, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(assets + sep)) { json(403, { error: 'Invalid path' }); return; }
      try {
        const data = await readFile(path);
        res.writeHead(200, { 'content-type': ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'referrer-policy': 'no-referrer' }); res.end(data);
      } catch { json(404, { error: 'Build the frontend with npm run build' }); }
    } catch (error) { if (!res.headersSent) json(500, { error: error instanceof Error ? error.message : 'Request failed' }); else res.end(); }
  });
  await new Promise<void>(resolveListen => server.listen(port, '127.0.0.1', resolveListen));
  return { server, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); db.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8789);
  await startApp(port, resolve(process.env.ACTIONLEDGER_DATA ?? 'runtime'));
  console.log(`ActionLedger is ready at http://127.0.0.1:${port}`);
}
