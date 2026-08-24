export class NezhaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function fetchNezhaServers({ baseUrl, token, fetchImpl = fetch, nowMs }) {
  let url;
  try {
    url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new NezhaError('invalid_url', 'Only http and https URLs are accepted');
    }
  } catch {
    throw new NezhaError('invalid_url', 'Invalid Nezha base URL');
  }

  const apiUrl = new URL('/api/v1/server', url).href;
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new NezhaError('unreachable', 'Nezha request timed out');
    }
    throw new NezhaError('unreachable', `Nezha request failed: ${err.message}`);
  }

  if (response.status === 401) {
    throw new NezhaError('unauthorized', 'Nezha PAT is invalid or expired');
  }
  if (response.status === 403) {
    throw new NezhaError('forbidden', 'Nezha PAT lacks required permissions');
  }
  if (!response.ok) {
    throw new NezhaError('unreachable', `Nezha returned HTTP ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new NezhaError('invalid_response', 'Nezha response is not valid JSON');
  }

  if (!body.success || !Array.isArray(body.data)) {
    throw new NezhaError('invalid_response', 'Nezha response missing success or data');
  }

  const now = nowMs ?? Date.now();
  const ONLINE_THRESHOLD_MS = 60_000;

  return body.data.map((server) => {
    const memTotal = server.host?.mem_total ?? 0;
    const diskTotal = server.host?.disk_total ?? 0;
    const memUsed = server.state?.mem_used ?? 0;
    const diskUsed = server.state?.disk_used ?? 0;

    const lastActive = server.last_active ? new Date(server.last_active) : null;
    const online = lastActive ? (now - lastActive.getTime()) <= ONLINE_THRESHOLD_MS : false;

    return {
      id: server.id,
      name: server.name,
      online,
      lastActive: lastActive?.toISOString() ?? null,
      cpuPercent: server.state?.cpu ?? null,
      memoryPercent: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
      diskPercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 1000) / 10 : null,
      netInSpeed: server.state?.net_in_speed ?? 0,
      netOutSpeed: server.state?.net_out_speed ?? 0,
      uptime: server.state?.uptime ?? 0,
    };
  });
}
