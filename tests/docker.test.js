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

test('handles stopped containers with no ports or stats', () => {
  const containers = parseDockerPs('{"ID":"def","Names":"old-project","Image":"old:v1","State":"exited","Status":"Exited (0) 3 days ago","RunningFor":"","CreatedAt":"2026-08-10 12:00:00 +0800 CST","Ports":""}\n');
  assert.equal(containers[0].state, 'exited');
  assert.deepEqual(containers[0].publishedPorts, []);
});

test('extracts multiple published ports from one container', () => {
  const containers = parseDockerPs('{"ID":"ghi","Names":"multi","Image":"multi:v1","State":"running","Status":"Up 1 hour","RunningFor":"1 hour","CreatedAt":"2026-08-16 12:00:00 +0800 CST","Ports":"0.0.0.0:8080->8080/tcp, 0.0.0.0:8443->8443/tcp"}\n');
  assert.deepEqual(containers[0].publishedPorts, [8080, 8443]);
});

test('ignores non-0.0.0.0 port bindings', () => {
  const containers = parseDockerPs('{"ID":"jkl","Names":"local-only","Image":"local:v1","State":"running","Status":"Up 1 hour","RunningFor":"1 hour","CreatedAt":"2026-08-16 12:00:00 +0800 CST","Ports":"127.0.0.1:3000->3000/tcp"}\n');
  assert.deepEqual(containers[0].publishedPorts, []);
});
