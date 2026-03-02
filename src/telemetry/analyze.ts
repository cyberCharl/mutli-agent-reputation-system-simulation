import * as fs from 'fs';
import * as path from 'path';
import { TraceEvent } from '../types';
import { parseTraceEvent } from './events';

function listTraceFiles(targetPath: string): string[] {
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    return [targetPath];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const resolved = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTraceFiles(resolved));
    } else if (entry.isFile() && entry.name.endsWith('.ndjson')) {
      files.push(resolved);
    }
  }

  return files.sort();
}

export function readTraceEvents(tracePath: string): TraceEvent[] {
  const raw = fs.readFileSync(tracePath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => parseTraceEvent(JSON.parse(line)));
}

export function computeActionFrequenciesFromTracePath(
  tracePath: string
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of listTraceFiles(tracePath)) {
    for (const event of readTraceEvents(file)) {
      if (event.eventType !== 'action_constrained') {
        continue;
      }

      const action = event.payload.appliedAction;
      counts[action] = (counts[action] || 0) + 1;
    }
  }

  return Object.keys(counts)
    .sort()
    .reduce<Record<string, number>>((acc, key) => {
      acc[key] = counts[key];
      return acc;
    }, {});
}

function main(): void {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error('Usage: pnpm trace:actions <trace-file-or-directory>');
    process.exit(1);
  }

  const frequencies = computeActionFrequenciesFromTracePath(
    path.resolve(targetPath)
  );
  process.stdout.write(`${JSON.stringify(frequencies, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
