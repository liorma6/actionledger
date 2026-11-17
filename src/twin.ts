import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Json, Scenario, TimelineEvent, World, WorldEvent } from './types.js';

export type Log = (kind: TimelineEvent['kind'], title: string, detail: string, level?: TimelineEvent['level'], data?: Record<string, Json>) => void;
export async function readJson(req: IncomingMessage, limit = 16_384): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > limit) throw new Error('Request too large'); chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** A deliberately small local protocol twin, NOT a Google Calendar or Composio emulator. */
export async function startTwin(fault: Scenario['fault'], log: Log) {
  const world: World = { events: [{ id: 'event-planning', summary: 'Launch planning', start: '10:00', etag: 'v1', account: 'ca_demo' }], messages: [], writes: 0 };
  let faultUsed = false, requests = 0;
  const server = createServer(async (req, res) => {
    const reply = (status: number, data: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status, data, headers: { 'content-type': 'application/json' } })); };
    try {
      if (req.method !== 'POST' || req.url !== '/api/v3.1/tools/execute/proxy') { res.writeHead(404).end(); return; }
      const body = await readJson(req) as { endpoint: string; method: string; connected_account_id: string; body?: Record<string, Json>; parameters?: { name: string; type: string; value: string }[] };
      requests++;
      const endpoint = new URL(body.endpoint, 'http://provider.invalid');
      const account = body.connected_account_id;
      log('request', `${body.method} ${endpoint.pathname}`, `Published Composio SDK → loopback proxy · ${account}`, 'info', { method: body.method, endpoint: endpoint.pathname, account });
      if (body.method === 'GET') {
        if (endpoint.pathname === '/calendar/events') { reply(200, { items: world.events.filter(e => e.account === account) }); return; }
        const event = world.events.find(e => e.id === endpoint.pathname.split('/').at(-1) && e.account === account);
        reply(event ? 200 : 404, event ?? { error: 'Not found' }); return;
      }
      const input = body.body ?? {};
      let result: unknown;
      if (endpoint.pathname === '/calendar/events' && body.method === 'POST') {
        const event: WorldEvent = { id: `event-${world.events.length + 1}`, account, summary: String(input.summary), start: String(input.start), etag: 'v1', marker: String(input.marker ?? ''), fingerprint: String(input.fingerprint ?? '') };
        world.events.push(event); result = event;
      } else if (endpoint.pathname.startsWith('/calendar/events/') && body.method === 'PATCH') {
        const event = world.events.find(e => e.id === endpoint.pathname.split('/').at(-1) && e.account === account);
        if (!event) { reply(404, { error: 'Not found' }); return; }
        const match = body.parameters?.find(p => p.type === 'header' && p.name.toLowerCase() === 'if-match')?.value;
        if (match && match !== `"${event.etag}"`) { log('provider', 'Precondition rejected', `Expected ${match}; current version is ${event.etag}. No mutation.`, 'good'); reply(412, { error: 'Version conflict' }); return; }
        event.summary = String(input.summary); event.start = String(input.start); event.etag = 'v' + (Number(event.etag.slice(1)) + 1); result = event;
      } else if (endpoint.pathname === '/chat/messages' && body.method === 'POST') {
        const message = { id: `message-${world.messages.length + 1}`, account, text: String(input.text), marker: String(input.marker ?? ''), fingerprint: String(input.fingerprint ?? '') };
        world.messages.push(message); result = message;
      } else { reply(400, { error: 'Unsupported local fixture route' }); return; }
      world.writes++;
      log('provider', 'Side effect committed', `${endpoint.pathname} · write ${world.writes}`, 'info', result as Record<string, Json>);
      if (!faultUsed && (fault === 'disconnect' || fault === 'false-failure') && endpoint.pathname === '/calendar/events') {
        faultUsed = true;
        if (fault === 'disconnect') { log('provider', 'Response lost after commit', 'TCP socket destroyed after storing the event. The client cannot infer the outcome.', 'warn'); req.socket.destroy(); return; }
        log('provider', 'Failure response after commit', 'The synthetic proxy reports 500 although the provider state changed.', 'warn'); reply(500, { error: 'Synthetic post-commit failure' }); return;
      }
      reply(200, result);
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    snapshot: () => structuredClone(world),
    requests: () => requests,
    externalEdit() { world.events[0].start = '11:00'; world.events[0].summary = 'Human-approved planning'; world.events[0].etag = 'v2'; log('provider', 'Human edited the event', 'A separate actor committed version v2 after the agent read v1.', 'warn'); },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); },
  };
}
