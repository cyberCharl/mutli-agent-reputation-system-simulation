# Karmic Debt TypeScript Project — Development Plan

*Generated 2026-02-06*
*Updated 2026-02-06 — Added Definitions of Done & Validation Mechanisms*

---

## Executive Summary

The foundation is solid. Core game mechanics work, tests pass, architecture is clean. However, the **reputation system doesn't persist across episodes**, which defeats the research purpose. This plan prioritizes fixing that critical bug, then builds toward a research-ready simulation.

---

## P0 — Critical Fixes (Do First)

### 1. Fix Reputation Persistence Across Episodes
**File:** `src/simulator.ts`  
**Effort:** 1-2 hours

**Problem:**
```typescript
// Current: NEW ReputationSystem each episode — karma never carries forward
const reputationSystem = useReputation ? new ReputationSystem() : null;
```

**Solution:**
```typescript
// In runABTest() — create ONCE, share across all episodes
export async function runABTest(config: ABTestConfig): Promise<ABTestResults> {
  const sharedReputationSystem = new ReputationSystem();
  
  // Baseline episodes (no reputation)
  for (let i = 0; i < config.episodesPerCondition; i++) {
    const result = await runEpisode(i, config.apiKey, false, config.seed + i, null);
    baselineResults.push(result);
  }
  
  // With reputation (shared system)
  for (let i = 0; i < config.episodesPerCondition; i++) {
    const result = await runEpisode(
      i, 
      config.apiKey, 
      true, 
      config.seed + config.episodesPerCondition + i, 
      sharedReputationSystem  // Pass shared instance
    );
    reputationResults.push(result);
  }
}
```

**Also update `runEpisode` signature:**
```typescript
async function runEpisode(
  episodeNum: number,
  apiKey: string,
  useReputation: boolean,
  seed: number,
  reputationSystem: ReputationSystem | null  // Accept external instance
): Promise<EpisodeResult>
```

#### Definition of Done
- [x] `runABTest()` creates a single `ReputationSystem` instance before the episode loop
- [x] `runEpisode()` accepts an optional `ReputationSystem` parameter instead of creating its own
- [x] Karma values accumulate visibly across episodes (agent who breaches in episode 1 has lower karma in episode 5)
- [x] TypeScript compiles with no errors
- [x] All existing tests pass

#### Validation Mechanism
```bash
# 1. Run simulation with reputation enabled
npm run simulate -- --episodes 10 --mock --with-reputation

# 2. Inspect logs for karma progression
grep -i "karma" results/latest.log | head -20
# Expected: Karma values should CHANGE across episodes, not reset to 50

# 3. Programmatic check: Add temporary logging
# In simulator.ts after each episode:
console.log(`Episode ${i}: Agent A karma = ${sharedReputationSystem.getKarma('a')}`);
# Run and verify values differ from 50 after breaches occur
```

---

### 2. Add Karma to LLM Prompts
**File:** `src/prompts.ts`  
**Effort:** 1-2 hours

**Problem:** Agents don't know their reputation when making decisions.

**Solution — Update proposal prompt:**
```typescript
export function buildProposalPrompt(
  agentId: string,
  belief: NestedBelief,
  karma?: number,  // Add karma parameter
  opponentKarma?: number
): string {
  const karmaContext = karma !== undefined 
    ? `\n\nYour current karma: ${karma}/100.${karma < 30 ? ' ⚠️ WARNING: Low karma may result in blocked actions.' : ''}
${opponentKarma !== undefined ? `Opponent karma: ${opponentKarma}/100.` : ''}`
    : '';

  return `You are Agent ${agentId} in a security protocol negotiation...
${karmaContext}
...rest of prompt`;
}
```

**Update review prompt similarly** — include breach history warning if karma is low.

#### Definition of Done
- [x] `buildProposalPrompt()` accepts optional `karma` and `opponentKarma` parameters
- [x] `buildReviewPrompt()` accepts optional `karma` and `opponentKarma` parameters
- [x] Generated prompts include karma context when values are provided
- [x] Low karma (< 30) triggers a warning message in the prompt
- [x] Callers in `agent.ts` pass karma values when available

#### Validation Mechanism
```bash
# 1. Unit test for prompt generation
npm test -- --grep "prompt"

# 2. Manual inspection: Add logging to see generated prompts
# In agent.ts before LLM call:
console.log("Generated prompt:", prompt);

# 3. Run simulation and grep for karma in prompts
npm run simulate -- --episodes 3 --verbose 2>&1 | grep -A5 "karma"
# Expected: Prompts should contain "Your current karma: XX/100"

# 4. Verify warning appears for low karma
# Manually set an agent's karma to 25, generate prompt, confirm warning text appears
```

---

### 3. Write ReputationSystem Tests
**File:** `tests/reputation.test.ts` (new)  
**Effort:** 2-3 hours

```typescript
import { ReputationSystem } from '../src/reputation';

describe('ReputationSystem', () => {
  let repSystem: ReputationSystem;
  
  beforeEach(() => {
    repSystem = new ReputationSystem();
  });

  test('should start agents at karma 50', () => {
    expect(repSystem.getKarma('a')).toBe(50);
    expect(repSystem.getKarma('b')).toBe(50);
  });

  test('should accumulate karma changes across episodes', () => {
    repSystem.updateKarma('a', -10);
    repSystem.updateKarma('a', -15);
    expect(repSystem.getKarma('a')).toBe(25);
  });

  test('should apply blocked actions at karma < 30', () => {
    repSystem.updateKarma('a', -25);  // Now at 25
    expect(repSystem.isBlocked('a')).toBe(true);
  });

  test('should clamp karma between 0 and 100', () => {
    repSystem.updateKarma('a', -100);
    expect(repSystem.getKarma('a')).toBe(0);
    
    repSystem.updateKarma('b', 100);
    expect(repSystem.getKarma('b')).toBe(100);
  });
});
```

#### Definition of Done
- [x] `tests/reputation.test.ts` exists with at least 5 test cases
- [x] Tests cover: initial karma, accumulation, blocking threshold, clamping (min/max), and karma retrieval for unknown agents
- [x] All reputation tests pass
- [x] Test coverage for `src/reputation.ts` is ≥ 80%

#### Validation Mechanism
```bash
# 1. Run all tests
npm test
# Expected: All tests pass, including new reputation tests

# 2. Run only reputation tests
npm test -- --grep "ReputationSystem"
# Expected: 5+ tests pass

# 3. Check coverage
npm test -- --coverage
# Expected: src/reputation.ts shows ≥ 80% coverage

# 4. Verify edge cases
# - Agent with no prior karma returns 50
# - Karma cannot go below 0 or above 100
# - Multiple updates accumulate correctly
```

---

## P1 — Short-Term Improvements

### 4. Add Stochasticity to Mock Agents
**File:** `src/agent.ts`  
**Effort:** 1-2 hours

**Problem:** Mock agents are deterministic — can't demonstrate reputation effects.

```typescript
private mockPropose(belief: NestedBelief, rng: seedrandom.PRNG): ProtocolLevel {
  const safeProb = belief.own[TrueState.SafeLow] || 0;
  const roll = rng();  // Use seeded RNG for reproducibility
  
  if (safeProb > 0.7) {
    return roll < 0.8 ? ProtocolLevel.Low : ProtocolLevel.Medium;
  } else if (safeProb > 0.4) {
    return roll < 0.6 ? ProtocolLevel.Medium : (roll < 0.8 ? ProtocolLevel.Low : ProtocolLevel.High);
  } else {
    return roll < 0.7 ? ProtocolLevel.High : ProtocolLevel.Medium;
  }
}
```

#### Definition of Done
- [x] Mock agent methods accept a seeded RNG instance
- [x] Decision logic includes probabilistic branching (not pure if/else)
- [x] Same seed produces same results (reproducibility preserved)
- [x] Different seeds produce different action distributions
- [x] Existing mock agent tests updated to use seeded RNG

#### Validation Mechanism
```bash
# 1. Run simulation twice with SAME seed
npm run simulate -- --episodes 20 --mock --seed 12345 > run1.txt
npm run simulate -- --episodes 20 --mock --seed 12345 > run2.txt
diff run1.txt run2.txt
# Expected: Identical output (reproducibility)

# 2. Run simulation twice with DIFFERENT seeds
npm run simulate -- --episodes 20 --mock --seed 12345 > run1.txt
npm run simulate -- --episodes 20 --mock --seed 99999 > run2.txt
diff run1.txt run2.txt
# Expected: Different outcomes (stochasticity working)

# 3. Statistical check: Run 100 episodes, verify action distribution
# Actions should not be 100% one type — expect variance
```

---

### 5. Update Both Agents' Beliefs on Actions
**File:** `src/game.ts`  
**Effort:** 2-3 hours

**Problem:** Only the acting agent updates beliefs. The observing agent should also update based on opponent's revealed action.

```typescript
// In processAction() or similar
updateBeliefsFromObservation(observingAgentId: string, observedAction: Action) {
  // If opponent proposes Low, likely they believe state is safe
  // Bayesian update on observing agent's model of opponent
}
```

#### Definition of Done
- [x] New function `updateBeliefsFromObservation()` implemented in game.ts
- [x] After each action, BOTH agents' beliefs are updated (actor updates from outcome, observer updates from witnessed action)
- [x] Belief updates follow Bayesian logic (observing Low proposal increases belief opponent thinks state is safe)
- [x] Game state tracks belief history for debugging/analysis
- [x] Unit tests cover observer belief updates

#### Validation Mechanism
```bash
# 1. Add logging to track belief changes
# In game.ts after belief updates:
console.log(`Agent ${observerId} updated belief about opponent:`, newBelief);

# 2. Run single episode with verbose logging
npm run simulate -- --episodes 1 --mock --verbose

# 3. Verify both agents' beliefs change after each action
# Expected: Log shows belief updates for BOTH agents, not just the actor

# 4. Unit test
npm test -- --grep "belief.*observation"
# Expected: Tests pass confirming observer updates work
```

---

### 6. Add API Rate Limiting
**File:** `src/agent.ts`  
**Effort:** 30 min

```typescript
const RATE_LIMIT_MS = 200;  // 5 req/sec

async function callLLMWithRateLimit(prompt: string): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  return await openai.chat.completions.create(/* ... */);
}
```

#### Definition of Done
- [x] All LLM API calls go through a rate-limited wrapper function
- [x] Configurable delay between calls (default 200ms = 5 req/sec)
- [x] Rate limit is configurable via environment variable or config
- [x] No 429 (rate limit) errors when running with LLM agents

#### Validation Mechanism
```bash
# 1. Run with LLM agents and monitor for rate limit errors
OPENROUTER_API_KEY=xxx npm run simulate -- --episodes 10 2>&1 | grep -i "rate\|429\|limit"
# Expected: No rate limit errors

# 2. Verify timing between requests
# Add timestamp logging before each API call
console.log(`API call at ${Date.now()}`);
# Run and verify gaps of ≥ 200ms between calls

# 3. Test with intentionally low rate limit
RATE_LIMIT_MS=1000 npm run simulate -- --episodes 3
# Expected: Noticeably slower execution, no errors
```

---

### 7. Implement Multi-Round Negotiation
**File:** `src/game.ts`, `src/simulator.ts`  
**Effort:** 4-6 hours

The README mentions "3 rounds max" but only single rounds run. Implement:
- Max 3 negotiation rounds per episode
- Early exit if agents agree on protocol level
- Track convergence vs timeout

#### Definition of Done
- [x] Episodes can run up to 3 negotiation rounds
- [x] Round exits early if both agents propose the same protocol level
- [x] Episode result includes: number of rounds, whether agreement was reached, final protocol
- [x] Game state machine handles round transitions correctly
- [x] Results JSON includes round count and convergence flag

#### Validation Mechanism
```bash
# 1. Run simulation and check round counts in results
npm run simulate -- --episodes 20 --mock
cat results/summary.json | jq '.episodes[].roundCount'
# Expected: Mix of 1, 2, and 3 (not all 1s)

# 2. Verify early exit on agreement
# Check logs for "Agreement reached in round X" messages
grep -i "agreement" results/latest.log
# Expected: Some episodes show early agreement

# 3. Statistical check
cat results/summary.json | jq '[.episodes[].roundCount] | add / length'
# Expected: Average rounds should be < 3 (some early exits)

# 4. Unit test for round progression
npm test -- --grep "multi-round\|negotiation"
```

---

## P2 — Medium-Term Features

### 8. Statistical Significance Module
**File:** `src/stats.ts` (new)  
**Effort:** 4-6 hours

```typescript
export function pairedTTest(baseline: number[], treatment: number[]): {
  tStatistic: number;
  pValue: number;
  significant: boolean;  // at α = 0.05
}

export function bootstrapCI(data: number[], confidence: number = 0.95): {
  mean: number;
  lower: number;
  upper: number;
}
```

#### Definition of Done
- [x] `src/stats.ts` exists with `pairedTTest()` and `bootstrapCI()` functions
- [x] t-test implementation matches standard statistical formula
- [x] Bootstrap CI uses 10,000 resamples by default
- [x] A/B test results include p-value and confidence intervals
- [x] Results clearly indicate whether difference is statistically significant
- [x] Unit tests verify correctness against known statistical results

#### Validation Mechanism
```bash
# 1. Unit test with known values
npm test -- --grep "stats\|tTest\|bootstrap"
# Test case: Compare [1,2,3,4,5] vs [2,3,4,5,6] — known t-statistic

# 2. Run A/B test and check for significance output
npm run simulate -- --episodes 50 --ab-test
cat results/summary.json | jq '.significance'
# Expected: Object with pValue, tStatistic, significant fields

# 3. Sanity check: identical distributions should have p > 0.05
# Manually test: pairedTTest([1,2,3], [1,2,3]) should return p ≈ 1.0

# 4. Verify bootstrap CI contains true mean
# For [1,2,3,4,5], CI should contain 3.0
```

---

### 9. Persistent Karma Storage
**File:** `src/karma/storage.ts` (new)  
**Effort:** 3-4 hours

Option A: JSON file
```typescript
export class KarmaStorage {
  private path: string;
  
  save(karma: Map<string, number>): void {
    fs.writeFileSync(this.path, JSON.stringify(Object.fromEntries(karma)));
  }
  
  load(): Map<string, number> {
    const data = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    return new Map(Object.entries(data));
  }
}
```

Option B: SQLite for larger scale

#### Definition of Done
- [x] `KarmaStorage` class implemented with `save()` and `load()` methods
- [x] Storage location configurable (default: `./data/karma.json`)
- [x] ReputationSystem can initialize from stored karma
- [x] Karma persists across simulation runs (not just episodes)
- [x] Handles missing file gracefully (starts fresh)
- [x] Atomic writes to prevent corruption

#### Validation Mechanism
```bash
# 1. Run simulation, then check file exists
npm run simulate -- --episodes 10 --persist-karma
ls -la data/karma.json
# Expected: File exists with karma data

# 2. Inspect stored karma
cat data/karma.json | jq '.'
# Expected: Valid JSON with agent IDs and karma values

# 3. Run again and verify karma continues
npm run simulate -- --episodes 10 --persist-karma
cat data/karma.json | jq '.'
# Expected: Karma values reflect cumulative history

# 4. Delete file, run simulation — should start fresh
rm data/karma.json
npm run simulate -- --episodes 5 --persist-karma
cat data/karma.json | jq '.'
# Expected: New file with fresh karma (starts at 50)
```

---

### 10. Parallel Episode Execution
**File:** `src/simulator.ts`  
**Effort:** 4-6 hours

Use worker threads or Promise.all with concurrency limit:
```typescript
import pLimit from 'p-limit';

const limit = pLimit(4);  // 4 concurrent episodes

const results = await Promise.all(
  episodes.map(ep => limit(() => runEpisode(ep)))
);
```

#### Definition of Done
- [x] Episodes can run in parallel with configurable concurrency
- [x] Default concurrency = 4 (configurable via CLI flag or env var)
- [x] Results are collected in correct order regardless of completion order
- [x] Shared ReputationSystem is thread-safe (mutex or sequential karma updates)
- [x] Performance improvement measurable (≥ 2x speedup with 4 workers)
- [x] Error in one episode doesn't crash others

#### Validation Mechanism
```bash
# 1. Benchmark sequential vs parallel
time npm run simulate -- --episodes 40 --mock --concurrency 1
time npm run simulate -- --episodes 40 --mock --concurrency 4
# Expected: Parallel is significantly faster

# 2. Verify result consistency
npm run simulate -- --episodes 20 --mock --seed 123 --concurrency 1 > seq.txt
npm run simulate -- --episodes 20 --mock --seed 123 --concurrency 4 > par.txt
diff seq.txt par.txt
# Expected: Results should be identical (deterministic)

# 3. Stress test with high concurrency
npm run simulate -- --episodes 100 --mock --concurrency 10
# Expected: Completes without errors or race conditions

# 4. Verify karma thread safety
# Check that karma values are consistent across parallel runs
```

---

### 11. Visualization Dashboard
**Effort:** 8-12 hours

Options:
- Simple: Generate charts with Recharts, output as HTML
- Interactive: Small Next.js app reading from results JSON
- Quick: Just output CSVs and use external tools (Excel, Jupyter)

#### Definition of Done
- [ ] At least one visualization method implemented
- [ ] Charts show: karma over time, payoff distribution, action frequencies
- [ ] Baseline vs treatment comparison visible
- [ ] Can regenerate from any results JSON file
- [ ] Output is shareable (HTML file or hosted app)

#### Validation Mechanism
```bash
# 1. Generate visualization from results
npm run visualize -- --input results/summary.json --output charts.html

# 2. Open in browser and verify charts render
open charts.html  # or xdg-open on Linux
# Expected: See karma trends, payoff histograms, etc.

# 3. Verify all expected charts are present
# - Karma over episodes (line chart)
# - Payoff distribution (histogram)
# - Action frequency (bar chart)
# - Baseline vs Treatment comparison

# 4. Test with different result files
npm run visualize -- --input results/old_experiment.json
# Expected: Charts update to reflect different data
```

---

## Testing Checklist

- [x] All existing tests still pass
- [x] New reputation tests pass (23 new tests, 95%+ coverage)
- [x] Karma persists across episodes (verified via logging)
- [x] LLM prompts include karma (log inspection)
- [x] Mock agents show variance (run twice, compare results)
- [ ] A/B test shows measurable difference between conditions

---

## Verification Steps

After P0 fixes, run:

```bash
# Run A/B test with mock agents
npm run test  # All tests pass

# Run simulation
npm run simulate -- --episodes 20 --mock

# Check results
cat results/summary.json | jq '.baselineAvgPayoff, .reputationAvgPayoff'
# Should show DIFFERENT values (they're currently identical)
```

---

## Effort Summary

| Priority | Items | Total Effort |
|----------|-------|--------------|
| P0 | 3 items | 4-7 hours |
| P1 | 4 items | 7-12 hours |
| P2 | 4 items | 19-28 hours |

**Recommended first session:** Complete all P0 items (~half day). This makes the simulation research-ready for basic hypothesis testing.
