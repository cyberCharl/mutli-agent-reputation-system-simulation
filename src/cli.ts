import { config } from 'dotenv';
import {
  runComparison,
  printComparisonSummary,
  saveComparisonResults,
  ComparisonConfig,
} from './compare';
import { MODEL_ALIASES, SUPPORTED_MODELS } from './openrouter';

config();

function parseArgs(): {
  models: string[];
  episodes: number;
  seed: number;
  rateLimit: number;
} {
  const args = process.argv.slice(2);
  let modelsArg: string | undefined;
  let episodes = 10;
  let seed = 42;
  let rateLimit = 200;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--models' && args[i + 1]) {
      modelsArg = args[++i];
    } else if (args[i] === '--episodes' && args[i + 1]) {
      episodes = parseInt(args[++i], 10);
    } else if (args[i] === '--seed' && args[i + 1]) {
      seed = parseInt(args[++i], 10);
    } else if (args[i] === '--rate-limit' && args[i + 1]) {
      rateLimit = parseInt(args[++i], 10);
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  // Resolve model names
  let models: string[];
  if (modelsArg) {
    models = modelsArg.split(',').map((m) => {
      const trimmed = m.trim();
      return MODEL_ALIASES[trimmed] || trimmed;
    });
  } else {
    models = [...SUPPORTED_MODELS];
  }

  return { models, episodes, seed, rateLimit };
}

function printUsage(): void {
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

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      'Error: OPENROUTER_API_KEY environment variable is not set.\n' +
        'Set it with: export OPENROUTER_API_KEY=$(sops -d ~/dotfiles/secrets/secrets.enc.yaml | yq \'.api.openrouter_token\')'
    );
    process.exit(1);
  }

  const { models, episodes, seed, rateLimit } = parseArgs();

  console.log('MSPN Multi-Model Comparison');
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);

  const config: ComparisonConfig = {
    models,
    episodesPerModel: episodes,
    seed,
    apiKey,
    rateLimit,
  };

  try {
    const results = await runComparison(config);
    printComparisonSummary(results);
    saveComparisonResults(results);
  } catch (error) {
    console.error('Comparison failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
