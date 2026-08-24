import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings, DEFAULT_SETTINGS } from '../extension/lib/settings-model.js';

test('normalizes watched ports to unique valid integers', () => {
  const settings = normalizeSettings({ watchedPorts: ['3000', 3306, 3000, 0, 65536, 'abc'] });
  assert.deepEqual(settings.watchedPorts, [3000, 3306]);
});

test('returns defaults when input is null', () => {
  const settings = normalizeSettings(null);
  assert.equal(settings.title, 'BO Console');
  assert.equal(settings.greetingName, '');
  assert.equal(settings.searchEngine, 'https://www.google.com/search?q=%s');
  assert.deepEqual(settings.watchedPorts, []);
  assert.equal(settings.nezhaBaseUrl, '');
  assert.deepEqual(settings.thresholds, { warning: 80, critical: 90 });
  assert.deepEqual(settings.refresh, { localSeconds: 10, remoteSeconds: 30 });
  assert.deepEqual(settings.shortcuts, []);
});

test('preserves valid custom values', () => {
  const settings = normalizeSettings({
    title: 'My Console',
    greetingName: '张三',
    searchEngine: 'https://www.bing.com/search?q=%s',
    watchedPorts: [8080, 3000],
    nezhaBaseUrl: 'https://nezha.example.com',
    thresholds: { warning: 70, critical: 85 },
    refresh: { localSeconds: 5, remoteSeconds: 15 },
    shortcuts: [{ name: 'GitHub', url: 'https://github.com' }],
  });
  assert.equal(settings.title, 'My Console');
  assert.equal(settings.greetingName, '张三');
  assert.deepEqual(settings.watchedPorts, [8080, 3000]);
  assert.deepEqual(settings.thresholds, { warning: 70, critical: 85 });
  assert.deepEqual(settings.refresh, { localSeconds: 5, remoteSeconds: 15 });
  assert.equal(settings.shortcuts.length, 1);
});

test('handles edge case port values', () => {
  const settings = normalizeSettings({ watchedPorts: [1, 65535, 0, 65536, -1, null, undefined, ''] });
  assert.deepEqual(settings.watchedPorts, [1, 65535]);
});
