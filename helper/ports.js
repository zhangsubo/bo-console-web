import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

export function parseLsof(output) {
  const listeners = [];
  let currentPid = null;
  let currentProcess = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith('c')) {
      currentProcess = line.slice(1);
    } else if (line.startsWith('n')) {
      const addr = line.slice(1);
      const m = addr.match(/:(\d+)$/);
      if (m) {
        listeners.push({
          port: Number(m[1]),
          process: currentProcess,
          pid: currentPid,
        });
      }
    }
  }
  return listeners;
}

export function parseProcessCommands(output) {
  const commands = new Map();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(.+)$/);
    if (m) {
      commands.set(Number(m[1]), m[2]);
    }
  }
  return commands;
}

export function enrichPorts(listeners, commands, publishedPorts) {
  // Deduplicate by port + pid
  const seen = new Set();
  const deduped = [];
  for (const l of listeners) {
    const key = `${l.port}:${l.pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(l);
  }

  // Collapse IPv4/IPv6 duplicates: same port + same process base name
  const byPortProcess = new Map();
  for (const l of deduped) {
    const key = `${l.port}:${l.process}`;
    if (!byPortProcess.has(key)) {
      byPortProcess.set(key, l);
    }
  }

  const rows = [];
  for (const l of byPortProcess.values()) {
    let source = 'macOS';
    const cmd = commands.get(l.pid) || '';
    if (publishedPorts.has(l.port)) {
      source = 'Docker';
    } else if (cmd.includes('/opt/homebrew/')) {
      source = 'Homebrew';
    } else if (cmd.includes('/Applications/FlyEnv.app/')) {
      source = 'FlyEnv';
    }

    rows.push({
      port: l.port,
      process: l.process,
      pid: l.pid,
      source,
      detail: publishedPorts.get(l.port) || '',
    });
  }

  // Sort by port number
  rows.sort((a, b) => a.port - b.port);
  return rows;
}

export async function collectPorts(publishedPorts, runCommand) {
  if (!runCommand) {
    runCommand = async (cmd, args) => {
      const { stdout } = await execFile(cmd, args, {
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    };
  }

  let lsofOutput, psOutput;
  try {
    [lsofOutput, psOutput] = await Promise.all([
      runCommand('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']),
      runCommand('/bin/ps', ['-axo', 'pid=,command=']),
    ]);
  } catch (err) {
    throw new Error(`ports_unavailable: ${err.message}`);
  }

  const listeners = parseLsof(lsofOutput);
  const commands = parseProcessCommands(psOutput);
  return enrichPorts(listeners, commands, publishedPorts);
}
