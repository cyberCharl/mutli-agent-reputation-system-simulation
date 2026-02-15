import * as fs from 'fs/promises';
import * as path from 'path';
import { LoadedStepSnapshot, SnapshotManager, StepSnapshot } from './snapshot';

export interface RunMetadata {
  runId: string;
  createdAt: string;
  updatedAt: string;
  latestStep: number | null;
  scenario?: string;
  status: 'created' | 'running' | 'completed';
  metadata: Record<string, unknown>;
}

export interface CreateRunOptions {
  runId?: string;
  scenario?: string;
  config?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface ResumeCallbacks<
  TSnapshot extends StepSnapshot = StepSnapshot,
> {
  importState(snapshot: LoadedStepSnapshot): Promise<void> | void;
  runStep(step: number): Promise<TSnapshot> | TSnapshot;
  onStepSaved?(snapshot: LoadedStepSnapshot): Promise<void> | void;
}

export interface ResumeResult {
  runId: string;
  startStep: number;
  endStep: number;
  stepsExecuted: number;
}

export interface ReplayDiff {
  fromStep: number;
  toStep: number;
  changedMetaKeys: string[];
  personasAdded: string[];
  personasRemoved: string[];
  personasChanged: string[];
  networkChanged: boolean;
  interactionsChanged: boolean;
  interactionCountBefore: number | null;
  interactionCountAfter: number | null;
  interactionCountDelta: number | null;
}

export class RunManager {
  private readonly runMetaFilename = 'run.json';
  private readonly runConfigFilename = 'config.json';

  constructor(private readonly snapshotManager: SnapshotManager) {}

  async createRun(options: CreateRunOptions = {}): Promise<RunMetadata> {
    const now = options.createdAt ?? new Date();
    const runId = options.runId ?? this.generateRunId(now);
    const runDir = this.getRunDir(runId);

    await this.ensureDirectory(runDir);

    const metadata: RunMetadata = {
      runId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      latestStep: null,
      scenario: options.scenario,
      status: 'created',
      metadata: options.metadata ?? {},
    };

    await this.writeJson(
      path.join(runDir, this.runConfigFilename),
      options.config ?? {}
    );
    await this.writeJson(path.join(runDir, this.runMetaFilename), metadata);

    return metadata;
  }

  async getRunMetadata(runId: string): Promise<RunMetadata | null> {
    const runMetaPath = path.join(this.getRunDir(runId), this.runMetaFilename);
    if (!(await this.pathExists(runMetaPath))) {
      return null;
    }
    return this.readJson<RunMetadata>(runMetaPath);
  }

  async resume<TSnapshot extends StepSnapshot = StepSnapshot>(
    runId: string,
    additionalSteps: number,
    callbacks: ResumeCallbacks<TSnapshot>
  ): Promise<ResumeResult> {
    if (!Number.isInteger(additionalSteps) || additionalSteps < 0) {
      throw new Error(
        `additionalSteps must be a non-negative integer, received '${additionalSteps}'`
      );
    }

    const latestSnapshot = await this.snapshotManager.load(runId);
    await callbacks.importState(latestSnapshot);

    await this.updateRunMetadata(runId, {
      status: 'running',
      latestStep: latestSnapshot.step,
      updatedAt: new Date().toISOString(),
    });

    let endStep = latestSnapshot.step;
    for (let i = 1; i <= additionalSteps; i++) {
      const step = latestSnapshot.step + i;
      const state = await callbacks.runStep(step);
      await this.snapshotManager.save(runId, step, state);
      const savedStep = await this.snapshotManager.load(runId, step);
      if (callbacks.onStepSaved) {
        await callbacks.onStepSaved(savedStep);
      }
      endStep = step;
    }

    await this.updateRunMetadata(runId, {
      status: 'completed',
      latestStep: endStep,
      updatedAt: new Date().toISOString(),
    });

    return {
      runId,
      startStep: latestSnapshot.step,
      endStep,
      stepsExecuted: additionalSteps,
    };
  }

  async replayDiff(
    runId: string,
    fromStep: number,
    toStep: number
  ): Promise<ReplayDiff[]> {
    this.validateStepRange(fromStep, toStep);

    const diffs: ReplayDiff[] = [];
    for (let step = fromStep; step < toStep; step++) {
      const before = await this.snapshotManager.load(runId, step);
      const after = await this.snapshotManager.load(runId, step + 1);
      diffs.push(this.computeDiff(before, after));
    }

    return diffs;
  }

  computeDiff(
    before: LoadedStepSnapshot,
    after: LoadedStepSnapshot
  ): ReplayDiff {
    const beforeNames = Object.keys(before.personas);
    const afterNames = Object.keys(after.personas);
    const beforeSet = new Set(beforeNames);
    const afterSet = new Set(afterNames);

    const personasAdded = afterNames.filter((name) => !beforeSet.has(name));
    const personasRemoved = beforeNames.filter((name) => !afterSet.has(name));
    const personasChanged = beforeNames
      .filter((name) => afterSet.has(name))
      .filter(
        (name) => !this.deepEqual(before.personas[name], after.personas[name])
      );

    const changedMetaKeys = Array.from(
      new Set([...Object.keys(before.meta), ...Object.keys(after.meta)])
    ).filter((key) => !this.deepEqual(before.meta[key], after.meta[key]));

    const interactionCountBefore = Array.isArray(before.interactions)
      ? before.interactions.length
      : null;
    const interactionCountAfter = Array.isArray(after.interactions)
      ? after.interactions.length
      : null;

    return {
      fromStep: before.step,
      toStep: after.step,
      changedMetaKeys,
      personasAdded,
      personasRemoved,
      personasChanged,
      networkChanged: !this.deepEqual(before.network, after.network),
      interactionsChanged: !this.deepEqual(
        before.interactions,
        after.interactions
      ),
      interactionCountBefore,
      interactionCountAfter,
      interactionCountDelta:
        interactionCountBefore === null || interactionCountAfter === null
          ? null
          : interactionCountAfter - interactionCountBefore,
    };
  }

  private async updateRunMetadata(
    runId: string,
    patch: Partial<RunMetadata>
  ): Promise<void> {
    const current = (await this.getRunMetadata(runId)) ?? {
      runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestStep: null,
      status: 'created' as const,
      metadata: {},
    };

    const merged: RunMetadata = {
      ...current,
      ...patch,
      runId: current.runId,
      metadata: {
        ...current.metadata,
        ...(patch.metadata ?? {}),
      },
    };

    await this.writeJson(
      path.join(this.getRunDir(runId), this.runMetaFilename),
      merged
    );
  }

  private validateStepRange(fromStep: number, toStep: number): void {
    if (!Number.isInteger(fromStep) || fromStep < 0) {
      throw new Error(
        `fromStep must be a non-negative integer, received '${fromStep}'`
      );
    }
    if (!Number.isInteger(toStep) || toStep < 0) {
      throw new Error(
        `toStep must be a non-negative integer, received '${toStep}'`
      );
    }
    if (toStep < fromStep) {
      throw new Error(
        `toStep (${toStep}) must be greater than or equal to fromStep (${fromStep})`
      );
    }
  }

  private generateRunId(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    const second = `${date.getSeconds()}`.padStart(2, '0');
    return `run_${year}-${month}-${day}_${hour}-${minute}-${second}`;
  }

  private getRunDir(runId: string): string {
    return path.join(this.snapshotManager.getBasePath(), runId);
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.writeFile(tempPath, payload, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  private async readJson<T>(filePath: string): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON at '${filePath}': ${error.message}`);
      }
      throw error;
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return this.stableSerialize(a) === this.stableSerialize(b);
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.sortObject(value));
  }

  private sortObject(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sortObject(entry));
    }
    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const sortedKeys = Object.keys(source).sort();
      const result: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        result[key] = this.sortObject(source[key]);
      }
      return result;
    }
    return value;
  }
}
