const HTTP_PORTS = new Set([80, 443, 3000, 3001, 4173, 5173, 8000, 8008, 8080, 9000]);

export function isLikelyHttpPort(port) {
  return HTTP_PORTS.has(port);
}

export function selectPortRows(listeners, watchedPorts) {
  if (watchedPorts.length === 0) {
    return listeners.map(l => ({ ...l, listening: true }));
  }

  const listenerMap = new Map();
  for (const l of listeners) {
    listenerMap.set(l.port, l);
  }

  return watchedPorts.map(port => {
    const l = listenerMap.get(port);
    if (l) {
      return { ...l, listening: true };
    }
    return {
      port,
      process: '',
      pid: null,
      source: '',
      detail: '',
      listening: false,
    };
  });
}

export function filterPortRows(rows, sourceFilter) {
  if (sourceFilter === 'docker') {
    return rows.filter(r => r.source === 'Docker');
  }
  if (sourceFilter === 'system') {
    return rows.filter(r => r.source !== 'Docker');
  }
  return rows;
}

export function buildDashboardModel(snapshot, settings) {
  const { thresholds } = settings;
  const local = snapshot.local ?? { status: 'ok', containers: [], ports: [] };
  const remote = snapshot.remote ?? { status: 'ok', servers: [] };

  // Docker summary
  const runningContainers = local.containers.filter(c => c.state === 'running');
  const stoppedContainers = local.containers.filter(c => c.state !== 'running');
  const dockerSummary = {
    running: runningContainers.length,
    stopped: stoppedContainers.length,
  };

  // Port summary
  const portRows = selectPortRows(local.ports ?? [], settings.watchedPorts);
  const listeningCount = portRows.filter(r => r.listening).length;
  const notListeningCount = portRows.filter(r => !r.listening).length;
  const portSummary = {
    total: portRows.length,
    listening: listeningCount,
    missing: notListeningCount,
  };

  // Server summary
  const servers = remote.servers ?? [];
  const onlineServers = servers.filter(s => s.online);
  const offlineServers = servers.filter(s => !s.online);
  const avgCpu = onlineServers.length > 0
    ? Math.round(onlineServers.reduce((sum, s) => sum + (s.cpuPercent ?? 0), 0) / onlineServers.length * 10) / 10
    : null;
  const serverSummary = {
    total: servers.length,
    online: onlineServers.length,
    offline: offlineServers.length,
    avgCpu,
  };

  // Attention items
  const attention = [];

  // Watched ports not listening
  for (const row of portRows) {
    if (!row.listening) {
      attention.push({
        code: 'watched_port_missing',
        severity: 'critical',
        message: `端口 ${row.port} 未监听`,
        port: row.port,
      });
    }
  }

  // Offline servers
  for (const server of offlineServers) {
    attention.push({
      code: 'server_offline',
      severity: 'critical',
      message: `${server.name} 离线`,
      serverId: server.id,
    });
  }

  // Resource thresholds
  for (const server of servers) {
    if (!server.online) continue;
    for (const [key, label] of [['cpuPercent', 'CPU'], ['memoryPercent', '内存'], ['diskPercent', '磁盘']]) {
      const val = server[key];
      if (val == null) continue;
      if (val >= thresholds.critical) {
        attention.push({
          code: 'resource_critical',
          severity: 'critical',
          message: `${server.name} ${label} ${val}%`,
          serverId: server.id,
        });
      } else if (val >= thresholds.warning) {
        attention.push({
          code: 'resource_warning',
          severity: 'warning',
          message: `${server.name} ${label} ${val}%`,
          serverId: server.id,
        });
      }
    }
  }

  return {
    dockerSummary,
    containers: local.containers ?? [],
    portRows,
    portSummary,
    serverSummary,
    servers,
    attention,
    localStatus: local.status,
    remoteStatus: remote.status,
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  };
}
