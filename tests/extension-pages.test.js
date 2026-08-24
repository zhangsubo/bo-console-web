import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('settings page exposes only non-secret dashboard preferences', async () => {
  const html = await readFile('extension/settings.html', 'utf8');
  for (const id of ['title', 'greeting-name', 'search-engine', 'watched-port', 'nezha-base-url', 'warning-threshold', 'critical-threshold', 'local-refresh', 'remote-refresh', 'shortcut-list', 'save-settings', 'test-helper']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /name=["'](?:pat|password)["']/i);
});
