import assert from 'node:assert/strict';
import test from 'node:test';
import { createHelperServer } from '../helper/server.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'local-test-token';

async function withServer(overrides, run) {
  const server = createHelperServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      helperToken: TOKEN,
      allowedExtensionId: EXT_ID,
      nezhaPat: 'test-token',
    },
    collectDockerImpl: async () => ({ containers: [], publishedPorts: new Map() }),
    collectPortsImpl: async () => [{ port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' }],
    fetchNezhaImpl: async () => { throw new Error('network unavailable'); },
    ...overrides,
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
      headers: { Origin: 'https://evil.example', 'X-Helper-Token': TOKEN },
    });
    assert.equal(response.status, 403);
  });
});

test('keeps port data when Nezha fails', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot?include=all`, {
      headers: {
        Origin: `chrome-extension://${EXT_ID}`,
        'X-Helper-Token': TOKEN,
        'X-Nezha-Base-Url': 'https://nezha.example.com',
      },
    });
    const snapshot = await response.json();
    assert.equal(snapshot.local.status, 'ok');
    assert.equal(snapshot.local.ports[0].port, 3000);
    assert.equal(snapshot.remote.status, 'error');
  });
});

test('pair succeeds only for the configured extension origin', async () => {
  await withServer({}, async baseUrl => {
    const ok = await fetch(`${baseUrl}/v1/pair`, {
      method: 'POST',
      headers: { Origin: `chrome-extension://${EXT_ID}` },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.token, TOKEN);

    const blocked = await fetch(`${baseUrl}/v1/pair`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(blocked.status, 403);
  });
});

test('missing helper token returns 401', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot`, {
      headers: { Origin: `chrome-extension://${EXT_ID}` },
    });
    assert.equal(response.status, 401);
  });
});

test('wrong helper token returns 401', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot`, {
      headers: { Origin: `chrome-extension://${EXT_ID}`, 'X-Helper-Token': 'wrong' },
    });
    assert.equal(response.status, 401);
  });
});

test('health endpoint requires valid origin', async () => {
  await withServer({}, async baseUrl => {
    const ok = await fetch(`${baseUrl}/v1/health`, {
      headers: { Origin: `chrome-extension://${EXT_ID}` },
    });
    assert.equal(ok.status, 200);

    const blocked = await fetch(`${baseUrl}/v1/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(blocked.status, 403);
  });
});

test('remote status is unconfigured when PAT is missing', async () => {
  await withServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      helperToken: TOKEN,
      allowedExtensionId: EXT_ID,
      nezhaPat: '',
    },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot?include=remote`, {
      headers: { Origin: `chrome-extension://${EXT_ID}`, 'X-Helper-Token': TOKEN },
    });
    const snapshot = await response.json();
    assert.equal(snapshot.remote.status, 'unconfigured');
  });
});

test('Docker failure does not remove port rows', async () => {
  await withServer({
    collectDockerImpl: async () => { throw new Error('docker not running'); },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot?include=all`, {
      headers: { Origin: `chrome-extension://${EXT_ID}`, 'X-Helper-Token': TOKEN },
    });
    const snapshot = await response.json();
    assert.equal(snapshot.local.status, 'error');
    assert.equal(snapshot.local.ports.length, 1);
  });
});

test('include=local skips remote collection', async () => {
  let nezhaCalled = false;
  await withServer({
    fetchNezhaImpl: async () => { nezhaCalled = true; return []; },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/v1/snapshot?include=local`, {
      headers: { Origin: `chrome-extension://${EXT_ID}`, 'X-Helper-Token': TOKEN },
    });
    assert.equal(response.status, 200);
    assert.equal(nezhaCalled, false);
  });
});

test('rejects startup when host is not 127.0.0.1', () => {
  assert.throws(
    () => createHelperServer({
      config: { host: '0.0.0.0', port: 0, helperToken: TOKEN, allowedExtensionId: EXT_ID, nezhaPat: '' },
    }),
    /127\.0\.0\.1/,
  );
});
