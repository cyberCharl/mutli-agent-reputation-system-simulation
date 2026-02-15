import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateDashboard } from '../src/visualize';
import {
  EpisodeResult,
  ProtocolLevel,
  TrueState,
  ReviewAction,
} from '../src/types';

function makeEpisode(
  id: number,
  overrides?: Partial<EpisodeResult>
): EpisodeResult {
  return {
    episodeId: id,
    trueState: TrueState.SafeLow,
    finalProtocol: ProtocolLevel.High,
    payoffs: { a: 10, b: 10 },
    history: [],
    agentBeliefs: {
      a: {
        own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
        aboutOpponent: {
          [TrueState.SafeLow]: 0.5,
          [TrueState.DangerousLow]: 0.5,
        },
      },
      b: {
        own: { [TrueState.SafeLow]: 0.5, [TrueState.DangerousLow]: 0.5 },
        aboutOpponent: {
          [TrueState.SafeLow]: 0.5,
          [TrueState.DangerousLow]: 0.5,
        },
      },
    },
    reviewAction: ReviewAction.Accept,
    roundCount: 1,
    converged: true,
    ...overrides,
  };
}

describe('generateDashboard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-test-'));

    // Create run directory structure
    const baselineDir = path.join(tmpDir, 'baseline');
    const reputationDir = path.join(tmpDir, 'reputation');
    fs.mkdirSync(baselineDir);
    fs.mkdirSync(reputationDir);

    const baselineEps = [
      makeEpisode(0),
      makeEpisode(1, {
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: 12, b: 8 },
      }),
      makeEpisode(2, {
        reviewAction: ReviewAction.Reject,
        payoffs: { a: 2, b: 2 },
      }),
    ];

    const reputationEps = [
      makeEpisode(0, { reputationDeltas: { a: 3, b: 3 } }),
      makeEpisode(1, {
        reputationDeltas: { a: -20, b: -15 },
        finalProtocol: ProtocolLevel.Low,
        payoffs: { a: -5, b: -5 },
      }),
      makeEpisode(2, { reputationDeltas: { a: 5, b: 2 } }),
    ];

    fs.writeFileSync(
      path.join(baselineDir, 'episodes.json'),
      JSON.stringify(baselineEps)
    );
    fs.writeFileSync(
      path.join(reputationDir, 'episodes.json'),
      JSON.stringify(reputationEps)
    );

    const summary = {
      parameters: { numEpisodes: 3, seed: 'test' },
      baseline: {
        coopRate: 66.67,
        breachRate: 0,
        avgPayoffA: 8,
        avgPayoffB: 6.67,
      },
      withReputation: {
        coopRate: 66.67,
        breachRate: 33.33,
        avgPayoffA: 2.67,
        avgPayoffB: 0,
      },
      significance: {
        payoffA: {
          tStatistic: -1.5,
          pValue: 0.15,
          significant: false,
          meanDifference: -5.33,
        },
        payoffB: {
          tStatistic: -2.1,
          pValue: 0.04,
          significant: true,
          meanDifference: -6.67,
        },
        baselineCI: { mean: 14.67, lower: 10, upper: 20 },
        treatmentCI: { mean: 2.67, lower: -5, upper: 10 },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, 'summary.json'),
      JSON.stringify(summary)
    );
  });

  function writeSnapshotFixtures(rootDir: string): void {
    const step0 = path.join(rootDir, 'step_0');
    const step1 = path.join(rootDir, 'step_1');

    fs.mkdirSync(path.join(step0, 'network'), { recursive: true });
    fs.mkdirSync(path.join(step1, 'network'), { recursive: true });
    fs.mkdirSync(path.join(step0, 'personas', 'Alice', 'reputation'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(step0, 'personas', 'Bob', 'reputation'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(step1, 'personas', 'Alice', 'reputation'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(step1, 'personas', 'Bob', 'reputation'), {
      recursive: true,
    });

    fs.writeFileSync(
      path.join(step0, 'network', 'graph.json'),
      JSON.stringify({
        edges: [
          { from: 'Alice', to: 'Bob', role: 'investor', createdAt: 0 },
          { from: 'Bob', to: 'Alice', role: 'trustee', createdAt: 0 },
        ],
      })
    );
    fs.writeFileSync(
      path.join(step1, 'network', 'graph.json'),
      JSON.stringify({
        edges: [
          { from: 'Alice', to: 'Bob', role: 'investor', createdAt: 1 },
          { from: 'Bob', to: 'Alice', role: 'trustee', createdAt: 1 },
          { from: 'Alice', to: 'Carol', role: 'investor', createdAt: 1 },
        ],
      })
    );

    const repStep0 = {
      entry: {
        numericalRecord: {
          investmentFailures: 1,
          trusteeFailures: 0,
          returnIssues: 1,
          returnSuccesses: 0,
          investorSuccesses: 0,
        },
      },
    };
    const repStep1 = {
      entry: {
        numericalRecord: {
          investmentFailures: 1,
          trusteeFailures: 0,
          returnIssues: 2,
          returnSuccesses: 1,
          investorSuccesses: 1,
        },
      },
    };

    fs.writeFileSync(
      path.join(step0, 'personas', 'Alice', 'reputation', 'current.json'),
      JSON.stringify(repStep0)
    );
    fs.writeFileSync(
      path.join(step1, 'personas', 'Alice', 'reputation', 'current.json'),
      JSON.stringify(repStep1)
    );
    fs.writeFileSync(
      path.join(step0, 'personas', 'Bob', 'reputation', 'current.json'),
      JSON.stringify(repStep0)
    );
    fs.writeFileSync(
      path.join(step1, 'personas', 'Bob', 'reputation', 'current.json'),
      JSON.stringify(repStep1)
    );

    fs.writeFileSync(
      path.join(step0, 'personas', 'Alice', 'reputation', 'gossip.json'),
      JSON.stringify([])
    );
    fs.writeFileSync(
      path.join(step0, 'personas', 'Bob', 'reputation', 'gossip.json'),
      JSON.stringify([])
    );
    fs.writeFileSync(
      path.join(step1, 'personas', 'Alice', 'reputation', 'gossip.json'),
      JSON.stringify([
        {
          complainedName: 'Bob',
          complainedId: 2,
          complainedRole: 'trustee',
          gossiperName: 'Alice',
          gossiperRole: 'investor',
          gossipInfo: 'Bob under-returned funds',
          credibilityLevel: 'credible',
          shouldSpread: true,
          reasons: 'Observed behavior',
          createdAtStep: 1,
          sourceChain: ['Alice'],
        },
      ])
    );
    fs.writeFileSync(
      path.join(step1, 'personas', 'Bob', 'reputation', 'gossip.json'),
      JSON.stringify([
        {
          complainedName: 'Bob',
          complainedId: 2,
          complainedRole: 'trustee',
          gossiperName: 'Carol',
          gossiperRole: 'player',
          gossipInfo: 'Bob under-returned funds',
          credibilityLevel: 'uncredible',
          shouldSpread: false,
          reasons: 'Hearsay',
          createdAtStep: 2,
          sourceChain: ['Alice', 'Carol'],
        },
      ])
    );
  }

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('should generate HTML dashboard file', () => {
    const outFile = generateDashboard(tmpDir);
    expect(fs.existsSync(outFile)).toBe(true);
    expect(outFile).toMatch(/dashboard\.html$/);
  });

  test('should include Chart.js script tag', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('chart.js');
    expect(html).toContain('chart.umd.min.js');
  });

  test('should include karma chart', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('karmaChart');
    expect(html).toContain('Karma Over Time');
  });

  test('should include payoff distribution chart', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('payoffChart');
    expect(html).toContain('Payoff Distribution');
  });

  test('should include action frequencies chart', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('actionChart');
    expect(html).toContain('Action Frequencies');
  });

  test('should include statistical significance table', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('Significant');
    expect(html).toContain('p-value');
  });

  test('should include metrics cards', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('66.67%');
    expect(html).toContain('Coop Rate');
    expect(html).toContain('Breach Rate');
  });

  test('should support custom output path', () => {
    const customPath = path.join(tmpDir, 'custom_output.html');
    const outFile = generateDashboard(tmpDir, customPath);
    expect(outFile).toBe(customPath);
    expect(fs.existsSync(customPath)).toBe(true);
  });

  test('should throw if summary.json is missing', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viz-empty-'));
    expect(() => generateDashboard(emptyDir)).toThrow('summary.json not found');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  test('should handle missing episodes directory gracefully', () => {
    // Remove episodes files
    fs.rmSync(path.join(tmpDir, 'baseline'), { recursive: true });
    fs.rmSync(path.join(tmpDir, 'reputation'), { recursive: true });

    const outFile = generateDashboard(tmpDir);
    expect(fs.existsSync(outFile)).toBe(true);
  });

  test('should generate valid HTML document', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<canvas');
  });

  test('should render optional network, reputation, and gossip sections from snapshots', () => {
    writeSnapshotFixtures(tmpDir);
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');

    expect(html).toContain('Network Graph (Latest Snapshot)');
    expect(html).toContain('networkGraphCanvas');
    expect(html).toContain('Reputation Evolution');
    expect(html).toContain('reputationEvolutionChart');
    expect(html).toContain('Gossip Propagation');
    expect(html).toContain('gossipTimelineChart');
    expect(html).toContain('Total gossip entries');
  });

  test('should keep legacy rendering when snapshot data is absent', () => {
    const outFile = generateDashboard(tmpDir);
    const html = fs.readFileSync(outFile, 'utf-8');

    expect(html).not.toContain('Network Graph (Latest Snapshot)');
    expect(html).not.toContain('Reputation Evolution');
    expect(html).not.toContain('Gossip Propagation');
    expect(html).toContain('Karma Over Time');
    expect(html).toContain('Action Frequencies');
  });
});
