import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLsof, parseProcessCommands, enrichPorts } from '../helper/ports.js';

test('deduplicates IPv4 and IPv6 listeners and classifies their source', () => {
  const listeners = parseLsof('p744\ncmysqld\nn*:3306\nn[::1]:3306\np821\nccom.docker.backend\nn*:3000\n');
  const commands = parseProcessCommands('744 /opt/homebrew/opt/mysql/bin/mysqld\n821 /Applications/OrbStack.app/Contents/MacOS/OrbStack\n');
  const rows = enrichPorts(listeners, commands, new Map([[3000, 'new-api']]));
  assert.deepEqual(rows, [
    { port: 3000, process: 'com.docker.backend', pid: 821, source: 'Docker', detail: 'new-api' },
    { port: 3306, process: 'mysqld', pid: 744, source: 'Homebrew', detail: '' },
  ]);
});

test('classifies FlyEnv processes', () => {
  const listeners = parseLsof('p913\ncnginx\nn*:8008\n');
  const commands = parseProcessCommands('913 /Applications/FlyEnv.app/Contents/MacOS/nginx\n');
  const rows = enrichPorts(listeners, commands, new Map());
  assert.equal(rows[0].source, 'FlyEnv');
});

test('falls back to macOS for unknown processes', () => {
  const listeners = parseLsof('p100\ncnode\nn*:4000\n');
  const commands = parseProcessCommands('100 /usr/local/bin/node\n');
  const rows = enrichPorts(listeners, commands, new Map());
  assert.equal(rows[0].source, 'macOS');
});
