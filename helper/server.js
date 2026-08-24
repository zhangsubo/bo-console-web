import http from 'node:http';

export function createHelperServer({ config, collectDockerImpl, collectPortsImpl, fetchNezhaImpl }) {
  const { host, port, helperToken, allowedExtensionId, nezhaPat } = config;

  if (host !== '127.0.0.1') {
    throw new Error('Helper must bind to 127.0.0.1 only');
  }
  if (!helperToken) {
    throw new Error('HELPER_TOKEN is required');
  }
  if (!allowedExtensionId) {
    throw new Error('ALLOWED_EXTENSION_ID is required');
  }

  const allowedOrigin = `chrome-extension://${allowedExtensionId}`;

  function checkOrigin(req) {
    return req.headers.origin === allowedOrigin;
  }

  function checkToken(req) {
    return req.headers['x-helper-token'] === helperToken;
  }

  function setCors(res, origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Helper-Token, X-Nezha-Base-Url');
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handleSnapshot(req, res, url) {
    if (!checkOrigin(req)) {
      return json(res, 403, { error: 'forbidden' });
    }
    if (!checkToken(req)) {
      return json(res, 401, { error: 'unauthorized' });
    }

    setCors(res, allowedOrigin);

    const include = url.searchParams.get('include') || 'all';
    const runLocal = include === 'all' || include === 'local';
    const runRemote = include === 'all' || include === 'remote';

    const nezhaBaseUrl = req.headers['x-nezha-base-url'] || '';

    const snapshot = {
      generatedAt: new Date().toISOString(),
      local: { status: 'ok', updatedAt: null, containers: [], ports: [], error: null },
      remote: { status: 'ok', updatedAt: null, servers: [], error: null },
    };

    const tasks = [];

    if (runLocal) {
      tasks.push(
        (async () => {
          try {
            const docker = await collectDockerImpl();
            snapshot.local.containers = docker.containers;
            snapshot.local.updatedAt = new Date().toISOString();
          } catch (err) {
            snapshot.local.status = 'error';
            snapshot.local.error = { code: err.code || 'docker_unavailable', message: err.message };
          }
          try {
            snapshot.local.ports = await collectPortsImpl(new Map());
            if (!snapshot.local.updatedAt) {
              snapshot.local.updatedAt = new Date().toISOString();
            }
          } catch (err) {
            if (snapshot.local.status === 'ok') {
              snapshot.local.status = 'partial_error';
            }
            snapshot.local.error = snapshot.local.error || { code: 'ports_unavailable', message: err.message };
          }
        })(),
      );
    }

    if (runRemote) {
      tasks.push(
        (async () => {
          if (!nezhaBaseUrl || !nezhaPat) {
            snapshot.remote.status = 'unconfigured';
            return;
          }
          try {
            snapshot.remote.servers = await fetchNezhaImpl({
              baseUrl: nezhaBaseUrl,
              token: nezhaPat,
              nowMs: Date.now(),
            });
            snapshot.remote.updatedAt = new Date().toISOString();
          } catch (err) {
            snapshot.remote.status = 'error';
            snapshot.remote.error = { code: err.code || 'nezha_unreachable', message: err.message };
          }
        })(),
      );
    }

    await Promise.allSettled(tasks);
    return json(res, 200, snapshot);
  }

  function handleHealth(req, res) {
    if (!checkOrigin(req)) {
      return json(res, 403, { error: 'forbidden' });
    }
    setCors(res, allowedOrigin);
    return json(res, 200, { status: 'ok' });
  }

  function handlePair(req, res) {
    if (!checkOrigin(req)) {
      return json(res, 403, { error: 'forbidden' });
    }
    setCors(res, allowedOrigin);
    return json(res, 200, { token: helperToken });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (req.method === 'OPTIONS') {
      if (!checkOrigin(req)) {
        res.writeHead(403);
        res.end();
        return;
      }
      setCors(res, allowedOrigin);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/v1/health' && req.method === 'GET') {
      return handleHealth(req, res);
    }

    if (url.pathname === '/v1/pair' && req.method === 'POST') {
      return handlePair(req, res);
    }

    if (url.pathname === '/v1/snapshot' && req.method === 'GET') {
      return handleSnapshot(req, res, url);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  return server;
}

// Direct startup when run as main module
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const host = process.env.HELPER_HOST || '127.0.0.1';
  const port = Number(process.env.HELPER_PORT) || 17321;
  const helperToken = process.env.HELPER_TOKEN;
  const allowedExtensionId = process.env.ALLOWED_EXTENSION_ID;
  const nezhaPat = process.env.NEZHA_PAT || '';

  if (!helperToken || !allowedExtensionId) {
    console.error('HELPER_TOKEN and ALLOWED_EXTENSION_ID are required in .env');
    process.exit(1);
  }

  const { collectDocker } = await import('./docker.js');
  const { collectPorts } = await import('./ports.js');
  const { fetchNezhaServers } = await import('./nezha.js');

  const server = createHelperServer({
    config: { host, port, helperToken, allowedExtensionId, nezhaPat },
    collectDockerImpl: collectDocker,
    collectPortsImpl: (pubPorts) => collectPorts(pubPorts),
    fetchNezhaImpl: fetchNezhaServers,
  });

  server.listen(port, host, () => {
    console.log(`Helper listening on ${host}:${port}`);
  });
}
