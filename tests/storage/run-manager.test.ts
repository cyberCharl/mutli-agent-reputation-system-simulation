import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RunManager, SnapshotManager } from '../../src/storage';

describe('RunManager', () => {
  let tmpDir: string;
  let snapshotManager: SnapshotManager;
  let runManager: RunManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manager-test-'));
    snapshotManager = new SnapshotManager(tmpDir);
    runManager = new RunManager(snapshotManager);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates run metadata/config and resumes via callbacks', async () => {
    const created = await runManager.createRun({
      runId: 'run_resume',
      scenario: 'investment',
      config: { agentCount: 2, scenario: 'investment' },
      metadata: { author: 'test' },
      createdAt: new Date('2026-02-14T12:30:00.000Z'),
    });

    expect(created.runId).toBe('run_resume');
    expect(created.latestStep).toBeNull();

    await snapshotManager.save('run_resume', 0, {
      scenario: 'investment',
      personas: [{ name: 'Alice', scratch: { step: 0 } }],
      interactions: [],
    });

    const importedSteps: number[] = [];
    const savedSteps: number[] = [];
    const resumeResult = await runManager.resume('run_resume', 2, {
      importState(snapshot) {
        importedSteps.push(snapshot.step);
      },
      runStep(step) {
        return {
          scenario: 'investment',
          personas: [{ name: 'Alice', scratch: { step } }],
          interactions: [{ step }],
        };
      },
      onStepSaved(snapshot) {
        savedSteps.push(snapshot.step);
      },
    });

    expect(importedSteps).toEqual([0]);
    expect(savedSteps).toEqual([1, 2]);
    expect(resumeResult).toEqual({
      runId: 'run_resume',
      startStep: 0,
      endStep: 2,
      stepsExecuted: 2,
    });

    const metadata = await runManager.getRunMetadata('run_resume');
    expect(metadata?.status).toBe('completed');
    expect(metadata?.latestStep).toBe(2);

    const configPath = path.join(tmpDir, 'run_resume', 'config.json');
    const parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsedConfig).toEqual({ agentCount: 2, scenario: 'investment' });
  });

  test('replayDiff returns deterministic diff scaffolding', async () => {
    const runId = 'run_diff';
    await runManager.createRun({ runId, scenario: 'investment' });

    await snapshotManager.save(runId, 0, {
      scenario: 'investment',
      personas: [{ name: 'Alice', scratch: { score: 0 } }],
      network: { edges: [] },
      interactions: [],
    });
    await snapshotManager.save(runId, 1, {
      scenario: 'investment',
      personas: [{ name: 'Alice', scratch: { score: 1 } }],
      network: { edges: [{ from: 'Alice', to: 'Bob' }] },
      interactions: [{ event: 'trade' }],
    });
    await snapshotManager.save(runId, 2, {
      scenario: 'investment',
      personas: [
        { name: 'Alice', scratch: { score: 2 } },
        { name: 'Bob', scratch: { score: 1 } },
      ],
      network: { edges: [{ from: 'Alice', to: 'Bob' }] },
      interactions: [{ event: 'trade' }],
    });

    const diffs = await runManager.replayDiff(runId, 0, 2);

    expect(diffs).toHaveLength(2);
    expect(diffs[0].fromStep).toBe(0);
    expect(diffs[0].toStep).toBe(1);
    expect(diffs[0].personasChanged).toContain('Alice');
    expect(diffs[0].networkChanged).toBe(true);
    expect(diffs[0].interactionCountDelta).toBe(1);

    expect(diffs[1].fromStep).toBe(1);
    expect(diffs[1].toStep).toBe(2);
    expect(diffs[1].personasAdded).toEqual(['Bob']);
    expect(diffs[1].networkChanged).toBe(false);
    expect(diffs[1].interactionsChanged).toBe(false);
  });
});
