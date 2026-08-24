import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNezhaServers } from '../helper/nezha.js';

test('maps Nezha V2 server fields to dashboard percentages', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    success: true,
    data: [{
      id: 7,
      name: '香港 Web 01',
      last_active: '2026-08-16T06:00:00Z',
      host: { mem_total: 1000, disk_total: 2000 },
      state: { cpu: 18, mem_used: 420, disk_used: 620, net_in_speed: 2100, net_out_speed: 8400, uptime: 7200 },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const [server] = await fetchNezhaServers({
    baseUrl: 'https://nezha.example.com',
    token: 'test-token',
    fetchImpl,
    nowMs: Date.parse('2026-08-16T06:00:30Z'),
  });

  assert.equal(server.online, true);
  assert.equal(server.memoryPercent, 42);
  assert.equal(server.diskPercent, 31);
});

test('marks server offline when last_active is older than 60 seconds', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    success: true,
    data: [{
      id: 1,
      name: '旧服务器',
      last_active: '2026-08-16T05:58:00Z',
      host: { mem_total: 1000, disk_total: 1000 },
      state: { cpu: 5, mem_used: 500, disk_used: 500, net_in_speed: 0, net_out_speed: 0, uptime: 100 },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const [server] = await fetchNezhaServers({
    baseUrl: 'https://nezha.example.com',
    token: 'test-token',
    fetchImpl,
    nowMs: Date.parse('2026-08-16T06:00:00Z'),
  });

  assert.equal(server.online, false);
});

test('throws unauthorized on 401', async () => {
  const fetchImpl = async () => new Response('Unauthorized', { status: 401 });

  await assert.rejects(
    () => fetchNezhaServers({ baseUrl: 'https://nezha.example.com', token: 'bad', fetchImpl }),
    (err) => {
      assert.equal(err.code, 'unauthorized');
      return true;
    },
  );
});

test('throws forbidden on 403', async () => {
  const fetchImpl = async () => new Response('Forbidden', { status: 403 });

  await assert.rejects(
    () => fetchNezhaServers({ baseUrl: 'https://nezha.example.com', token: 'bad', fetchImpl }),
    (err) => {
      assert.equal(err.code, 'forbidden');
      return true;
    },
  );
});

test('throws invalid_response on malformed JSON', async () => {
  const fetchImpl = async () => new Response('not json', { status: 200 });

  await assert.rejects(
    () => fetchNezhaServers({ baseUrl: 'https://nezha.example.com', token: 't', fetchImpl }),
    (err) => {
      assert.equal(err.code, 'invalid_response');
      return true;
    },
  );
});

test('throws invalid_url for non-http schemes', async () => {
  await assert.rejects(
    () => fetchNezhaServers({ baseUrl: 'ftp://example.com', token: 't' }),
    (err) => {
      assert.equal(err.code, 'invalid_url');
      return true;
    },
  );
});
