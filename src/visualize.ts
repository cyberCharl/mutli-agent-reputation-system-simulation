import * as fs from 'fs';
import * as path from 'path';
import { EpisodeResult, ProtocolLevel, ReviewAction } from './types';

interface RunData {
  parameters: { numEpisodes: number; seed: string };
  baseline: { coopRate: number; breachRate: number; avgPayoffA: number; avgPayoffB: number };
  withReputation: { coopRate: number; breachRate: number; avgPayoffA: number; avgPayoffB: number };
  significance?: {
    payoffA: { tStatistic: number; pValue: number; significant: boolean; meanDifference: number };
    payoffB: { tStatistic: number; pValue: number; significant: boolean; meanDifference: number };
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
}

export function generateDashboard(runDir: string, outputPath?: string): string {
  const summaryPath = path.join(runDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`summary.json not found in ${runDir}`);
  }

  const summary: RunData = JSON.parse(
    fs.readFileSync(summaryPath, 'utf-8')
  );

  // Load episode data
  const baselineEpisodes = loadEpisodes(path.join(runDir, 'baseline'));
  const reputationEpisodes = loadEpisodes(path.join(runDir, 'reputation'));

  // Build chart data
  const chartData = buildChartData(
    summary,
    baselineEpisodes,
    reputationEpisodes
  );

  const html = renderHTML(chartData);
  const outFile =
    outputPath || path.join(runDir, 'dashboard.html');
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
  reputationEpisodes: EpisodeResult[]
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

  return {
    karmaOverTime,
    payoffDistBaseline,
    payoffDistReputation,
    actionFreqBaseline,
    actionFreqReputation,
    metricsComparison: summary,
  };
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
  </div>

  <script>
    const COLORS = {
      blue: '#60a5fa',
      green: '#34d399',
      red: '#f87171',
      yellow: '#fbbf24',
      purple: '#a78bfa',
      cyan: '#22d3ee',
      blueBg: 'rgba(96,165,250,0.15)',
      greenBg: 'rgba(52,211,153,0.15)',
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
  </script>
</body>
</html>`;
}

function renderSigTable(
  sig: NonNullable<RunData['significance']>
): string {
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
    console.error('Usage: ts-node src/visualize.ts --input <run-dir> [--output <file.html>]');
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
