import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('installer creates a protected env and launch agent without launching in dry-run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bo-console-install-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  await mkdir(join(project, 'scripts'), { recursive: true });
  await mkdir(join(project, 'helper'), { recursive: true });
  await mkdir(home, { recursive: true });
  await cp('scripts/install-helper.sh', join(project, 'scripts/install-helper.sh'));
  await cp('helper/.env.example', join(project, 'helper/.env.example'));

  const result = spawnSync('zsh', ['scripts/install-helper.sh', 'abcdefghijklmnopabcdefghijklmnop'], {
    cwd: project,
    env: { ...process.env, HOME: home, BO_CONSOLE_DRY_RUN: '1' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const envPath = join(project, 'helper/.env');
  const envText = await readFile(envPath, 'utf8');
  assert.match(envText, /HELPER_TOKEN=[a-f0-9]{64}/);
  assert.match(envText, /ALLOWED_EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop/);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.match(await readFile(join(home, 'Library/LaunchAgents/com.bo.console.helper.plist'), 'utf8'), /--env-file/);
});

test('installer rejects invalid extension ID', () => {
  const root = mkdtempSync(join(tmpdir(), 'bo-console-bad-id-'));
  const result = spawnSync('zsh', ['scripts/install-helper.sh', 'tooshort'], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: root, BO_CONSOLE_DRY_RUN: '1' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
});
