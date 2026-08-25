import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('settings drawer exposes only non-secret dashboard preferences', async () => {
  const html = await readFile('extension/newtab.html', 'utf8');
  for (const id of ['title', 'greeting-name', 'search-engine', 'watched-port', 'nezha-base-url', 'warning-threshold', 'critical-threshold', 'local-refresh', 'remote-refresh', 'ports-per-page', 'shortcut-list', 'save-settings', 'test-helper']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /name=["'](?:pat|password)["']/i);
});

test('new tab has the required accessible dashboard regions', async () => {
  const html = await readFile('extension/newtab.html', 'utf8');
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  for (const id of ['search-form', 'shortcut-nav', 'docker-section', 'container-dialog', 'port-section', 'server-section', 'attention-section', 'refresh-button', 'settings-link', 'status-live']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /<script[^>]+type=["']module["'][^>]+src=["']newtab\.js["']/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /aria-live=["']polite["']/);
});
