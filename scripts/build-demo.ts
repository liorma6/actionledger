import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
process.env.VITE_RECORDED_DEMO = 'true';
await build({ build: { outDir: '../site', emptyOutDir: true } });
await copyFile('docs/evidence/rehearsal.json', 'site/evidence.json');
await copyFile('docs/evidence/traces.otlp.json', 'site/traces.otlp.json');
