# Karmic Debt: Multi-Agent Reputation Simulation

A TypeScript simulation framework for studying reputation dynamics in LLM-to-LLM negotiations, using the MSPN (Misaligned Secure Protocol Negotiation) hypergame.

## Overview

Two LLM agents negotiate security protocol levels under uncertainty. A karma-based reputation system tracks behavior across episodes, applying consequences (action restrictions, payoff penalties) to test whether inherited reputation changes agent decision-making.

**Research questions:**
- Does reputation visibility change negotiation behavior?
- How do karma consequences affect cooperation rates?
- Can we detect behavioral differences between baseline and reputation conditions?

## The MSPN Game

### Scenario

Agents negotiate a security protocol level for a joint operation. The true risk state is hidden — agents have probabilistic beliefs that update based on observed actions.

### Roles

- **Agent A (Proposer):** Proposes a protocol level
- **Agent B (Reviewer):** Accepts, modifies, or rejects the proposal

### Protocol Levels

| Level | Risk | Payoff Profile |
|-------|------|----------------|
| High | Safe | Guaranteed 10/10 |
| Medium | Safe | Guaranteed 10/10 |
| Low | Risky | 12/8 if safe, -5/-5 if breach |

### Game Phases

```
1. PROPOSAL  → A proposes: Low | Medium | High
2. REVIEW    → B responds: Accept | Modify | Reject
3. EXECUTION → Payoffs calculated based on protocol + hidden state
```

Up to 3 negotiation rounds per episode.

### Payoff Matrix

| Final Protocol | True State | Payoff A | Payoff B |
|---------------|------------|----------|----------|
| High/Medium | Either | 10 | 10 |
| Low | SafeLow | 12 | 8 |
| Low | DangerousLow | -5 | -5 |
| Reject | — | 2 | 2 |

## Karma System

### How Karma Changes

After each episode, behavior is evaluated:

| Agent | Action | Outcome | Karma Delta |
|-------|--------|---------|-------------|
| A | Proposed Low | Breach | -20 |
| A | Proposed Low | Safe success | +5 |
| A | Proposed High/Med | Secure coordination | +3 |
| B | Accepted Low | Breach | -15 |
| B | Accepted Low | Safe success | +5 |
| B | Rejected | Would have been breach | +10 |
| B | Rejected | Would have been safe | -5 |

### Karma Consequences

| Karma Range | Blocked Actions | Payoff Penalty | Auto-Reject |
|-------------|-----------------|----------------|-------------|
| < 20 | Low protocol | 50% | Yes |
| 20-29 | Low protocol | 30% | No |
| 30-49 | None | 10% | No |
| ≥ 50 | None | 0% | No |

Karma persists across simulation runs via `data/karma.json`.

## Installation

```bash
# Clone and install
git clone <repository-url>
cd mutli-agent-reputation-system-simulation
npm install

# Configure API key (optional — falls back to mock agents)
cp env.example .env
# Add OPENROUTER_API_KEY to .env
```

## Usage

### Run A/B Test

```bash
# Basic run (100 episodes, mock agents if no API key)
npm run dev

# Custom parameters: episodes, seed, concurrency
npm run dev 200 my-seed 8
```

### Model Comparison

Compare specific LLM models head-to-head:

```bash
npm run compare -- --modelA google/gemini-2.5-flash-lite --modelB mistralai/mistral-small-3.1-24b-instruct --episodes 20
```

### Generate Visualization

```bash
npm run visualize -- --input results/run_YYYY-MM-DD_HH-MM-SS_eps-N_seed-X
```

Generates `dashboard.html` with:
- Karma over time charts
- Payoff distribution histograms
- Action frequency breakdown
- Statistical significance table

### Run Tests

```bash
npm test                    # All tests (113 passing)
npm run test:openrouter     # OpenRouter integration tests
```

## Project Structure

```
src/
├── game.ts           # MSPN game logic, belief updates
├── agent.ts          # LLM agent wrapper, mock fallback
├── reputation.ts     # Karma system and consequences
├── simulator.ts      # A/B test runner, parallel execution
├── compare.ts        # Model-vs-model comparison
├── stats.ts          # Statistical significance (t-test, bootstrap CI)
├── visualize.ts      # HTML dashboard generation
├── karma/
│   └── storage.ts    # Persistent karma (atomic JSON writes)
├── types.ts          # Type definitions
├── prompts.ts        # LLM prompt templates
├── schemas.ts        # Zod schemas for structured output
└── openrouter.ts     # OpenRouter API client

.ai/plans/            # AI-generated development plans
data/                 # Persistent karma storage
results/              # Simulation run outputs
tests/                # Jest test suites
```

## Key Features

- **Parallel Episode Execution:** Configurable concurrency with `p-limit`
- **Statistical Analysis:** Paired t-tests and bootstrap confidence intervals
- **Persistent Karma:** Atomic writes, survives across runs
- **Structured Output:** Zod schemas for reliable LLM JSON parsing
- **Visualization Dashboard:** Self-contained HTML with Chart.js
- **Reproducible Runs:** Seeded RNG for deterministic replay

## Output Format

Results are saved to `results/run_<timestamp>_eps-<n>_seed-<s>/`:

```
summary.json           # Aggregate metrics, statistical significance
baseline/
  episodes.json        # All baseline episode data
  episode_*.json       # Individual episode files
reputation/
  episodes.json        # All reputation condition data
  episode_*.json       # Individual episode files
dashboard.html         # Visualization (after running visualize)
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | OpenRouter API key | No (uses mock) |

### Game Config (in code)

```typescript
{
  maxRounds: 3,
  beliefUpdateStrength: { proposal: 0.2, review: 0.15 },
  payoffNoise: 1,
  initialBeliefAlignment: 0.7
}
```

## Known Limitations

1. **Two-agent only:** Architecture is coupled to A/B roles (proposer/reviewer)
2. **Mock agents are deterministic:** Same seed = identical results regardless of karma
3. **Simulator LLM parsing:** Falls back to mock if models return markdown-wrapped JSON

See `.ai/plans/PLAN.md` for roadmap and planned improvements.

## License

MIT
