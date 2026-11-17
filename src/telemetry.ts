import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Json, TraceSpan } from './types.js';

const ns = (time: [number, number]) => (BigInt(time[0]) * 1_000_000_000n + BigInt(time[1])).toString();
export class RunTelemetry {
  private exporter = new InMemorySpanExporter();
  private provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(this.exporter)] });
  private tracer = this.provider.getTracer('actionledger', '0.1.0');
  private root = this.tracer.startSpan('actionledger.rehearsal');
  private parent = trace.setSpan(context.active(), this.root);
  constructor(mode: string, scenario: string) { this.root.setAttributes({ 'actionledger.mode': mode, 'actionledger.scenario': scenario }); }
  async call<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    const span = this.tracer.startSpan(`execute_tool ${tool}`, { attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool } }, this.parent);
    try {
      const value = await fn();
      const status = value && typeof value === 'object' && 'status' in value && typeof value.status === 'number' ? value.status : undefined;
      if (status !== undefined) span.setAttribute('http.response.status_code', status);
      span.setStatus({ code: status && status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK }); return value;
    }
    catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); span.setAttribute('error.type', error instanceof Error ? error.name : 'Error'); throw error; }
    finally { span.end(); }
  }
  async finish(): Promise<TraceSpan[]> {
    this.root.end(); await this.provider.forceFlush();
    const result = this.exporter.getFinishedSpans().map(s => ({
      traceId: s.spanContext().traceId, spanId: s.spanContext().spanId, parentSpanId: s.parentSpanContext?.spanId,
      name: s.name, startTimeUnixNano: ns(s.startTime), endTimeUnixNano: ns(s.endTime), attributes: s.attributes as Record<string, Json>, status: s.status.code,
    }));
    await this.provider.shutdown(); return result;
  }
}

export function asOtlp(spans: TraceSpan[]) {
  return { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'actionledger-pilot' } }] }, scopeSpans: [{ scope: { name: 'actionledger', version: '0.1.0' }, spans: spans.map(s => ({ ...s, kind: 1, status: { code: s.status }, attributes: Object.entries(s.attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } })) })) }] }] };
}
