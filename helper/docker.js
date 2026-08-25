import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

export class CollectorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function parseDockerPs(output) {
  const containers = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    const portMappings = [];
    const publishedPorts = [];
    if (row.Ports) {
      for (const part of row.Ports.split(', ')) {
        const m = part.match(/0\.0\.0\.0:(\d+)->/);
        if (m) {
          portMappings.push(part);
          publishedPorts.push(Number(m[1]));
        }
      }
    }
    containers.push({
      id: row.ID,
      name: row.Names,
      image: row.Image,
      state: row.State,
      status: row.Status,
      runningFor: row.RunningFor,
      createdAt: row.CreatedAt,
      portMappings,
      publishedPorts,
      cpuPercent: 0,
      memoryPercent: 0,
    });
  }
  return containers;
}

export function parseDockerStats(output) {
  const stats = new Map();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    stats.set(row.ID, {
      cpuPercent: parseFloat(row.CPUPerc) || 0,
      memoryPercent: parseFloat(row.MemPerc) || 0,
    });
  }
  return stats;
}

export async function collectDocker(runCommand) {
  const dockerBin = process.env.DOCKER_BIN || 'docker';
  if (!runCommand) {
    runCommand = async (cmd, args) => {
      const { stdout } = await execFile(cmd, args, {
        timeout: 8000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    };
  }
  let psOutput, statsOutput;
  try {
    [psOutput, statsOutput] = await Promise.all([
      runCommand(dockerBin, ['ps', '-a', '--no-trunc', '--format', '{{json .}}']),
      runCommand(dockerBin, ['stats', '--no-stream', '--format', '{{json .}}']),
    ]);
  } catch (err) {
    throw new CollectorError('docker_unavailable', err.message);
  }

  const containers = parseDockerPs(psOutput);
  const stats = parseDockerStats(statsOutput);
  const publishedPorts = new Map();

  for (const c of containers) {
    const s = stats.get(c.id);
    if (s) {
      c.cpuPercent = s.cpuPercent;
      c.memoryPercent = s.memoryPercent;
    }
    for (const port of c.publishedPorts) {
      publishedPorts.set(port, c.name);
    }
  }

  return { containers, publishedPorts };
}
