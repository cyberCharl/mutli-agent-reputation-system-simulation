import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import {
  runComparison,
  printComparisonSummary,
  saveComparisonResults,
  ComparisonConfig,
} from './compare';
import { MODEL_ALIASES, SUPPORTED_MODELS } from './openrouter';
import { createExperimentManifest, saveExperimentManifest } from './analysis/manifest';
import { computeRequiredSampleSize } from './stats';
import { loadStoredRunArtifacts, analyzeEpisodeResults } from './simulator';
import { CorrectionMethod, ExperimentManifest, TrueState } from './types';

config();

type Command = 'compare' | 'plan' | 'analyze';

function parseCommand(argv: string[]): { command: Command; args: string[] } {
  const [first, ...rest] = argv;
  if (first === 'compare' || first === 'plan' || first === 'analyze') {
    return { command: first, args: rest };
  }
  return { command: 'compare', args: argv };
}

function parseOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1]) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((flag) => args.includes(flag));
}

function parseCsvOption(args: string[], flag: string): string[] {
  const value = parseOption(args, flag);
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function parseCompareArgs(args: string[]): {
  models: string[];
  episodes: number;
  seed: number;
  rateLimit: number;
} {
  const modelsArg = parseOption(args, '--models');
  const episodes = parseInt(parseOption(args, '--episodes') || '10', 10);
  const seed = parseInt(parseOption(args, '--seed') || '42', 10);
  const rateLimit = parseInt(parseOption(args, '--rate-limit') || '200', 10);

  let models: string[];
  if (modelsArg) {
    models = modelsArg.split(',').map((model) => {
      const trimmed = model.trim();
      return MODEL_ALIASES[trimmed] || trimmed;
    });
  } else {
    models = [...SUPPORTED_MODELS];
  }

  return { models, episodes, seed, rateLimit };
}

function printCompareUsage(): void {
  console.log(`
Usage: npm run compare -- [options]

Options:
  --models <list>       Comma-separated model names or aliases (default: all 4 models)
                        Aliases: gemini, deepseek, kimi, mistral
  --episodes <n>        Episodes per matchup (default: 10)
  --seed <n>            Random seed for reproducibility (default: 42)
  --rate-limit <ms>     Milliseconds between API requests (default: 200)
  --help, -h            Show this help message

Examples:
  npm run compare -- --models "gemini,deepseek" --episodes 5 --seed 12345
  npm run compare -- --episodes 20 --seed 42
`);
}

function printPlanUsage(): void {
  console.log(`
Usage: npm run plan -- --effect-size <d> --power <target> --alpha <alpha> [options]

Options:
  --effect-size <d>         Expected standardized effect size
  --power <target>          Desired power (default: 0.8)
  --alpha <alpha>           Significance threshold (default: 0.05)
  --planned-total <n>       Planned episodes per condition (default: computed minimum)
  --experiment-id <id>      Experiment identifier
  --primary-metric <name>   Primary metric (default: totalPayoff)
  --secondary-metrics <a,b> Secondary metrics
  --correction <method>     none | bonferroni | holm | benjamini-hochberg
  --output <path>           Write manifest JSON to disk
  --help, -h                Show this help message
`);
}

function printAnalyzeUsage(): void {
  console.log(`
Usage: npm run analyze -- --input <results/run_dir> [options]

Options:
  --input <path>            Saved run directory with baseline/ and reputation/
  --correction <method>     none | bonferroni | holm | benjamini-hochberg
  --output <path>           Write analysis JSON to disk
  --help, -h                Show this help message
`);
}

function printTopLevelUsage(): void {
  console.log(`
Usage:
  npm run compare -- [options]
  npm run plan -- --effect-size 0.5 --power 0.8 --alpha 0.05
  npm run analyze -- --input results/run_xxx --correction holm
`);
}

function parseCorrectionMethod(
  value: string | undefined,
  fallback: CorrectionMethod
): CorrectionMethod {
  if (!value) {
    return fallback;
  }

  if (
    value === 'none' ||
    value === 'bonferroni' ||
    value === 'holm' ||
    value === 'benjamini-hochberg'
  ) {
    return value;
  }

  throw new Error(`Unsupported correction method: ${value}`);
}

function buildManifestFromPlanArgs(args: string[]): ExperimentManifest {
  const effectSize = parseFloat(parseOption(args, '--effect-size') || '');
  const power = parseFloat(parseOption(args, '--power') || '0.8');
  const alpha = parseFloat(parseOption(args, '--alpha') || '0.05');
  const computedMinimum = computeRequiredSampleSize(power, alpha, effectSize);
  const plannedTotal = parseInt(
    parseOption(args, '--planned-total') || `${computedMinimum}`,
    10
  );
  const primaryMetric = parseOption(args, '--primary-metric') || 'totalPayoff';
  const secondaryMetrics = parseCsvOption(args, '--secondary-metrics');
  const correctionMethod = parseCorrectionMethod(
    parseOption(args, '--correction'),
    secondaryMetrics.length > 0 ? 'holm' : 'none'
  );

  return createExperimentManifest({
    experimentId:
      parseOption(args, '--experiment-id') || `exp-${Date.now()}`,
    hypotheses: [
      {
        id: `h1-${primaryMetric}`,
        description: `Reputation changes ${primaryMetric}.`,
        direction: 'two-tailed',
        alpha,
        correctionGroup:
          correctionMethod === 'none' ? undefined : 'primary-and-secondary',
      },
    ],
    primaryMetric,
    secondaryMetrics,
    sampleSize: {
      targetPower: power,
      expectedEffectSize: effectSize,
      computedMinimum,
      plannedTotal,
      justification:
        'Computed from the expected effect size using the two-sample normal approximation.',
    },
    analysisPlan: {
      primaryTest: 't-test',
      correctionMethod,
      stratification: ['trueState', 'role', 'model'],
    },
    scenarios: Object.values(TrueState),
    models: ['google/gemini-2.5-flash-lite', 'mistralai/mistral-small-3.1-24b-instruct'],
    conditions: ['baseline', 'reputation'],
  });
}

async function handleCompare(args: string[]): Promise<void> {
  if (hasFlag(args, '--help', '-h')) {
    printCompareUsage();
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'Error: OPENROUTER_API_KEY environment variable is not set.\n' +
        'Set it with: export OPENROUTER_API_KEY=$(sops -d ~/dotfiles/secrets/secrets.enc.yaml | yq \'.api.openrouter_token\')'
    );
    process.exit(1);
  }

  const { models, episodes, seed, rateLimit } = parseCompareArgs(args);

  console.log('MSPN Multi-Model Comparison');
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);

  const comparisonConfig: ComparisonConfig = {
    models,
    episodesPerModel: episodes,
    seed,
    apiKey,
    rateLimit,
  };

  const results = await runComparison(comparisonConfig);
  printComparisonSummary(results);
  saveComparisonResults(results);
}

async function handlePlan(args: string[]): Promise<void> {
  if (hasFlag(args, '--help', '-h')) {
    printPlanUsage();
    return;
  }

  if (!parseOption(args, '--effect-size')) {
    throw new Error('The --effect-size option is required for planning.');
  }

  const manifest = buildManifestFromPlanArgs(args);
  const outputPath = parseOption(args, '--output');

  if (outputPath) {
    saveExperimentManifest(outputPath, manifest);
    console.log(`Manifest written to ${path.resolve(outputPath)}`);
  }

  console.log(JSON.stringify(manifest, null, 2));
}

async function handleAnalyze(args: string[]): Promise<void> {
  if (hasFlag(args, '--help', '-h')) {
    printAnalyzeUsage();
    return;
  }

  const inputPath = parseOption(args, '--input');
  if (!inputPath) {
    throw new Error('The --input option is required for analysis.');
  }

  const { baselineResults, reputationResults, manifest } =
    loadStoredRunArtifacts(inputPath);
  const correctionMethod = parseCorrectionMethod(
    parseOption(args, '--correction'),
    manifest?.analysisPlan.correctionMethod || 'none'
  );
  const analysis = analyzeEpisodeResults(baselineResults, reputationResults, {
    correctionMethod,
    manifest,
  });

  const output = {
    input: path.resolve(inputPath),
    manifest,
    significance: analysis.significance,
    warnings: analysis.warnings,
  };
  const outputPath = parseOption(args, '--output');

  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, JSON.stringify(output, null, 2));
    console.log(`Analysis written to ${resolvedOutput}`);
  }

  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));

  if (hasFlag(parsed.args, '--help', '-h') && parsed.command === 'compare' && parsed.args.length === 1) {
    printTopLevelUsage();
    return;
  }

  if (parsed.command === 'compare') {
    await handleCompare(parsed.args);
    return;
  }

  if (parsed.command === 'plan') {
    await handlePlan(parsed.args);
    return;
  }

  await handleAnalyze(parsed.args);
}

main().catch((error) => {
  console.error('CLI failed:', error);
  process.exit(1);
});
