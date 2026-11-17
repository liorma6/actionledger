import { Composio } from '@composio/core';
import { actionKey, fingerprint } from './ledger.js';
import type { Action, Json } from './types.js';
import { RunTelemetry } from './telemetry.js';

export class DefiniteRejection extends Error {}
export class UncertainResult extends Error {}
export class LocalComposioAdapter {
  private sdk: Composio;
  constructor(baseURL: string, private telemetry: RunTelemetry) {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('This pilot only connects to its loopback twin');
    this.sdk = new Composio({ apiKey: 'actionledger-synthetic-key', baseURL, allowTracking: false });
  }
  private async proxy(action: Action, endpoint: string, method: 'GET' | 'POST' | 'PATCH', body?: Record<string, Json>, guarded = true) {
    return this.telemetry.call(action.tool, () => this.sdk.tools.proxyExecute({
      connectedAccountId: action.account, endpoint, method, ...(body ? { body } : {}),
      parameters: guarded && action.expectedVersion ? [{ in: 'header', name: 'If-Match', value: `"${action.expectedVersion}"` }] : [],
    }, { signal: AbortSignal.timeout(5_000) }));
  }
  async dispatch(action: Action, guarded = true): Promise<Json> {
    if (action.tool === 'calendar.patch' && guarded && !action.expectedVersion) throw new DefiniteRejection('A conditional update requires the observed version');
    const route = action.tool === 'chat.send' ? '/chat/messages' : action.tool === 'calendar.patch' ? `/calendar/events/${String(action.arguments.id)}` : '/calendar/events';
    const body = { ...action.arguments, marker: actionKey(action), fingerprint: fingerprint(action) };
    const result = await this.proxy(action, route, action.tool === 'calendar.patch' ? 'PATCH' : 'POST', body, guarded);
    if (result.status === 412) throw new DefiniteRejection('Version changed; re-read and obtain a new decision before editing');
    if (result.status < 200 || result.status >= 300) throw new UncertainResult(`Proxy status ${result.status}; status alone does not prove absence of a write`);
    const data = result.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as Record<string, unknown>).id !== 'string') throw new UncertainResult('Success response is missing a durable resource identifier');
    return data as Json;
  }
  async readEvent(action: Action): Promise<Json> { const response = await this.proxy(action, '/calendar/events/event-planning', 'GET'); if (response.status !== 200) throw new Error('Fixture read failed'); return response.data as Json; }
  async reconcile(action: Action): Promise<Json | null> {
    // This is a provider-specific read-after-write contract of the local twin, not a generic API guarantee.
    if (action.tool !== 'calendar.create') return null;
    const response = await this.proxy(action, '/calendar/events', 'GET');
    if (response.status !== 200 || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) return null;
    const items = (response.data as { items?: unknown }).items;
    if (!Array.isArray(items)) return null;
    const matches = items.filter(e => e && typeof e === 'object' && e.marker === actionKey(action) && e.fingerprint === fingerprint(action) && e.account === action.account && typeof e.id === 'string');
    return matches.length === 1 ? matches[0] as Json : null;
  }
}
