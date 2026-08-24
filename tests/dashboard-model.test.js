import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardModel, filterPortRows, isLikelyHttpPort, selectPortRows } from '../extension/lib/dashboard-model.js';

test('shows only watched ports and keeps missing ports visible', () => {
  const rows = selectPortRows([
    { port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' },
    { port: 8080, process: 'nginx', pid: 11, source: 'FlyEnv', detail: '' },
  ], [3000, 9000]);
  assert.deepEqual(rows.map(({ port, listening }) => ({ port, listening })), [
    { port: 3000, listening: true },
    { port: 9000, listening: false },
  ]);
});

test('returns all listeners when watched ports is empty', () => {
  const rows = selectPortRows([
    { port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' },
    { port: 8080, process: 'nginx', pid: 11, source: 'FlyEnv', detail: '' },
  ], []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].listening, true);
});

test('Docker filtering and HTTP links do not treat databases as websites', () => {
  assert.deepEqual(filterPortRows([
    { port: 3000, source: 'Docker' },
    { port: 3306, source: 'Homebrew' },
  ], 'docker').map(row => row.port), [3000]);
  assert.equal(isLikelyHttpPort(3000), true);
  assert.equal(isLikelyHttpPort(3306), false);
});

test('counts an unlistened watched port in Attention', () => {
  const model = buildDashboardModel({
    local: {
      status: 'ok',
      containers: [],
      ports: [{ port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' }],
    },
    remote: { status: 'ok', servers: [] },
  }, {
    watchedPorts: [3000, 9000],
    thresholds: { warning: 80, critical: 90 },
  });
  assert.equal(model.portSummary.missing, 1);
  assert.equal(model.attention.some(item => item.code === 'watched_port_missing' && item.port === 9000), true);
});

test('counts server offline and resource threshold items', () => {
  const model = buildDashboardModel({
    local: { status: 'ok', containers: [], ports: [] },
    remote: {
      status: 'ok',
      servers: [
        { id: 1, name: 'Server A', online: true, cpuPercent: 95, memoryPercent: 50, diskPercent: 50 },
        { id: 2, name: 'Server B', online: false, cpuPercent: 0, memoryPercent: 0, diskPercent: 0 },
        { id: 3, name: 'Server C', online: true, cpuPercent: 82, memoryPercent: 50, diskPercent: 50 },
      ],
    },
  }, {
    watchedPorts: [],
    thresholds: { warning: 80, critical: 90 },
  });
  assert.equal(model.serverSummary.offline, 1);
  assert.equal(model.attention.filter(a => a.code === 'server_offline').length, 1);
  assert.equal(model.attention.filter(a => a.severity === 'critical' && a.code === 'resource_critical').length, 1);
  assert.equal(model.attention.filter(a => a.severity === 'warning' && a.code === 'resource_warning').length, 1);
});

test('partial source errors preserve available data', () => {
  const model = buildDashboardModel({
    local: { status: 'error', containers: [], ports: [{ port: 3000, process: 'node', pid: 10, source: 'macOS', detail: '' }] },
    remote: { status: 'unconfigured', servers: [] },
  }, {
    watchedPorts: [],
    thresholds: { warning: 80, critical: 90 },
  });
  assert.equal(model.localStatus, 'error');
  assert.equal(model.remoteStatus, 'unconfigured');
  assert.equal(model.portRows.length, 1);
});

test('computes average CPU from online servers only', () => {
  const model = buildDashboardModel({
    local: { status: 'ok', containers: [], ports: [] },
    remote: {
      status: 'ok',
      servers: [
        { id: 1, name: 'A', online: true, cpuPercent: 50, memoryPercent: 0, diskPercent: 0 },
        { id: 2, name: 'B', online: false, cpuPercent: 100, memoryPercent: 0, diskPercent: 0 },
      ],
    },
  }, {
    watchedPorts: [],
    thresholds: { warning: 80, critical: 90 },
  });
  assert.equal(model.serverSummary.avgCpu, 50);
});
