import { mkdir, writeFile } from 'node:fs/promises';
import { runSuite, scenarios } from '../src/lab.js';
import { asOtlp } from '../src/telemetry.js';
await mkdir('docs/evidence', { recursive: true });
const report = await runSuite(scenarios.map(s => s.id), 'runtime/evidence');
await writeFile('docs/evidence/rehearsal.json', JSON.stringify(report, null, 2));
await writeFile('docs/evidence/traces.otlp.json', JSON.stringify(asOtlp(report.scenarios.flatMap(s => [...s.baseline.spans, ...s.guarded.spans])), null, 2));
console.log(JSON.stringify({ summary: report.summary, digest: report.digest, durationMs: report.durationMs }, null, 2));
if (report.summary.guardedViolations > 0) process.exitCode = 1;
