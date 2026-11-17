import { test, expect } from '@playwright/test';
test('public preview labels recorded evidence and sends no execution requests', async ({ page }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.goto('/'); await expect(page.getByRole('note')).toContainText('does not execute tools');
  await expect(page.getByText('Evidence bundle ready')).toBeVisible();
  await page.getByTestId('run-suite').click(); await expect(page.getByTestId('run-suite')).toHaveText(/Inspect recorded run/);
  await expect(page.getByLabel('Include The response disappeared')).toBeDisabled();
  await page.getByRole('button', { name: /02.*No evidence to trust/ }).click(); await page.getByRole('tab', { name: /Action receipts/ }).click();
  await expect(page.locator('.receipt .badge')).toHaveText('UNKNOWN'); expect(posts).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test('recorded evidence is downloadable and matches the displayed report', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Evidence bundle ready')).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download evidence' }).click();
  const download = await downloadPromise; const stream = await download.createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk;
  expect(JSON.parse(text).summary.baselineViolations).toBe(9);
  await page.getByRole('button', { name: 'How it works' }).click(); await expect(page.getByText('No universal exactly-once guarantee.')).toBeVisible();
});
