import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the tw-mobile-sync plugin documentation wiki.
 *
 * These tests verify that the plugin tiddlers render correctly when the
 * documentation wiki is served via `pnpm dev`.
 */
test.describe('tw-mobile-sync plugin docs', () => {
  test('wiki homepage loads with plugin readme visible', async ({ page }) => {
    await page.goto('/');
    // Wait for TiddlyWiki to boot and render the default tiddlers.
    await expect(page.locator('.tc-site-subtitle')).toContainText('A Plugin Demo');
    // The readme tiddler is one of the default tiddlers.
    await expect(page.locator('.tc-tiddler-frame[data-tiddler-title="$:/plugins/linonetwo/tw-mobile-sync/readme"]')).toBeVisible();
  });

  test('plugin server list control panel renders', async ({ page }) => {
    await page.goto('/#%24%3A%2Fplugins%2Flinonetwo%2Ftw-mobile-sync%2Fui%2FServerList');
    const frame = page.locator('.tc-tiddler-frame[data-tiddler-title="$:/plugins/linonetwo/tw-mobile-sync/ui/ServerList"]');
    await expect(frame).toBeVisible();
    await expect(frame.locator('text=ServerList')).toBeVisible();
  });

  test('plugin changelog is reachable', async ({ page }) => {
    await page.goto('/#%24%3A%2Fplugins%2Flinonetwo%2Ftw-mobile-sync%2Fchangelog');
    await expect(page.getByRole('heading', { name: 'Changelog', exact: true })).toBeVisible();
  });
});
