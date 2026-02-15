import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager } from '../../src/storage';

describe('SnapshotManager', () => {
  let tmpDir: string;
  let snapshotManager: SnapshotManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-manager-test-'));
    snapshotManager = new SnapshotManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('saves and loads documented step folder layout', async () => {
    const runId = 'run_layout';
    await snapshotManager.save(runId, 0, {
      scenario: 'investment',
      personas: [
        {
          name: 'Alice',
          scratch: { id: 1, role: 'investor' },
          memory: { nodes: [{ id: 'n1' }] },
          reputation: {
            current: { Bob: { score: 1 } },
            historical: [{ Bob: { score: 0 } }],
            gossip: [{ source: 'Bob', claim: 'cooperative' }],
          },
        },
        {
          name: 'Bob',
          scratch: { id: 2, role: 'trustee' },
          memory: { nodes: [] },
          reputation: {
            current: {},
            historical: [],
            gossip: [],
          },
        },
      ],
      network: { edges: [{ from: 'Alice', to: 'Bob' }] },
      interactions: [{ pairId: 'Alice-Bob', action: 'invest' }],
      meta: { note: 'initial step' },
    });

    const stepDir = path.join(tmpDir, runId, 'step_0');
    expect(fs.existsSync(path.join(stepDir, 'meta.json'))).toBe(true);
    expect(
      fs.existsSync(path.join(stepDir, 'personas', 'Alice', 'scratch.json'))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(stepDir, 'personas', 'Alice', 'reputation', 'current.json')
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(stepDir, 'network', 'graph.json'))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(stepDir, 'results', 'interactions.json'))
    ).toBe(true);

    const loaded = await snapshotManager.load(runId, 0);

    expect(loaded.step).toBe(0);
    expect(loaded.meta.scenario).toBe('investment');
    expect(loaded.meta.agentCount).toBe(2);
    expect(loaded.meta.note).toBe('initial step');
    expect(loaded.personas.Alice.scratch).toEqual({ id: 1, role: 'investor' });
    expect(loaded.network).toEqual({ edges: [{ from: 'Alice', to: 'Bob' }] });
    expect(loaded.interactions).toEqual([
      { pairId: 'Alice-Bob', action: 'invest' },
    ]);
  });

  test('findLatest returns highest step and load defaults to latest', async () => {
    const runId = 'run_latest';

    await snapshotManager.save(runId, 1, { scenario: 'mspn' });
    await snapshotManager.save(runId, 3, { scenario: 'mspn' });
    await snapshotManager.save(runId, 2, { scenario: 'mspn' });

    expect(await snapshotManager.findLatest(runId)).toBe(3);
    expect(await snapshotManager.findLatestStep(runId)).toBe(3);

    const loaded = await snapshotManager.load(runId);
    expect(loaded.step).toBe(3);
    expect(loaded.meta.step).toBe(3);
  });
});
