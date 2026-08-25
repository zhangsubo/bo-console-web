# macOS Ops New Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-only Chrome new-tab extension that shows shortcuts, read-only Docker status, watched TCP port status, and Nezha server health through a loopback helper.

**Architecture:** A dependency-free Chrome Manifest V3 extension renders the page and stores non-secret preferences in `chrome.storage.local`. A dependency-free Node.js helper bound to `127.0.0.1:17321` runs Docker/lsof collectors and calls the Nezha REST API; strict extension-Origin checks and a per-install random token protect its read-only HTTP API.

**Tech Stack:** Chrome Manifest V3, vanilla HTML/CSS/JavaScript ES modules, Node.js 22+ standard library, `node:test`, macOS `launchd`, Docker CLI, `lsof`, Nezha V2 REST API.

## Global Constraints

- Target only the current macOS device and Chrome.
- Keep the dashboard read-only: no Docker control, process termination, remote execution, or file operations.
- Add no runtime or test dependencies; use browser and Node.js native APIs.
- The helper must listen only on `127.0.0.1:17321`.
- Keep the Nezha PAT only in `helper/.env`, permission mode `600`; never return or log it.
- Grant the PAT only `nezha:inventory:read` and configure a server ID whitelist.
- When watched ports are empty, show every TCP LISTEN port; when non-empty, show only watched ports, including explicit “未监听” rows.
- Valid watched ports are unique integers from `1` through `65535`; port ranges are not supported.
- Local data refreshes every 10 seconds and remote data every 30 seconds while the page is visible; both values remain user-configurable.
- One collector failing must not blank or block other modules.
- Render all Docker, process, server, and shortcut text with DOM `textContent`, never unsanitized `innerHTML`.
- Do not add history storage, charts, accounts, cloud sync, a database, a framework, or a build pipeline.

---

## Planned File Structure

```text
.
├── .gitignore
├── package.json
├── README.md
├── extension/
│   ├── manifest.json
│   ├── newtab.html
│   ├── newtab.css
│   ├── newtab.js
│   ├── settings.html
│   ├── settings.css
│   ├── settings.js
│   └── lib/
│       ├── api.js
│       ├── dashboard-model.js
│       ├── settings-model.js
│       └── storage.js
├── helper/
│   ├── .env.example
│   ├── server.js
│   ├── docker.js
│   ├── ports.js
│   └── nezha.js
├── scripts/
│   └── install-helper.sh
├── tests/
│   ├── manifest.test.js
│   ├── docker.test.js
│   ├── ports.test.js
│   ├── nezha.test.js
│   ├── helper-server.test.js
│   ├── install-helper.test.js
│   ├── dashboard-model.test.js
│   ├── settings-model.test.js
│   └── extension-pages.test.js
└── docs/superpowers/
    ├── specs/2026-08-16-macos-ops-new-tab-design.md
    └── plans/2026-08-16-macos-ops-new-tab-implementation.md
```

Each source file has one responsibility: system collectors, Nezha adaptation, HTTP transport, pure dashboard modeling, browser storage, settings UI, or dashboard UI. No shared abstraction is introduced until two callers actually need it.

### Task 1: Repository and Loadable MV3 Shell

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `extension/manifest.json`
- Create: `extension/newtab.html`
- Create: `extension/settings.html`
- Create: `tests/manifest.test.js`

**Interfaces:**
- Produces: a loadable unpacked extension rooted at `extension/`.
- Produces: `npm test` and an initially equivalent `npm run check`; Task 8 extends `check` with final entry-point syntax checks.

- [ ] **Step 1: Initialize Git before changing source files**

Run:

```bash
git init
git branch -M main
```

Expected: `.git/` exists and `git status --short` is empty.

- [ ] **Step 2: Write the failing manifest contract test**

Create `tests/manifest.test.js`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('manifest overrides Chrome new tabs with minimal permissions', async () => {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
  assert.equal(manifest.options_page, 'settings.html');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:17321/*']);
});
```

- [ ] **Step 3: Run the test and confirm the missing manifest fails**

Run: `node --test tests/manifest.test.js`

Expected: FAIL with `ENOENT` for `extension/manifest.json`.

- [ ] **Step 4: Add the minimal project and extension shell**

Create `package.json`:

```json
{
  "name": "bo-console-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "check": "node --test"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Create `.gitignore`:

```gitignore
.DS_Store
helper/.env
coverage/
```

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "BO Console",
  "version": "0.1.0",
  "description": "Read-only macOS, Docker, port and server status new tab.",
  "chrome_url_overrides": { "newtab": "newtab.html" },
  "options_page": "settings.html",
  "permissions": ["storage"],
  "host_permissions": ["http://127.0.0.1:17321/*"]
}
```

Create `extension/newtab.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BO Console</title></head>
<body><main><h1>BO Console</h1></main></body>
</html>
```

Create `extension/settings.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BO Console 设置</title></head>
<body><main><h1>BO Console 设置</h1></main></body>
</html>
```

Do not add inline scripts because MV3 blocks them.

- [ ] **Step 5: Verify the shell**

Run: `node --test tests/manifest.test.js`

Expected: PASS.

Manual check: load `extension/` from `chrome://extensions` and open a new tab. The shell heading appears without console CSP errors.

- [ ] **Step 6: Commit the shell**

```bash
git add .gitignore package.json extension tests/manifest.test.js
git commit -m "chore: initialize Chrome new tab extension"
```

### Task 2: Docker and TCP Listener Collectors

**Files:**
- Create: `helper/docker.js`
- Create: `helper/ports.js`
- Create: `tests/docker.test.js`
- Create: `tests/ports.test.js`

**Interfaces:**
- Produces: `collectDocker(runCommand): Promise<{ containers: Container[], publishedPorts: Map<number, string> }>`.
- Produces: `collectPorts(publishedPorts, runCommand = defaultRunCommand): Promise<PortListener[]>`.
- `Container`: `{ id, name, image, state, status, runningFor, createdAt, portMappings, publishedPorts, cpuPercent, memoryPercent }`.
- `PortListener`: `{ port, process, pid, source, detail }`.

- [ ] **Step 1: Write failing parser tests with real CLI-shaped fixtures**

Create `tests/docker.test.js` with assertions for newline-delimited `docker ps --format '{{json .}}'`, percentage parsing, stopped containers, and published port extraction:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDockerPs, parseDockerStats } from '../helper/docker.js';

test('parses containers and numeric stats', () => {
  const containers = parseDockerPs('{"ID":"abc","Names":"new-api","Image":"new-api:dev","State":"running","Status":"Up 2 hours","RunningFor":"2 hours","CreatedAt":"2026-08-16 12:00:00 +0800 CST","Ports":"0.0.0.0:3000->3000/tcp"}\n');
  const stats = parseDockerStats('{"ID":"abc","Name":"new-api","CPUPerc":"2.50%","MemPerc":"8.25%"}\n');
  assert.equal(containers[0].name, 'new-api');
  assert.equal(containers[0].publishedPorts[0], 3000);
  assert.deepEqual(stats.get('abc'), { cpuPercent: 2.5, memoryPercent: 8.25 });
});
```

Create `tests/ports.test.js` with `lsof -Fpcn` IPv4/IPv6 duplicate fixtures and `ps -axo pid=,command=` fixtures:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLsof, parseProcessCommands, enrichPorts } from '../helper/ports.js';

test('deduplicates IPv4 and IPv6 listeners and classifies their source', () => {
  const listeners = parseLsof('p744\ncmysqld\nn*:3306\nn[::1]:3306\np821\ncom.docker.backend\nn*:3000\n');
  const commands = parseProcessCommands('744 /opt/homebrew/opt/mysql/bin/mysqld\n821 /Applications/OrbStack.app/Contents/MacOS/OrbStack\n');
  const rows = enrichPorts(listeners, commands, new Map([[3000, 'new-api']]));
  assert.deepEqual(rows, [
    { port: 3000, process: 'com.docker.backend', pid: 821, source: 'Docker', detail: 'new-api' },
    { port: 3306, process: 'mysqld', pid: 744, source: 'Homebrew', detail: '' }
  ]);
});
```

- [ ] **Step 2: Verify both tests fail because collectors do not exist**

Run: `node --test tests/docker.test.js tests/ports.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the smallest command and parsing layer**

In `helper/docker.js`, use `promisify(execFile)` and `execFile('docker', args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 })`; never invoke a shell. Run:

```js
await runCommand('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}']);
await runCommand('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
```

Parse one JSON object per non-empty line, merge stats by full container ID and name, and extract host ports only from `HOST:PORT->CONTAINER/tcp` fragments. If Docker is not running, throw a typed `CollectorError('docker_unavailable', message)` without including command output that may expose environment details.

In `helper/ports.js`, run:

```js
await runCommand('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']);
await runCommand('/bin/ps', ['-axo', 'pid=,command=']);
```

Deduplicate by `port + pid`, then collapse duplicate IPv4/IPv6 records for the same port/process. Classify source as `Docker` when a published-port match exists, `Homebrew` when the command contains `/opt/homebrew/`, `FlyEnv` when it contains `/Applications/FlyEnv.app/`, otherwise `macOS`.

- [ ] **Step 4: Run collector unit tests**

Run: `node --test tests/docker.test.js tests/ports.test.js`

Expected: PASS.

- [ ] **Step 5: Perform a read-only live collector smoke check**

Run:

```bash
node -e "import('./helper/docker.js').then(async m => console.log((await m.collectDocker()).containers.length))"
node -e "import('./helper/ports.js').then(async m => console.log((await m.collectPorts(new Map())).length))"
```

Expected: each command prints a non-negative integer and makes no system changes.

- [ ] **Step 6: Commit collectors**

```bash
git add helper/docker.js helper/ports.js tests/docker.test.js tests/ports.test.js
git commit -m "feat: collect Docker and TCP listener status"
```

### Task 3: Nezha Read-Only Adapter

**Files:**
- Create: `helper/nezha.js`
- Create: `tests/nezha.test.js`

**Interfaces:**
- Produces: `fetchNezhaServers({ baseUrl, token, fetchImpl, nowMs }): Promise<ServerStatus[]>`.
- Produces: `ServerStatus`: `{ id, name, online, lastActive, cpuPercent, memoryPercent, diskPercent, netInSpeed, netOutSpeed, uptime }`.
- Throws: `NezhaError` with `code` equal to `unauthorized`, `forbidden`, `unreachable`, or `invalid_response`.

- [ ] **Step 1: Write failing adapter tests against official V2 field names**

Create `tests/nezha.test.js` using `host.mem_total`, `host.disk_total`, `state.mem_used`, `state.disk_used`, `state.net_in_speed`, `state.net_out_speed`, and `last_active`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNezhaServers } from '../helper/nezha.js';

test('maps Nezha V2 server fields to dashboard percentages', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ success: true, data: [{
    id: 7,
    name: '香港 Web 01',
    last_active: '2026-08-16T06:00:00Z',
    host: { mem_total: 1000, disk_total: 2000 },
    state: { cpu: 18, mem_used: 420, disk_used: 620, net_in_speed: 2100, net_out_speed: 8400, uptime: 7200 }
  }] }), { status: 200, headers: { 'content-type': 'application/json' } });

  const [server] = await fetchNezhaServers({
    baseUrl: 'https://nezha.example.com',
    token: 'test-token',
    fetchImpl,
    nowMs: Date.parse('2026-08-16T06:00:30Z')
  });

  assert.equal(server.online, true);
  assert.equal(server.memoryPercent, 42);
  assert.equal(server.diskPercent, 31);
});
```

Add separate tests asserting 401 maps to `unauthorized`, 403 to `forbidden`, malformed JSON to `invalid_response`, and a `last_active` older than 60 seconds maps to offline.

- [ ] **Step 2: Verify the adapter test fails**

Run: `node --test tests/nezha.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the adapter with a fixed trust boundary**

Validate `baseUrl` with `new URL()` and accept only `http:` or `https:`. Request `GET /api/v1/server` with:

```js
{
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(10_000)
}
```

Require `{ success: true, data: Array }`. Calculate percentages with `total > 0 ? used / total * 100 : null`, rounded to one decimal. Treat a server as online when `last_active` parses successfully and is no more than 60 seconds old. Do not include the request token in any error.

- [ ] **Step 4: Verify all Nezha adapter branches**

Run: `node --test tests/nezha.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the adapter**

```bash
git add helper/nezha.js tests/nezha.test.js
git commit -m "feat: read Nezha server health"
```

### Task 4: Secured Loopback Helper API

**Files:**
- Create: `helper/server.js`
- Create: `tests/helper-server.test.js`

**Interfaces:**
- Produces: `createHelperServer({ config, collectDockerImpl, collectPortsImpl, fetchNezhaImpl })`.
- HTTP `POST /v1/pair`: returns `{ token }` only to ``chrome-extension://${ALLOWED_EXTENSION_ID}``.
- HTTP `GET /v1/snapshot?include=local|remote|all`: requires the exact Origin and `X-Helper-Token`; accepts `X-Nezha-Base-Url`.
- HTTP `GET /v1/health`: returns `{ status: 'ok' }` after the same Origin check.
- Snapshot shape: `{ generatedAt, local: { status, updatedAt, containers, ports, error }, remote: { status, updatedAt, servers, error } }`.

- [ ] **Step 1: Write failing HTTP security and isolation tests**

Create `tests/helper-server.test.js` using an ephemeral port. The shared harness and two core isolation tests are:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHelperServer } from '../helper/server.js';

async function withServer(overrides, run) {
  const server = createHelperServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      helperToken: 'local-test-token',
      allowedExtensionId: 'abcdefghijklmnopabcdefghijklmnop',
      nezhaPat: 'test-token'
    },
    collectDockerImpl: async () => ({ containers: [], publishedPorts: new Map() }),
    collectPortsImpl: async () => [{ port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' }],
    fetchNezhaImpl: async () => { throw new Error('network unavailable'); },
    ...overrides
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('rejects ordinary web origins before exposing local data', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot`, {
      headers: { Origin: 'https://evil.example', 'X-Helper-Token': 'local-test-token' }
    });
    assert.equal(response.status, 403);
  });
});

test('keeps port data when Nezha fails', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot?include=all`, {
      headers: {
        Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        'X-Helper-Token': 'local-test-token',
        'X-Nezha-Base-Url': 'https://nezha.example.com'
      }
    });
    const snapshot = await response.json();
    assert.equal(snapshot.local.status, 'ok');
    assert.equal(snapshot.local.ports[0].port, 3000);
    assert.equal(snapshot.remote.status, 'error');
  });
});
```

Also test: pair succeeds only for the configured extension Origin; missing/wrong helper tokens return 401; OPTIONS returns only the configured Origin; missing PAT or base URL yields `remote.status = 'unconfigured'`; Docker failure does not remove port rows; `include=local`, `include=remote`, and `include=all` run only the requested collectors.

- [ ] **Step 2: Run the server tests and confirm failure**

Run: `node --test tests/helper-server.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the loopback server without a framework**

Use `node:http`. Read runtime values from `process.env`:

```text
HELPER_HOST=127.0.0.1
HELPER_PORT=17321
```

`HELPER_TOKEN` is a 64-character hex value generated by the installer. `ALLOWED_EXTENSION_ID` is the 32-character Chrome extension ID supplied to the installer. `NEZHA_PAT` remains blank until the user edits `helper/.env` locally.

Reject startup if `HELPER_HOST` is not exactly `127.0.0.1`, or if `HELPER_TOKEN`/`ALLOWED_EXTENSION_ID` are empty. For every route, compare `Origin` to `chrome-extension://${ALLOWED_EXTENSION_ID}` before setting CORS headers. Allow only `GET, POST, OPTIONS` and headers `Content-Type, X-Helper-Token, X-Nezha-Base-Url`.

Use `Promise.allSettled` so Docker, ports, and Nezha results remain independent. Return stable error codes such as `docker_unavailable`, `ports_unavailable`, `nezha_unauthorized`, and `nezha_unreachable`, never raw secrets. Accept `include=local`, `include=remote`, or `include=all` on `/v1/snapshot`, defaulting to `all`; do not persist history or refresh a source that was not requested.

- [ ] **Step 4: Verify API security and partial failure behavior**

Run: `node --test tests/helper-server.test.js`

Expected: PASS.

- [ ] **Step 5: Verify the full helper unit set**

Run: `node --test tests/docker.test.js tests/ports.test.js tests/nezha.test.js tests/helper-server.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the helper API**

```bash
git add helper/server.js tests/helper-server.test.js
git commit -m "feat: expose secured read-only helper API"
```

### Task 5: macOS Helper Installation

**Files:**
- Create: `helper/.env.example`
- Create: `scripts/install-helper.sh`
- Create: `tests/install-helper.test.js`

**Interfaces:**
- Produces: `./scripts/install-helper.sh "$EXTENSION_ID"`.
- Produces: `helper/.env` with mode `600`, preserving existing values on repeat runs.
- Produces: `~/Library/LaunchAgents/com.bo.console.helper.plist` pointing at this checkout and the current Node binary.
- Supports: `BO_CONSOLE_DRY_RUN=1` to generate files without invoking `launchctl`.

- [ ] **Step 1: Write a failing installer test in a temporary HOME**

Create `tests/install-helper.test.js`:

```js
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
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
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const envPath = join(project, 'helper/.env');
  const envText = await readFile(envPath, 'utf8');
  assert.match(envText, /HELPER_TOKEN=[a-f0-9]{64}/);
  assert.match(envText, /ALLOWED_EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop/);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.match(await readFile(join(home, 'Library/LaunchAgents/com.bo.console.helper.plist'), 'utf8'), /--env-file/);
});
```

- [ ] **Step 2: Confirm the installer test fails**

Run: `node --test tests/install-helper.test.js`

Expected: FAIL because `scripts/install-helper.sh` does not exist.

- [ ] **Step 3: Implement the idempotent installer**

Create `helper/.env.example`:

```dotenv
HELPER_HOST=127.0.0.1
HELPER_PORT=17321
HELPER_TOKEN=
ALLOWED_EXTENSION_ID=
NEZHA_PAT=
```

The Zsh installer must:

1. Validate the extension ID against `^[a-p]{32}$`.
2. Resolve the checkout directory and `command -v node` to absolute paths.
3. Create `helper/.env` only if absent, using `/usr/bin/openssl rand -hex 32`; always apply `chmod 600`.
4. Update only `ALLOWED_EXTENSION_ID` when rerun, preserving `HELPER_TOKEN` and `NEZHA_PAT`.
5. Back up an existing plist to a filename consisting of `com.bo.console.helper.plist.bak.` followed by `date +%Y%m%d%H%M%S` before replacing it.
6. Generate a plist whose `ProgramArguments` are the resolved Node binary, `--env-file=` joined to the resolved `helper/.env` path, and the resolved `helper/server.js` path.
7. Skip `launchctl` when `BO_CONSOLE_DRY_RUN=1`; otherwise boot out the old label if present and bootstrap the new plist.
8. Print the `.env` path and the exact `launchctl kickstart -k gui/$UID/com.bo.console.helper` restart command, but never print the helper token or PAT.

- [ ] **Step 4: Verify installer syntax and dry-run behavior**

Run:

```bash
zsh -n scripts/install-helper.sh
node --test tests/install-helper.test.js
```

Expected: both PASS.

- [ ] **Step 5: Commit installation support**

```bash
git add helper/.env.example scripts/install-helper.sh tests/install-helper.test.js
git commit -m "feat: install helper as a macOS launch agent"
```

### Task 6: Pure Dashboard and Watched-Port Model

**Files:**
- Create: `extension/lib/settings-model.js`
- Create: `extension/lib/dashboard-model.js`
- Create: `tests/settings-model.test.js`
- Create: `tests/dashboard-model.test.js`

**Interfaces:**
- Produces: `normalizeSettings(value): Settings`.
- Produces: `selectPortRows(listeners, watchedPorts): PortRow[]`.
- Produces: `filterPortRows(rows, sourceFilter): PortRow[]` and `isLikelyHttpPort(port): boolean`.
- Produces: `buildDashboardModel(snapshot, settings): DashboardModel`.
- `PortRow`: listener fields plus `listening: boolean`; missing watched ports contain `{ process: '', pid: null, source: '', detail: '' }`.

- [ ] **Step 1: Write failing settings normalization tests**

Create `tests/settings-model.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/lib/settings-model.js';

test('normalizes watched ports to unique valid integers', () => {
  const settings = normalizeSettings({ watchedPorts: ['3000', 3306, 3000, 0, 65536, 'abc'] });
  assert.deepEqual(settings.watchedPorts, [3000, 3306]);
});
```

Also assert defaults: warning 80, critical 90, local refresh 10 seconds, remote refresh 30 seconds, empty watched ports, empty shortcuts, and blank Nezha URL.

- [ ] **Step 2: Write failing watched-port and Attention tests**

Create `tests/dashboard-model.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardModel, filterPortRows, isLikelyHttpPort, selectPortRows } from '../extension/lib/dashboard-model.js';

test('shows only watched ports and keeps missing ports visible', () => {
  const rows = selectPortRows([
    { port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' },
    { port: 8080, process: 'nginx', pid: 11, source: 'FlyEnv', detail: '' }
  ], [3000, 9000]);
  assert.deepEqual(rows.map(({ port, listening }) => ({ port, listening })), [
    { port: 3000, listening: true },
    { port: 9000, listening: false }
  ]);
});

test('Docker filtering and HTTP links do not treat databases as websites', () => {
  assert.deepEqual(filterPortRows([
    { port: 3000, source: 'Docker' },
    { port: 3306, source: 'Homebrew' }
  ], 'docker').map(row => row.port), [3000]);
  assert.equal(isLikelyHttpPort(3000), true);
  assert.equal(isLikelyHttpPort(3306), false);
});

test('counts an unlistened watched port in Attention', () => {
  const model = buildDashboardModel({
    local: {
      status: 'ok',
      containers: [],
      ports: [{ port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' }]
    },
    remote: { status: 'ok', servers: [] }
  }, {
    watchedPorts: [3000, 9000],
    thresholds: { warning: 80, critical: 90 }
  });
  assert.equal(model.portSummary.missing, 1);
  assert.equal(model.attention.some(item => item.code === 'watched_port_missing' && item.port === 9000), true);
});
```

Add tests proving an empty watched-port list returns every listener; server offline/current resource threshold items are counted; partial-source errors preserve available cards.

- [ ] **Step 3: Run the model tests and confirm failure**

Run: `node --test tests/settings-model.test.js tests/dashboard-model.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement defaults and pure projection functions**

Use this exact settings shape:

```js
export const DEFAULT_SETTINGS = Object.freeze({
  title: 'BO Console',
  greetingName: '',
  searchEngine: 'https://www.google.com/search?q=%s',
  watchedPorts: [],
  nezhaBaseUrl: '',
  thresholds: { warning: 80, critical: 90 },
  refresh: { localSeconds: 10, remoteSeconds: 30 },
  shortcuts: []
});
```

Import `filterPortRows` and `isLikelyHttpPort` in the test. `selectPortRows` must preserve watched-port order. When no ports are watched, sort listeners numerically. `filterPortRows(rows, 'docker')` keeps only `source === 'Docker'`; `all` returns every row. `isLikelyHttpPort` returns true only for `80`, `443`, `3000`, `3001`, `4173`, `5173`, `8000`, `8008`, `8080`, and `9000`. Mark unlistened watched ports as critical Attention items. Mark resource percentages `>= critical` as critical and `>= warning` as warning. Calculate online-server average CPU from non-null current values. Keep string formatting out of the model so rendering remains replaceable.

- [ ] **Step 5: Verify all model branches**

Run: `node --test tests/settings-model.test.js tests/dashboard-model.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the model**

```bash
git add extension/lib/settings-model.js extension/lib/dashboard-model.js tests/settings-model.test.js tests/dashboard-model.test.js
git commit -m "feat: model watched ports and dashboard attention"
```

### Task 7: Settings, Storage, and Helper Pairing

**Files:**
- Create: `extension/lib/storage.js`
- Create: `extension/lib/api.js`
- Modify: `extension/settings.html`
- Create: `extension/settings.css`
- Create: `extension/settings.js`
- Create: `tests/extension-pages.test.js`

**Interfaces:**
- Produces: `loadSettings()`, `saveSettings(settings)`, `loadCachedSnapshot()`, `saveCachedSnapshot(snapshot)`.
- Produces: `pairHelper()`, `fetchSnapshot({ helperToken, nezhaBaseUrl, include })`.
- Persists helper token under `helperToken`; never persists the Nezha PAT.

- [ ] **Step 1: Write a failing static settings-page contract test**

Create `tests/extension-pages.test.js`:

```js
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
```

- [ ] **Step 2: Run the page test and confirm failure**

Run: `node --test tests/extension-pages.test.js`

Expected: FAIL because the shell settings page lacks the required controls.

- [ ] **Step 3: Implement storage and loopback API modules**

In `storage.js`, wrap callback-free MV3 Promise APIs:

```js
export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}
```

In `api.js`, use `http://127.0.0.1:17321`. `pairHelper()` sends `POST /v1/pair`, stores the returned helper token, and never displays it. `fetchSnapshot()` sends `X-Helper-Token`, `include=local|remote|all`, and, when configured, `X-Nezha-Base-Url`. Convert connection refusal, 401, and 403 to stable UI error codes.

- [ ] **Step 4: Build the settings UI with native controls**

Use the IDs asserted by the test. Use `<input id="watched-port" type="number" min="1" max="65535">` plus an Add button for watched-port tags. Reject duplicates and invalid ports inline. Provide shortcut rows with name, URL, optional icon URL, delete, and native HTML drag-and-drop ordering. Save normalized settings to `chrome.storage.local`.

The form skeleton is:

```html
<form id="settings-form">
  <label>页面标题 <input id="title" required></label>
  <label>问候名称 <input id="greeting-name"></label>
  <label>搜索模板 <input id="search-engine" required></label>
  <label>关注端口 <input id="watched-port" type="number" min="1" max="65535"></label>
  <button id="add-watched-port" type="button">添加端口</button>
  <div id="watched-port-list"></div>
  <label>哪吒地址 <input id="nezha-base-url" type="url"></label>
  <label>警告阈值 <input id="warning-threshold" type="number" min="1" max="99"></label>
  <label>严重阈值 <input id="critical-threshold" type="number" min="2" max="100"></label>
  <label>本机刷新秒数 <input id="local-refresh" type="number" min="5" max="300"></label>
  <label>服务器刷新秒数 <input id="remote-refresh" type="number" min="10" max="600"></label>
  <section id="shortcut-list" aria-label="快捷入口"></section>
  <button id="add-shortcut" type="button">添加快捷入口</button>
  <button id="test-helper" type="button">测试 Helper 连接</button>
  <button id="save-settings" type="submit">保存</button>
</form>
<script type="module" src="settings.js"></script>
```

The helper connection button performs pairing, then one snapshot request. It displays only “已连接”, “Helper 未运行”, or “扩展 ID 未授权”; it must not reveal the helper token or PAT.

- [ ] **Step 5: Verify settings contracts and normalization**

Run:

```bash
node --test tests/settings-model.test.js tests/extension-pages.test.js
node --check extension/settings.js
```

Expected: PASS.

Manual check: open the extension options page, enter `3000`, `3306`, and `9000`, attempt duplicate `3000`, save, reload, and confirm only the three unique ports remain.

- [ ] **Step 6: Commit settings and pairing**

```bash
git add extension/lib/storage.js extension/lib/api.js extension/settings.html extension/settings.css extension/settings.js tests/extension-pages.test.js
git commit -m "feat: configure dashboard and pair local helper"
```

### Task 8: New-Tab Dashboard UI

**Files:**
- Modify: `package.json`
- Modify: `extension/newtab.html`
- Create: `extension/newtab.css`
- Create: `extension/newtab.js`
- Modify: `tests/extension-pages.test.js`

**Interfaces:**
- Consumes: `loadSettings`, cached snapshots, `fetchSnapshot`, and `buildDashboardModel`.
- Produces: the approved single-screen dashboard and responsive one-column fallback.

- [ ] **Step 1: Extend the static page test for accessible dashboard landmarks**

Append this test to `tests/extension-pages.test.js`:

```js
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
```

- [ ] **Step 2: Run the page test and confirm the shell page fails**

Run: `node --test tests/extension-pages.test.js`

Expected: FAIL on missing dashboard landmarks.

- [ ] **Step 3: Implement the semantic HTML and approved layout**

Build the approved structure from the design spec: compact top bar, greeting/search, icon shortcuts, four summary cards, left local column, right server/Attention column, and footer refresh status. Use CSS Grid and one breakpoint that stacks the two columns; do not add a separate mobile design.

Use this exact landmark skeleton and populate its internal cards with DOM rendering:

```html
<header>
  <button id="refresh-button" type="button" aria-label="刷新状态">刷新</button>
  <a id="settings-link" href="settings.html">设置</a>
</header>
<main>
  <form id="search-form" role="search" aria-label="网页搜索"></form>
  <nav id="shortcut-nav" aria-label="快捷入口"></nav>
  <section id="summary-section" aria-label="状态摘要"></section>
  <div class="dashboard-grid">
    <div>
      <section id="docker-section" aria-labelledby="docker-heading"></section>
      <section id="port-section" aria-labelledby="port-heading"></section>
    </div>
    <div>
      <section id="server-section" aria-labelledby="server-heading"></section>
      <section id="attention-section" aria-labelledby="attention-heading"></section>
    </div>
  </div>
</main>
<dialog id="container-dialog" aria-labelledby="container-dialog-heading"></dialog>
<footer><span id="status-live" aria-live="polite"></span></footer>
<script type="module" src="newtab.js"></script>
```

Use system fonts and CSS custom properties for neutral, success, warning, critical, and unknown colors. Preserve keyboard focus outlines and honor `prefers-reduced-motion`. Buttons require visible text or `aria-label`.

- [ ] **Step 4: Implement safe rendering and interactions**

In `newtab.js`:

1. Load settings and the cached snapshot immediately.
2. Render all external values through `textContent` and DOM creation helpers.
3. Render watched-port mode exactly from `buildDashboardModel`; show unlistened watched ports and hide unrelated listeners.
4. Render only the first five containers in the card. “查看全部” opens the native `<dialog id="container-dialog">`; each container uses `<details>` for image, full ID, port mappings, and start time.
5. When no watched ports exist, show “全部 / Docker” filters backed by `filterPortRows`; when watched ports exist, hide those filters and show only the configured rows.
6. Link only listening ports for which `isLikelyHttpPort(port)` is true, using ``new URL(`http://localhost:${port}`)``, and only after user click.
7. Render shortcut images from the configured icon URL or the shortcut URL origin joined with `/favicon.ico`; fall back to initials on image error.
8. Open server cards at `${nezhaBaseUrl}/dashboard/server/${id}` using a validated `http:`/`https:` URL; if construction fails, disable the link.
9. Focus the search field on `⌘K`; treat valid `http:`/`https:` input as a URL and send all other text through the configured `%s` search template.
10. Stop timers when `document.visibilityState !== 'visible'`; refresh immediately on return.
11. Start separate visible-page timers: request `include=local` every `localSeconds` and `include=remote` every `remoteSeconds`; use `include=all` on initial load and manual refresh. Update the footer with separate local and remote timestamps.
12. Preserve the last successful module data when a later snapshot marks that module as error; render explicit loading, unconfigured, empty, stale, and partial-error states from the design spec.

- [ ] **Step 5: Run automated page and model checks**

Update `package.json` so the final check script is:

```json
"check": "node --test && node --check helper/server.js && node --check extension/newtab.js && node --check extension/settings.js"
```

Run:

```bash
node --test tests/extension-pages.test.js tests/dashboard-model.test.js tests/settings-model.test.js
node --check extension/newtab.js
```

Expected: PASS.

- [ ] **Step 6: Run the visual and interaction smoke check in Chrome**

Load `extension/` unpacked, open a new tab at 1440 × 900, and verify:

- The first viewport contains shortcuts, summaries, five Docker rows, watched ports, server cards, and Attention.
- A watched but closed port remains visible as red “未监听”.
- A long-running unlisted port is absent when watched-port mode is active.
- Keyboard navigation reaches search, shortcuts, filters, refresh, and settings in reading order.
- With Helper stopped, shortcuts/search still work and the stale-data state is visible.
- At a narrow width, local and server sections stack without horizontal scrolling.

- [ ] **Step 7: Commit the dashboard**

```bash
git add package.json extension/newtab.html extension/newtab.css extension/newtab.js tests/extension-pages.test.js
git commit -m "feat: render the read-only ops dashboard"
```

### Task 9: End-to-End Setup and Acceptance

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-08-16-macos-ops-new-tab-design.md`

**Interfaces:**
- Produces: exact local installation, configuration, verification, restart, and removal instructions.

- [ ] **Step 1: Write README acceptance instructions before final verification**

Document this exact setup order:

1. Run `npm test`.
2. Load `extension/` from `chrome://extensions` with Developer Mode.
3. Copy the 32-character extension ID.
4. Export the copied ID as `EXTENSION_ID`, then run `./scripts/install-helper.sh "$EXTENSION_ID"`.
5. Edit `helper/.env`, adding the Nezha PAT locally without pasting it into chat or source control.
6. Run `launchctl kickstart -k gui/$UID/com.bo.console.helper`.
7. Open extension settings, configure the Nezha URL, watched ports, thresholds, refresh intervals, and shortcuts.
8. Click Test Helper Connection and open a new tab.

Also document removal as a recoverable manual sequence: boot out the launch agent, move its plist to Trash, remove the unpacked extension from Chrome, and leave `helper/.env` untouched unless the user explicitly chooses to delete credentials.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm run check`

Expected: all Node tests PASS and JavaScript syntax checks succeed.

- [ ] **Step 3: Compare live data with authoritative commands**

Run read-only comparisons:

```bash
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN
set -a
source helper/.env
set +a
curl -sS -H "Origin: chrome-extension://$ALLOWED_EXTENSION_ID" -H "X-Helper-Token: $HELPER_TOKEN" http://127.0.0.1:17321/v1/snapshot
```

Expected: Docker counts match, watched port ownership matches `lsof`, and the helper response never contains `NEZHA_PAT` or `HELPER_TOKEN`.

- [ ] **Step 4: Verify security and failure acceptance**

Run:

```bash
curl -i -H 'Origin: https://example.com' http://127.0.0.1:17321/v1/snapshot
rg -n 'nzp_[A-Za-z0-9]{16,}|NEZHA_PAT=\S+|HELPER_TOKEN=\S+' --glob '!helper/.env' --glob '!docs/**' .
```

Expected: the first command returns 403; the search finds no committed secret value. Then verify in Chrome that Docker stopped, Nezha unreachable, invalid PAT, and Helper stopped each affect only their intended modules.

- [ ] **Step 5: Mark the design delivered and inspect the final diff**

Change the design status from `用户已确认` to `已实现并验收` only after every acceptance item passes.

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -9
```

Expected: only intended files are present, `git diff --check` prints nothing, and each implementation task has one focused commit.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/superpowers/specs/2026-08-16-macos-ops-new-tab-design.md
git commit -m "docs: add local setup and acceptance guide"
```

## Reference Evidence

- Nezha V2 REST API and PAT scope guidance: <https://nezha.wiki/guide/api.html>
- Nezha current server response model: <https://github.com/nezhahq/nezha/blob/master/model/server_api.go>
- Nezha current host/state fields: <https://github.com/nezhahq/nezha/blob/master/model/host.go>
