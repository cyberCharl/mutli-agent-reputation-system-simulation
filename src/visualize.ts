import * as fs from 'fs';
import * as path from 'path';
import { EpisodeResult, NumericalRecord } from './types';

interface RunData {
  parameters: { numEpisodes: number; seed: string };
  baseline: {
    coopRate: number;
    breachRate: number;
    avgPayoffA: number;
    avgPayoffB: number;
  };
  withReputation: {
    coopRate: number;
    breachRate: number;
    avgPayoffA: number;
    avgPayoffB: number;
  };
  significance?: {
    payoffA: {
      tStatistic: number;
      pValue: number;
      significant: boolean;
      meanDifference: number;
    };
    payoffB: {
      tStatistic: number;
      pValue: number;
      significant: boolean;
      meanDifference: number;
    };
    baselineCI: { mean: number; lower: number; upper: number };
    treatmentCI: { mean: number; lower: number; upper: number };
  } | null;
}

interface ChartData {
  karmaOverTime: { episode: number; karmaA: number; karmaB: number }[];
  payoffDistBaseline: number[];
  payoffDistReputation: number[];
  actionFreqBaseline: Record<string, number>;
  actionFreqReputation: Record<string, number>;
  metricsComparison: RunData;
  networkGraph: NetworkGraphData | null;
  reputationEvolution: ReputationEvolutionData | null;
  gossipCascade: GossipCascadeData | null;
}

interface SnapshotStepData {
  step: number;
  personas: Record<string, PersonaSnapshotData>;
  network: unknown;
}

interface PersonaSnapshotData {
  currentReputation: unknown;
  gossip: unknown;
}

interface NetworkGraphData {
  nodes: Array<{ id: string; reputationScore: number; color: string }>;
  edges: Array<{ from: string; to: string; role?: string }>;
}

interface ReputationEvolutionData {
  subjectLabel: string;
  steps: number[];
  series: {
    investmentFailures: number[];
    trusteeFailures: number[];
    returnIssues: number[];
    returnSuccesses: number[];
    investorSuccesses: number[];
  };
}

interface GossipCascadeData {
  perStep: Array<{ step: number; count: number; cumulative: number }>;
  topLinks: Array<{ from: string; to: string; count: number }>;
  totalEntries: number;
}

export function generateDashboard(runDir: string, outputPath?: string): string {
  const summaryPath = path.join(runDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`summary.json not found in ${runDir}`);
  }

  const summary: RunData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

  // Load episode data
  const baselineEpisodes = loadEpisodes(path.join(runDir, 'baseline'));
  const reputationEpisodes = loadEpisodes(path.join(runDir, 'reputation'));

  // Build chart data
  const chartData = buildChartData(
    summary,
    baselineEpisodes,
    reputationEpisodes,
    loadSnapshotSteps(runDir)
  );

  const html = renderHTML(chartData);
  const outFile = outputPath || path.join(runDir, 'dashboard.html');
  fs.writeFileSync(outFile, html, 'utf-8');

  return outFile;
}

function loadEpisodes(dir: string): EpisodeResult[] {
  const episodesFile = path.join(dir, 'episodes.json');
  if (!fs.existsSync(episodesFile)) return [];
  return JSON.parse(fs.readFileSync(episodesFile, 'utf-8'));
}

function buildChartData(
  summary: RunData,
  baselineEpisodes: EpisodeResult[],
  reputationEpisodes: EpisodeResult[],
  snapshots: SnapshotStepData[]
): ChartData {
  // Karma over time (cumulative from reputation deltas)
  let karmaA = 50;
  let karmaB = 50;
  const karmaOverTime = reputationEpisodes.map((ep) => {
    if (ep.reputationDeltas) {
      karmaA = Math.max(0, Math.min(100, karmaA + ep.reputationDeltas.a));
      karmaB = Math.max(0, Math.min(100, karmaB + ep.reputationDeltas.b));
    }
    return { episode: ep.episodeId, karmaA, karmaB };
  });

  // Payoff distributions (total payoff per episode)
  const payoffDistBaseline = baselineEpisodes.map(
    (ep) => ep.payoffs.a + ep.payoffs.b
  );
  const payoffDistReputation = reputationEpisodes.map(
    (ep) => ep.payoffs.a + ep.payoffs.b
  );

  // Action frequencies
  const actionFreqBaseline = countActions(baselineEpisodes);
  const actionFreqReputation = countActions(reputationEpisodes);

  const networkGraph = buildNetworkGraphData(snapshots);
  const reputationEvolution = buildReputationEvolutionData(snapshots);
  const gossipCascade = buildGossipCascadeData(snapshots);

  return {
    karmaOverTime,
    payoffDistBaseline,
    payoffDistReputation,
    actionFreqBaseline,
    actionFreqReputation,
    metricsComparison: summary,
    networkGraph,
    reputationEvolution,
    gossipCascade,
  };
}

function loadSnapshotSteps(runDir: string): SnapshotStepData[] {
  if (!fs.existsSync(runDir)) {
    return [];
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(runDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const steps = entries
    .filter((entry) => entry.isDirectory() && /^step_\d+$/.test(entry.name))
    .map((entry) => {
      const match = /^step_(\d+)$/.exec(entry.name);
      return match ? Number.parseInt(match[1], 10) : null;
    })
    .filter((value): value is number => Number.isInteger(value))
    .sort((a, b) => a - b);

  return steps
    .map((step) => loadSingleStep(runDir, step))
    .filter((stepData): stepData is SnapshotStepData => stepData !== null);
}

function loadSingleStep(runDir: string, step: number): SnapshotStepData | null {
  const stepDir = path.join(runDir, `step_${step}`);
  try {
    const network = readJsonIfExists(
      path.join(stepDir, 'network', 'graph.json'),
      {}
    );
    const personasDir = path.join(stepDir, 'personas');
    const personas: Record<string, PersonaSnapshotData> = {};

    if (fs.existsSync(personasDir)) {
      const personaEntries = fs
        .readdirSync(personasDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory());

      for (const personaEntry of personaEntries) {
        const personaName = personaEntry.name;
        const repDir = path.join(personasDir, personaName, 'reputation');
        personas[personaName] = {
          currentReputation: readJsonIfExists(
            path.join(repDir, 'current.json'),
            {}
          ),
          gossip: readJsonIfExists(path.join(repDir, 'gossip.json'), []),
        };
      }
    }

    return {
      step,
      personas,
      network,
    };
  } catch {
    return null;
  }
}

function readJsonIfExists<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function buildNetworkGraphData(
  steps: SnapshotStepData[]
): NetworkGraphData | null {
  if (steps.length === 0) {
    return null;
  }

  const latest = steps[steps.length - 1];
  const edges = extractNetworkEdges(latest.network);
  const nodeIds = new Set<string>();

  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }
  for (const personaName of Object.keys(latest.personas)) {
    nodeIds.add(personaName);
  }

  if (nodeIds.size === 0) {
    return null;
  }

  const nodes = Array.from(nodeIds)
    .sort()
    .map((id) => {
      const personaData = latest.personas[id];
      const score = personaData
        ? aggregateReputationScore(personaData.currentReputation)
        : 0;
      return {
        id,
        reputationScore: score,
        color: scoreToColor(score),
      };
    });

  return { nodes, edges };
}

function extractNetworkEdges(networkData: unknown): Array<{
  from: string;
  to: string;
  role?: string;
}> {
  const edgesRaw = asRecord(networkData)?.edges;
  if (!Array.isArray(edgesRaw)) {
    return [];
  }

  return edgesRaw
    .map((edge): { from: string; to: string; role?: string } | null => {
      const value = asRecord(edge);
      const from = value?.from;
      const to = value?.to;
      const role = value?.role;
      if (typeof from !== 'string' || typeof to !== 'string') {
        return null;
      }
      return { from, to, role: typeof role === 'string' ? role : undefined };
    })
    .filter(
      (edge): edge is { from: string; to: string; role?: string } =>
        edge !== null
    );
}

function buildReputationEvolutionData(
  steps: SnapshotStepData[]
): ReputationEvolutionData | null {
  if (steps.length === 0) {
    return null;
  }

  const personaNames = new Set<string>();
  for (const step of steps) {
    for (const name of Object.keys(step.personas)) {
      personaNames.add(name);
    }
  }

  if (personaNames.size === 0) {
    return null;
  }

  const candidates = Array.from(personaNames)
    .map((name) => {
      const nonZero = steps.filter((step) => {
        const summary = summarizeNumericalRecord(
          step.personas[name]?.currentReputation
        );
        return summary !== null && totalRecordMagnitude(summary) > 0;
      }).length;
      return { name, nonZero };
    })
    .sort((a, b) => b.nonZero - a.nonZero || a.name.localeCompare(b.name));

  const selected = candidates[0];
  const useAggregateFallback = selected.nonZero === 0;

  const series = {
    investmentFailures: [] as number[],
    trusteeFailures: [] as number[],
    returnIssues: [] as number[],
    returnSuccesses: [] as number[],
    investorSuccesses: [] as number[],
  };

  for (const step of steps) {
    const record = useAggregateFallback
      ? summarizeAllPersonas(step.personas)
      : (summarizeNumericalRecord(
          step.personas[selected.name]?.currentReputation
        ) ?? emptyRecord());
    series.investmentFailures.push(record.investmentFailures);
    series.trusteeFailures.push(record.trusteeFailures);
    series.returnIssues.push(record.returnIssues);
    series.returnSuccesses.push(record.returnSuccesses);
    series.investorSuccesses.push(record.investorSuccesses);
  }

  return {
    subjectLabel: useAggregateFallback
      ? 'Aggregate across all agents'
      : `Agent ${selected.name}`,
    steps: steps.map((step) => step.step),
    series,
  };
}

function buildGossipCascadeData(
  steps: SnapshotStepData[]
): GossipCascadeData | null {
  const entryMap = new Map<string, { step: number; sourceChain: string[] }>();

  for (const step of steps) {
    for (const persona of Object.values(step.personas)) {
      const entries = extractGossipEntries(persona.gossip);
      for (const entry of entries) {
        const key = [
          entry.createdAtStep,
          entry.gossiperName,
          entry.complainedName,
          entry.gossipInfo,
          entry.sourceChain.join('>'),
        ].join('|');
        if (!entryMap.has(key)) {
          entryMap.set(key, {
            step: entry.createdAtStep,
            sourceChain: entry.sourceChain,
          });
        }
      }
    }
  }

  const entries = Array.from(entryMap.values()).sort((a, b) => a.step - b.step);
  if (entries.length === 0) {
    return null;
  }

  const perStepCount = new Map<number, number>();
  for (const entry of entries) {
    perStepCount.set(entry.step, (perStepCount.get(entry.step) ?? 0) + 1);
  }

  const sortedSteps = Array.from(perStepCount.keys()).sort((a, b) => a - b);
  let cumulative = 0;
  const perStep = sortedSteps.map((step) => {
    const count = perStepCount.get(step) ?? 0;
    cumulative += count;
    return { step, count, cumulative };
  });

  const links = new Map<string, number>();
  for (const entry of entries) {
    for (let i = 0; i + 1 < entry.sourceChain.length; i += 1) {
      const from = entry.sourceChain[i];
      const to = entry.sourceChain[i + 1];
      const key = `${from}->${to}`;
      links.set(key, (links.get(key) ?? 0) + 1);
    }
  }

  const topLinks = Array.from(links.entries())
    .map(([key, count]) => {
      const parts = key.split('->');
      return { from: parts[0], to: parts[1], count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))
    .slice(0, 10);

  return {
    perStep,
    topLinks,
    totalEntries: entries.length,
  };
}

function summarizeAllPersonas(
  personas: Record<string, PersonaSnapshotData>
): NumericalRecord {
  return Object.values(personas).reduce<NumericalRecord>((acc, persona) => {
    const value = summarizeNumericalRecord(persona.currentReputation);
    if (!value) {
      return acc;
    }
    acc.investmentFailures += value.investmentFailures;
    acc.trusteeFailures += value.trusteeFailures;
    acc.returnIssues += value.returnIssues;
    acc.returnSuccesses += value.returnSuccesses;
    acc.investorSuccesses += value.investorSuccesses;
    return acc;
  }, emptyRecord());
}

function summarizeNumericalRecord(data: unknown): NumericalRecord | null {
  const entries = extractReputationEntries(data);
  if (entries.length === 0) {
    return null;
  }

  return entries.reduce<NumericalRecord>((acc, entry) => {
    const record = entry.numericalRecord;
    acc.investmentFailures += record.investmentFailures;
    acc.trusteeFailures += record.trusteeFailures;
    acc.returnIssues += record.returnIssues;
    acc.returnSuccesses += record.returnSuccesses;
    acc.investorSuccesses += record.investorSuccesses;
    return acc;
  }, emptyRecord());
}

function aggregateReputationScore(data: unknown): number {
  const record = summarizeNumericalRecord(data);
  if (!record) {
    return 0;
  }

  const positive = record.investorSuccesses + record.returnSuccesses;
  const negative =
    record.investmentFailures + record.trusteeFailures + record.returnIssues;
  const denom = Math.max(1, positive + negative);
  const raw = (positive - negative) / denom;
  return Math.max(-1, Math.min(1, raw));
}

function extractReputationEntries(
  data: unknown
): Array<{ numericalRecord: NumericalRecord }> {
  const found: Array<{ numericalRecord: NumericalRecord }> = [];
  collectReputationEntries(data, found, 0);
  return found;
}

function collectReputationEntries(
  data: unknown,
  output: Array<{ numericalRecord: NumericalRecord }>,
  depth: number
): void {
  if (depth > 3) {
    return;
  }

  if (Array.isArray(data)) {
    for (const value of data) {
      collectReputationEntries(value, output, depth + 1);
    }
    return;
  }

  const record = asRecord(data);
  if (!record) {
    return;
  }

  const maybeNumerical = toNumericalRecord(record.numericalRecord);
  if (maybeNumerical) {
    output.push({ numericalRecord: maybeNumerical });
    return;
  }

  for (const value of Object.values(record)) {
    collectReputationEntries(value, output, depth + 1);
  }
}

function extractGossipEntries(data: unknown): Array<{
  createdAtStep: number;
  gossiperName: string;
  complainedName: string;
  gossipInfo: string;
  sourceChain: string[];
}> {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((entry) => {
      const value = asRecord(entry);
      const createdAtStep = value?.createdAtStep;
      const gossiperName = value?.gossiperName;
      const complainedName = value?.complainedName;
      const gossipInfo = value?.gossipInfo;
      const sourceChainRaw = value?.sourceChain;
      if (
        typeof createdAtStep !== 'number' ||
        typeof gossiperName !== 'string' ||
        typeof complainedName !== 'string' ||
        typeof gossipInfo !== 'string' ||
        !Array.isArray(sourceChainRaw)
      ) {
        return null;
      }

      const sourceChain = sourceChainRaw.filter(
        (part): part is string => typeof part === 'string' && part.length > 0
      );
      if (sourceChain.length === 0) {
        sourceChain.push(gossiperName);
      }

      return {
        createdAtStep,
        gossiperName,
        complainedName,
        gossipInfo,
        sourceChain,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        createdAtStep: number;
        gossiperName: string;
        complainedName: string;
        gossipInfo: string;
        sourceChain: string[];
      } => entry !== null
    );
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, any>;
}

function toNumericalRecord(value: unknown): NumericalRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const parsed: NumericalRecord = {
    investmentFailures: toFiniteNumber(record.investmentFailures),
    trusteeFailures: toFiniteNumber(record.trusteeFailures),
    returnIssues: toFiniteNumber(record.returnIssues),
    returnSuccesses: toFiniteNumber(record.returnSuccesses),
    investorSuccesses: toFiniteNumber(record.investorSuccesses),
  };
  return parsed;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function emptyRecord(): NumericalRecord {
  return {
    investmentFailures: 0,
    trusteeFailures: 0,
    returnIssues: 0,
    returnSuccesses: 0,
    investorSuccesses: 0,
  };
}

function totalRecordMagnitude(record: NumericalRecord): number {
  return (
    record.investmentFailures +
    record.trusteeFailures +
    record.returnIssues +
    record.returnSuccesses +
    record.investorSuccesses
  );
}

function scoreToColor(score: number): string {
  const clamped = Math.max(-1, Math.min(1, score));
  if (clamped >= 0.6) {
    return '#22c55e';
  }
  if (clamped >= 0.2) {
    return '#84cc16';
  }
  if (clamped > -0.2) {
    return '#f59e0b';
  }
  if (clamped > -0.6) {
    return '#f97316';
  }
  return '#ef4444';
}

function countActions(episodes: EpisodeResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ep of episodes) {
    if (ep.finalProtocol) {
      counts[ep.finalProtocol] = (counts[ep.finalProtocol] || 0) + 1;
    }
    if (ep.reviewAction) {
      counts[ep.reviewAction] = (counts[ep.reviewAction] || 0) + 1;
    }
  }
  return counts;
}

function renderHTML(data: ChartData): string {
  const { metricsComparison: mc } = data;
  const sig = mc.significance;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MSPN Simulation Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; color: #f8fafc; }
    h2 { font-size: 1.15rem; margin-bottom: 0.75rem; color: #94a3b8; font-weight: 500; }
    .subtitle { color: #64748b; margin-bottom: 2rem; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
    .card-full { grid-column: 1 / -1; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
    .metric { background: #1e293b; border-radius: 10px; padding: 1.25rem; text-align: center; border: 1px solid #334155; }
    .metric-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-value { font-size: 1.75rem; font-weight: 700; margin: 0.25rem 0; }
    .metric-sub { font-size: 0.8rem; color: #94a3b8; }
    .baseline { color: #60a5fa; }
    .treatment { color: #34d399; }
    .sig-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .sig-yes { background: #166534; color: #86efac; }
    .sig-no { background: #3f3f46; color: #a1a1aa; }
    canvas { max-height: 350px; }
    .sig-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .sig-table th, .sig-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #334155; }
    .sig-table th { color: #64748b; font-weight: 500; }
    .hint { color:#64748b; font-size:0.85rem; margin-top:0.6rem; }
    .cascade-list { list-style: none; margin-top: 0.75rem; padding-left: 0; }
    .cascade-list li { padding: 0.35rem 0; border-bottom: 1px solid #334155; color: #94a3b8; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>MSPN Simulation Dashboard</h1>
  <p class="subtitle">${mc.parameters.numEpisodes} episodes per condition &middot; seed: ${mc.parameters.seed}</p>

  <div class="metrics">
    <div class="metric">
      <div class="metric-label">Coop Rate (Baseline)</div>
      <div class="metric-value baseline">${mc.baseline.coopRate}%</div>
    </div>
    <div class="metric">
      <div class="metric-label">Coop Rate (Treatment)</div>
      <div class="metric-value treatment">${mc.withReputation.coopRate}%</div>
    </div>
    <div class="metric">
      <div class="metric-label">Breach Rate (Baseline)</div>
      <div class="metric-value baseline">${mc.baseline.breachRate}%</div>
    </div>
    <div class="metric">
      <div class="metric-label">Breach Rate (Treatment)</div>
      <div class="metric-value treatment">${mc.withReputation.breachRate}%</div>
    </div>
  </div>

  <div class="grid">
    <div class="card card-full">
      <h2>Karma Over Time</h2>
      <canvas id="karmaChart"></canvas>
    </div>
    <div class="card">
      <h2>Payoff Distribution</h2>
      <canvas id="payoffChart"></canvas>
    </div>
    <div class="card">
      <h2>Action Frequencies</h2>
      <canvas id="actionChart"></canvas>
    </div>
    <div class="card">
      <h2>Avg Payoff Comparison</h2>
      <canvas id="comparisonChart"></canvas>
    </div>
    <div class="card">
      <h2>Statistical Significance</h2>
      ${sig ? renderSigTable(sig) : '<p style="color:#64748b;">Not enough data for significance testing.</p>'}
    </div>
    ${
      data.networkGraph
        ? `<div class="card card-full"><h2>Network Graph (Latest Snapshot)</h2><canvas id="networkGraphCanvas" style="height:360px"></canvas><p class="hint">Nodes are reputation-colored using aggregate 5-tuple score. Directed edges indicate active links.</p></div>`
        : ''
    }
    ${
      data.reputationEvolution
        ? `<div class="card"><h2>Reputation Evolution</h2><canvas id="reputationEvolutionChart"></canvas><p class="hint">${data.reputationEvolution.subjectLabel}</p></div>`
        : ''
    }
    ${
      data.gossipCascade
        ? `<div class="card"><h2>Gossip Propagation</h2><canvas id="gossipTimelineChart"></canvas><div id="gossipCascadeLinks"></div></div>`
        : ''
    }
  </div>

  <script>
    const COLORS = {
      blue: '#60a5fa',
      green: '#34d399',
      red: '#f87171',
      yellow: '#fbbf24',
      blueBg: 'rgba(96,165,250,0.15)',
      greenBg: 'rgba(52,211,153,0.15)',
      orange: '#fb923c',
      slate: '#94a3b8',
    };

    // Karma Over Time
    const karmaData = ${JSON.stringify(data.karmaOverTime)};
    new Chart(document.getElementById('karmaChart'), {
      type: 'line',
      data: {
        labels: karmaData.map(d => 'Ep ' + d.episode),
        datasets: [
          { label: 'Agent A Karma', data: karmaData.map(d => d.karmaA), borderColor: COLORS.blue, backgroundColor: COLORS.blueBg, fill: true, tension: 0.3 },
          { label: 'Agent B Karma', data: karmaData.map(d => d.karmaB), borderColor: COLORS.green, backgroundColor: COLORS.greenBg, fill: true, tension: 0.3 },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { min: 0, max: 100, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
        }
      }
    });

    // Payoff Distribution
    function buildHistogram(values, bins) {
      const min = Math.min(...values, ...bins.map(() => -10));
      const max = Math.max(...values, ...bins.map(() => 30));
      const step = (max - min) / bins;
      const counts = new Array(bins).fill(0);
      const labels = [];
      for (let i = 0; i < bins; i++) {
        const lo = min + i * step;
        labels.push(lo.toFixed(1));
        for (const v of values) {
          if (v >= lo && v < lo + step) counts[i]++;
        }
      }
      return { labels, counts };
    }
    const basePay = ${JSON.stringify(data.payoffDistBaseline)};
    const repPay = ${JSON.stringify(data.payoffDistReputation)};
    const bHist = buildHistogram(basePay, 10);
    const rHist = buildHistogram(repPay, 10);
    new Chart(document.getElementById('payoffChart'), {
      type: 'bar',
      data: {
        labels: bHist.labels,
        datasets: [
          { label: 'Baseline', data: bHist.counts, backgroundColor: COLORS.blue + '99' },
          { label: 'Treatment', data: rHist.counts, backgroundColor: COLORS.green + '99' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
        }
      }
    });

    // Action Frequencies
    const baseActions = ${JSON.stringify(data.actionFreqBaseline)};
    const repActions = ${JSON.stringify(data.actionFreqReputation)};
    const allActions = [...new Set([...Object.keys(baseActions), ...Object.keys(repActions)])].sort();
    new Chart(document.getElementById('actionChart'), {
      type: 'bar',
      data: {
        labels: allActions,
        datasets: [
          { label: 'Baseline', data: allActions.map(a => baseActions[a] || 0), backgroundColor: COLORS.blue + '99' },
          { label: 'Treatment', data: allActions.map(a => repActions[a] || 0), backgroundColor: COLORS.green + '99' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
        }
      }
    });

    // Comparison
    new Chart(document.getElementById('comparisonChart'), {
      type: 'bar',
      data: {
        labels: ['Agent A', 'Agent B'],
        datasets: [
          { label: 'Baseline', data: [${mc.baseline.avgPayoffA}, ${mc.baseline.avgPayoffB}], backgroundColor: COLORS.blue + '99' },
          { label: 'Treatment', data: [${mc.withReputation.avgPayoffA}, ${mc.withReputation.avgPayoffB}], backgroundColor: COLORS.green + '99' },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
        }
      }
    });

    // Optional network graph
    const networkData = ${JSON.stringify(data.networkGraph)};
    if (networkData && networkData.nodes && networkData.nodes.length > 0) {
      renderNetworkGraph('networkGraphCanvas', networkData);
    }

    // Optional reputation evolution chart
    const repEvolution = ${JSON.stringify(data.reputationEvolution)};
    if (repEvolution && repEvolution.steps && repEvolution.steps.length > 0) {
      new Chart(document.getElementById('reputationEvolutionChart'), {
        type: 'line',
        data: {
          labels: repEvolution.steps.map((s) => 'Step ' + s),
          datasets: [
            { label: 'investmentFailures', data: repEvolution.series.investmentFailures, borderColor: '#f97316', tension: 0.25 },
            { label: 'trusteeFailures', data: repEvolution.series.trusteeFailures, borderColor: '#ef4444', tension: 0.25 },
            { label: 'returnIssues', data: repEvolution.series.returnIssues, borderColor: '#f59e0b', tension: 0.25 },
            { label: 'returnSuccesses', data: repEvolution.series.returnSuccesses, borderColor: '#22c55e', tension: 0.25 },
            { label: 'investorSuccesses', data: repEvolution.series.investorSuccesses, borderColor: '#38bdf8', tension: 0.25 },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
            y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          },
        },
      });
    }

    // Optional gossip timeline and cascade links
    const gossipData = ${JSON.stringify(data.gossipCascade)};
    if (gossipData && gossipData.perStep && gossipData.perStep.length > 0) {
      new Chart(document.getElementById('gossipTimelineChart'), {
        type: 'bar',
        data: {
          labels: gossipData.perStep.map((d) => 'Step ' + d.step),
          datasets: [
            { label: 'Entries at step', data: gossipData.perStep.map((d) => d.count), backgroundColor: COLORS.orange + '99', yAxisID: 'y' },
            { label: 'Cumulative entries', data: gossipData.perStep.map((d) => d.cumulative), borderColor: COLORS.green, type: 'line', yAxisID: 'y1' },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
            y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, position: 'left' },
            y1: { ticks: { color: '#64748b' }, grid: { drawOnChartArea: false }, position: 'right' },
          },
        },
      });

      const container = document.getElementById('gossipCascadeLinks');
      if (container) {
        const rows = (gossipData.topLinks || []).map((link) =>
          '<li>' + link.from + ' → ' + link.to + ' (' + link.count + ')</li>'
        );
        container.innerHTML =
          '<p class="hint">Total gossip entries: ' + gossipData.totalEntries + '</p>' +
          '<ul class="cascade-list">' +
          (rows.length ? rows.join('') : '<li>No multi-hop links detected.</li>') +
          '</ul>';
      }
    }

    function renderNetworkGraph(canvasId, graph) {
      const canvas = document.getElementById(canvasId);
      if (!canvas || !canvas.getContext) {
        return;
      }

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 900;
      const height = canvas.clientHeight || 360;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const nodes = graph.nodes || [];
      const edges = graph.edges || [];
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.max(40, Math.min(width, height) * 0.34);

      const pos = {};
      nodes.forEach((node, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, nodes.length);
        pos[node.id] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      });

      // Edges with arrows
      ctx.strokeStyle = '#475569';
      ctx.fillStyle = '#475569';
      ctx.lineWidth = 1.2;
      edges.forEach((edge) => {
        const from = pos[edge.from];
        const to = pos[edge.to];
        if (!from || !to) {
          return;
        }
        drawArrow(ctx, from.x, from.y, to.x, to.y, 14);
      });

      // Nodes
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      nodes.forEach((node) => {
        const p = pos[node.id];
        ctx.beginPath();
        ctx.fillStyle = node.color || '#60a5fa';
        ctx.arc(p.x, p.y, 12, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(node.id, p.x, p.y - 20);
      });
    }

    function drawArrow(ctx, x1, y1, x2, y2, nodeRadius) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!len) {
        return;
      }
      const ux = dx / len;
      const uy = dy / len;
      const startX = x1 + ux * nodeRadius;
      const startY = y1 + uy * nodeRadius;
      const endX = x2 - ux * nodeRadius;
      const endY = y2 - uy * nodeRadius;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      const head = 6;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - head * Math.cos(angle - Math.PI / 6),
        endY - head * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - head * Math.cos(angle + Math.PI / 6),
        endY - head * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  </script>
</body>
</html>`;
}

function renderSigTable(sig: NonNullable<RunData['significance']>): string {
  const badge = (s: boolean) =>
    s
      ? '<span class="sig-badge sig-yes">Significant</span>'
      : '<span class="sig-badge sig-no">Not Significant</span>';

  return `<table class="sig-table">
    <tr><th>Metric</th><th>t</th><th>p-value</th><th>Mean Diff</th><th>Result</th></tr>
    <tr><td>Payoff A</td><td>${sig.payoffA.tStatistic}</td><td>${sig.payoffA.pValue}</td><td>${sig.payoffA.meanDifference}</td><td>${badge(sig.payoffA.significant)}</td></tr>
    <tr><td>Payoff B</td><td>${sig.payoffB.tStatistic}</td><td>${sig.payoffB.pValue}</td><td>${sig.payoffB.meanDifference}</td><td>${badge(sig.payoffB.significant)}</td></tr>
    <tr><td colspan="5" style="padding-top:1rem;color:#64748b;">
      Baseline CI: [${sig.baselineCI.lower}, ${sig.baselineCI.upper}] (mean=${sig.baselineCI.mean})<br>
      Treatment CI: [${sig.treatmentCI.lower}, ${sig.treatmentCI.upper}] (mean=${sig.treatmentCI.mean})
    </td></tr>
  </table>`;
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  let inputDir = '';
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputDir = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    }
  }

  if (!inputDir) {
    console.error(
      'Usage: ts-node src/visualize.ts --input <run-dir> [--output <file.html>]'
    );
    process.exit(1);
  }

  try {
    const outFile = generateDashboard(inputDir, outputPath);
    console.log(`Dashboard generated: ${outFile}`);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
