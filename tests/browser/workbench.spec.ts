import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByTestId('run-suite')).toBeEnabled(); });
async function run(page: import('@playwright/test').Page) {
  await page.getByTestId('run-suite').click();
  await expect(page.getByText('Evidence bundle ready')).toBeVisible();
}
test('rehearses all scenarios, shows measured comparison, and renders without browser errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await run(page);
  await expect(page.getByRole('heading', { name: 'The response disappeared' })).toBeVisible();
  await expect(page.getByText('Guard checks 2/2')).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconciled from provider evidence/ })).toBeVisible();
  await expect(page.locator('.metric.accent strong')).toHaveText('9 → 0');
  expect(errors).toEqual([]);
});
test('distinguishes UNKNOWN held work from a completed task', async ({ page }) => {
  await run(page); await page.getByRole('button', { name: /02.*No evidence to trust/ }).click();
  await expect(page.getByText('Dependent notification held')).toBeVisible();
  await page.getByRole('tab', { name: /Action receipts/ }).click();
  await expect(page.locator('.receipt .badge')).toHaveText('UNKNOWN');
  await page.getByText('Inspect durable receipt').click();
  await expect(page.locator('.receipt pre')).toContainText('Outcome uncertain');
});
test('makes the intervening human edit visible in before and after state', async ({ page }) => {
  await run(page); await page.getByRole('button', { name: /03.*A human changed the plan/ }).click();
  await page.getByRole('tab', { name: 'Provider state' }).click();
  const worlds = page.locator('.world');
  await expect(worlds.nth(0)).toContainText('10:00'); await expect(worlds.nth(1)).toContainText('14:00'); await expect(worlds.nth(2)).toContainText('11:00');
  await expect(worlds.nth(2)).toContainText('Human-approved planning');
});
test('inspects actual provider evidence and exports report plus OTLP traces', async ({ page }) => {
  await run(page); await page.getByRole('button', { name: /Reconciled from provider evidence/ }).click();
  await expect(page.getByRole('complementary', { name: 'Event inspector' })).toContainText('Exactly one matching durable record');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download evidence' }).click();
  const download = await downloadPromise; const stream = await download.createReadStream(); let body = ''; for await (const chunk of stream!) body += chunk.toString();
  const evidence = JSON.parse(body); expect(evidence.scenarios).toHaveLength(8); expect(evidence.digest).toMatch(/^[a-f0-9]{64}$/); expect(evidence.summary.guardedViolations).toBe(0);
  const tracePromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'OTel traces' }).click();
  const trace = await tracePromise; const traceStream = await trace.createReadStream(); let traceBody = ''; for await (const chunk of traceStream!) traceBody += chunk.toString();
  expect(JSON.parse(traceBody).resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(40);
});
test('selection changes the executed suite and category filtering remains usable', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear', exact: true }).click(); await expect(page.getByTestId('run-suite')).toBeDisabled();
  await page.getByLabel('Scenario category').selectOption('Control');
  await page.getByLabel('Include The healthy path').check(); await expect(page.getByTestId('run-suite')).toHaveText(/Run 1 scenario/);
  await run(page); await expect(page.locator('.metric.accent strong')).toHaveText('0 → 0');
  await expect(page.getByRole('heading', { name: 'The healthy path' })).toBeVisible();
});
test('history survives page reload and restores a concrete report', async ({ page }) => {
  await run(page); await page.reload();
  await page.getByRole('button', { name: /Run history/ }).click(); await expect(page.locator('.history-row').first()).toBeVisible();
  await page.locator('.history-row').first().click(); await expect(page.getByText('Evidence bundle ready')).toBeVisible();
  await expect(page.locator('.metric.accent strong')).toHaveText('9 → 0');
});
test('API errors are visible and allow a new attempt', async ({ page }) => {
  await page.route('**/api/runs', async route => { if (route.request().method() === 'POST') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A rehearsal is already running' }) }); else await route.continue(); });
  await page.getByTestId('run-suite').click(); await expect(page.getByRole('alert')).toContainText('already running');
  await expect(page.getByTestId('run-suite')).toBeEnabled(); await page.getByRole('button', { name: 'Dismiss error' }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/runs'); await run(page);
});
test('layout stays within the viewport and the method explains limits', async ({ page }) => {
  await run(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'How it works' }).click(); await expect(page.getByText('No universal exactly-once guarantee.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
