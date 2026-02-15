import * as fs from 'fs/promises';
import * as path from 'path';

export interface StepMeta {
  step: number;
  agentCount: number;
  scenario: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface PersonaReputationSnapshot {
  current?: unknown;
  historical?: unknown;
  gossip?: unknown;
  [key: string]: unknown;
}

export interface PersonaSnapshot {
  name: string;
  scratch?: unknown;
  memory?: unknown;
  reputation?: PersonaReputationSnapshot;
  [key: string]: unknown;
}

export interface StepSnapshot {
  scenario?: string;
  personas?: PersonaSnapshot[] | Record<string, PersonaSnapshot>;
  network?: unknown;
  interactions?: unknown;
  results?: {
    interactions?: unknown;
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;
}

export interface LoadedStepSnapshot {
  runId: string;
  step: number;
  meta: StepMeta;
  personas: Record<string, PersonaSnapshot>;
  network: unknown;
  interactions: unknown;
}

export class SnapshotManager {
  constructor(private readonly basePath: string = './sim_storage') {}

  getBasePath(): string {
    return this.basePath;
  }

  async save(
    runId: string,
    step: number,
    snapshot: StepSnapshot
  ): Promise<void> {
    this.validateStep(step);

    const stepDir = this.getStepDir(runId, step);
    const personas = this.normalizePersonas(snapshot.personas);
    const scenario = snapshot.scenario ?? 'unknown';
    const meta: StepMeta = {
      ...(snapshot.meta ?? {}),
      step,
      agentCount: personas.size,
      scenario,
      timestamp: new Date().toISOString(),
    };

    await this.writeJson(path.join(stepDir, 'meta.json'), meta);

    for (const [name, persona] of personas.entries()) {
      const personaDir = path.join(stepDir, 'personas', name);
      await this.writeJson(
        path.join(personaDir, 'scratch.json'),
        persona.scratch ?? {}
      );
      await this.writeJson(
        path.join(personaDir, 'memory.json'),
        persona.memory ?? {}
      );
      await this.writeJson(
        path.join(personaDir, 'reputation', 'current.json'),
        persona.reputation?.current ?? {}
      );
      await this.writeJson(
        path.join(personaDir, 'reputation', 'historical.json'),
        persona.reputation?.historical ?? []
      );
      await this.writeJson(
        path.join(personaDir, 'reputation', 'gossip.json'),
        persona.reputation?.gossip ?? []
      );
    }

    await this.writeJson(
      path.join(stepDir, 'network', 'graph.json'),
      snapshot.network ?? {}
    );

    const interactions =
      snapshot.results?.interactions ?? snapshot.interactions ?? [];
    await this.writeJson(
      path.join(stepDir, 'results', 'interactions.json'),
      interactions
    );
  }

  async saveStep(
    runId: string,
    step: number,
    snapshot: StepSnapshot
  ): Promise<void> {
    await this.save(runId, step, snapshot);
  }

  async load(runId: string, step?: number): Promise<LoadedStepSnapshot> {
    const resolvedStep = await this.resolveStep(runId, step);
    const stepDir = this.getStepDir(runId, resolvedStep);
    const meta = await this.readJson<StepMeta>(path.join(stepDir, 'meta.json'));
    const personas = await this.loadPersonas(stepDir);
    const network = await this.readJsonIfExists(
      path.join(stepDir, 'network', 'graph.json'),
      {}
    );
    const interactions = await this.readJsonIfExists(
      path.join(stepDir, 'results', 'interactions.json'),
      []
    );

    return {
      runId,
      step: resolvedStep,
      meta,
      personas,
      network,
      interactions,
    };
  }

  async loadStep(runId: string, step?: number): Promise<LoadedStepSnapshot> {
    return this.load(runId, step);
  }

  async findLatest(runId: string): Promise<number | null> {
    const runDir = this.getRunDir(runId);
    if (!(await this.pathExists(runDir))) {
      return null;
    }

    const entries = await fs.readdir(runDir, { withFileTypes: true });
    const steps = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => /^step_(\d+)$/.exec(entry.name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a);

    return steps[0] ?? null;
  }

  async findLatestStep(runId: string): Promise<number> {
    const latest = await this.findLatest(runId);
    return latest ?? 0;
  }

  private async resolveStep(runId: string, step?: number): Promise<number> {
    if (step !== undefined) {
      this.validateStep(step);
      return step;
    }

    const latest = await this.findLatest(runId);
    if (latest === null) {
      throw new Error(`No snapshot steps found for run '${runId}'`);
    }

    return latest;
  }

  private normalizePersonas(
    personas: StepSnapshot['personas']
  ): Map<string, PersonaSnapshot> {
    if (!personas) {
      return new Map();
    }

    if (Array.isArray(personas)) {
      const entries = personas
        .filter(
          (persona) =>
            typeof persona.name === 'string' && persona.name.length > 0
        )
        .map((persona) => [persona.name, persona] as const);
      return new Map(entries);
    }

    const mapped = Object.entries(personas)
      .filter(([name]) => typeof name === 'string' && name.length > 0)
      .map(([name, persona]) => [name, { ...persona, name }] as const);
    return new Map(mapped);
  }

  private async loadPersonas(
    stepDir: string
  ): Promise<Record<string, PersonaSnapshot>> {
    const personasDir = path.join(stepDir, 'personas');
    if (!(await this.pathExists(personasDir))) {
      return {};
    }

    const entries = await fs.readdir(personasDir, { withFileTypes: true });
    const personas: Record<string, PersonaSnapshot> = {};

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const name = entry.name;
      const personaDir = path.join(personasDir, name);
      const scratch = await this.readJsonIfExists(
        path.join(personaDir, 'scratch.json'),
        {}
      );
      const memory = await this.readJsonIfExists(
        path.join(personaDir, 'memory.json'),
        {}
      );
      const current = await this.readJsonIfExists(
        path.join(personaDir, 'reputation', 'current.json'),
        {}
      );
      const historical = await this.readJsonIfExists(
        path.join(personaDir, 'reputation', 'historical.json'),
        []
      );
      const gossip = await this.readJsonIfExists(
        path.join(personaDir, 'reputation', 'gossip.json'),
        []
      );

      personas[name] = {
        name,
        scratch,
        memory,
        reputation: {
          current,
          historical,
          gossip,
        },
      };
    }

    return personas;
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });

    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = path.join(
      dirPath,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
    );

    try {
      await fs.writeFile(tempPath, serialized, 'utf-8');
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

  private async readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
    if (!(await this.pathExists(filePath))) {
      return fallback;
    }
    return this.readJson<T>(filePath);
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private getRunDir(runId: string): string {
    return path.join(this.basePath, runId);
  }

  private getStepDir(runId: string, step: number): string {
    return path.join(this.getRunDir(runId), `step_${step}`);
  }

  private validateStep(step: number): void {
    if (!Number.isInteger(step) || step < 0) {
      throw new Error(
        `Step must be a non-negative integer, received '${step}'`
      );
    }
  }
}
