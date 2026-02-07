# OpenRouter Integration & Research Infrastructure Plan

*Created 2026-02-07*

---

## Goal

Transform the Karmic Debt simulation from a prototype into research-ready infrastructure by:
1. Integrating OpenRouter for multi-model comparisons
2. Implementing structured output for reliable parsing
3. Building robust data capture using wide events
4. Adding causal tracing for agent decisions
5. Creating visualizations for cooperation/collapse dynamics

---

## Model Selection

Based on structured output support verification:

| Model | Structured Output | Input $/1M | Output $/1M | Notes |
|-------|:-----------------:|------------|-------------|-------|
| `google/gemini-2.5-flash-lite` | ✅ | $0.10 | $0.40 | Google's newest Flash |
| `deepseek/deepseek-chat-v3.1` | ✅ | $0.15 | $0.75 | Best value DeepSeek |
| `moonshotai/kimi-k2-0905` | ✅ | $0.39 | $1.90 | Moonshot's latest |
| `mistralai/mistral-small-3.1-24b-instruct` | ✅ | $0.03 | $0.11 | Western open-weight |

**Note:** Anthropic Haiku excluded — no structured output support on OpenRouter.

---

## Implementation Tasks

### Task 1: OpenRouter Client Integration
**Files:** `src/openrouter.ts` (new), `src/agent.ts`

Create OpenRouter client with:
- Multi-model support via model parameter
- Structured output using `response_format` with JSON schema
- Rate limiting integration (existing p-limit)
- Error handling with retries and exponential backoff
- Per-request cost and latency tracking

```typescript
interface OpenRouterConfig {
  apiKey: string;
  model: string;
  rateLimit?: number;  // ms between requests, default 200
}

interface StructuredResponse<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number };
  cost: number;
  latencyMs: number;
}

export class OpenRouterClient {
  async complete<T>(
    prompt: string,
    schema: JSONSchema,
    options?: { temperature?: number }
  ): Promise<StructuredResponse<T>>;
}
```

#### Definition of Done
- [ ] `src/openrouter.ts` exports `OpenRouterClient` class
- [ ] Client supports all 4 target models
- [ ] Structured output works with JSON schema validation
- [ ] Rate limiting prevents 429 errors
- [ ] Each request returns cost and latency metrics
- [ ] Unit tests cover success, failure, and retry paths

#### Validation
```bash
npm run test:openrouter -- --model google/gemini-2.5-flash-lite
npm run test:openrouter -- --model deepseek/deepseek-chat-v3.1
# Verify structured output parses correctly
```

---

### Task 2: Structured Output Schemas
**Files:** `src/schemas.ts` (new), `src/types.ts`

Define JSON schemas for all LLM responses:

```typescript
export const ProposalResponseSchema = {
  type: "object",
  properties: {
    proposal: { 
      type: "string", 
      enum: ["Low", "Medium", "High"] 
    },
    reasoning: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    belief_state: {
      type: "object",
      properties: {
        own_safety_belief: { type: "number" },
        opponent_cooperation_belief: { type: "number" }
      }
    }
  },
  required: ["proposal", "reasoning"]
};

export const ReviewResponseSchema = {
  type: "object",
  properties: {
    decision: { 
      type: "string", 
      enum: ["Accept", "Reject", "Modify"] 
    },
    counter_proposal: { 
      type: "string", 
      enum: ["Low", "Medium", "High", null] 
    },
    reasoning: { type: "string" },
    trust_assessment: { type: "number", minimum: 0, maximum: 1 }
  },
  required: ["decision", "reasoning"]
};
```

#### Definition of Done
- [ ] `src/schemas.ts` exports `ProposalResponseSchema` and `ReviewResponseSchema`
- [ ] Schemas include reasoning field for causal tracing
- [ ] Schemas include confidence/trust metrics for analysis
- [ ] All schema fields have proper types and constraints
- [ ] TypeScript types generated from schemas match runtime validation

#### Validation
```bash
npx ajv validate -s schemas/proposal.json -d test-response.json
npm run build  # No type errors
```

---

### Task 3: Wide Event Logging Infrastructure
**Files:** `src/logging.ts` (new), `src/types.ts`

Following the [wide events / canonical log lines](https://loggingsucks.com/) pattern: emit one comprehensive, high-cardinality, high-dimensionality event per agent decision. Not scattered log statements — one structured record with all context.

#### Core Principles

1. **One event per decision** — Not 5 log lines, one wide event with 30+ fields
2. **High cardinality** — Include unique identifiers (run_id, episode, agent, request_id) for precise querying
3. **High dimensionality** — Include all context: karma, beliefs, model, prompt, response, metrics
4. **Build throughout, emit once** — Accumulate context during decision-making, emit single event at the end
5. **JSONL format** — One JSON object per line for streaming and easy analysis

#### Wide Event Schema

Each agent decision emits one event with this structure:

```typescript
interface DecisionEvent {
  // Identity (high cardinality - enables precise queries)
  run_id: string;           // Unique simulation run
  episode: number;
  round: number;
  agent_id: string;         // "a" or "b"
  decision_id: string;      // Unique decision identifier
  
  // Timing
  timestamp: string;        // ISO 8601
  
  // Model context
  model: {
    id: string;             // "google/gemini-2.5-flash-lite"
    temperature: number;
  };
  
  // Game state at decision time
  state: {
    karma: number;
    opponent_karma: number;
    beliefs: NestedBelief;
    round_history: RoundSummary[];  // Previous rounds this episode
  };
  
  // Input
  prompt: {
    template: string;       // Which prompt template used
    hash: string;           // SHA256 of full prompt (for dedup)
    token_count: number;
  };
  
  // Decision made
  action: {
    type: "propose" | "review";
    value: string;          // "Low", "Accept", etc.
    reasoning: string;      // Model's explanation (crucial for analysis)
    confidence: number;
  };
  
  // Outcome (filled after resolution)
  outcome: {
    accepted: boolean;
    final_protocol?: string;
    payoff?: number;
    karma_delta: number;
    breach_occurred?: boolean;
  };
  
  // Metrics
  metrics: {
    latency_ms: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
  
  // Feature flags / experiment context
  experiment: {
    condition: string;      // "baseline" | "reputation"
    seed: number;
  };
}
```

#### Implementation Pattern

Build the event throughout the decision lifecycle, emit once at the end:

```typescript
class DecisionEventBuilder {
  private event: Partial<DecisionEvent>;
  
  constructor(runId: string, episode: number, round: number, agentId: string) {
    this.event = {
      run_id: runId,
      episode,
      round,
      agent_id: agentId,
      decision_id: `${runId}-${episode}-${round}-${agentId}`,
      timestamp: new Date().toISOString(),
    };
  }
  
  setModel(model: string, temperature: number): this { ... }
  setState(karma: number, opponentKarma: number, beliefs: NestedBelief): this { ... }
  setPrompt(template: string, fullPrompt: string): this { ... }
  setAction(type: string, value: string, reasoning: string, confidence: number): this { ... }
  setOutcome(accepted: boolean, karmaChange: number, ...): this { ... }
  setMetrics(latencyMs: number, tokens: TokenUsage, cost: number): this { ... }
  
  emit(): DecisionEvent {
    // Validate required fields present
    // Write to JSONL
    return this.event as DecisionEvent;
  }
}
```

#### Logger Implementation

```typescript
export class WideEventLogger {
  private buffer: DecisionEvent[] = [];
  private outputPath: string;
  
  constructor(runId: string) {
    this.outputPath = `results/${runId}/decisions.jsonl`;
  }
  
  log(event: DecisionEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }
  
  async flush(): Promise<void> {
    const lines = this.buffer.map(e => JSON.stringify(e)).join('\n');
    await fs.appendFile(this.outputPath, lines + '\n');
    this.buffer = [];
  }
  
  // Analytics queries on the logged data
  getSummary(): RunSummary {
    return {
      totalDecisions: count,
      totalCost: sum(cost_usd),
      avgLatency: avg(latency_ms),
      decisionDistribution: groupBy(action.value),
      cooperationRate: ...,
    };
  }
}
```

#### Query Examples

With wide events, you query structured data, not grep strings:

```sql
-- All defections by a specific model
SELECT * FROM decisions 
WHERE model.id = 'deepseek/deepseek-chat-v3.1' 
  AND action.value = 'Reject';

-- Cooperation rate by karma level
SELECT 
  FLOOR(state.karma / 10) * 10 as karma_bucket,
  AVG(CASE WHEN action.value != 'Reject' THEN 1 ELSE 0 END) as coop_rate
FROM decisions
GROUP BY karma_bucket;

-- Find decisions where low karma correlated with defection
SELECT * FROM decisions
WHERE state.karma < 30 
  AND action.value = 'Reject'
  AND action.reasoning LIKE '%trust%';
```

#### Tail Sampling (for large runs)

For proof-of-life runs, keep 100% of events. For larger experiments, implement tail sampling:

```typescript
function shouldSample(event: DecisionEvent): boolean {
  // Always keep errors/failures
  if (event.outcome.breach_occurred) return true;
  
  // Always keep interesting karma states
  if (event.state.karma < 20 || event.state.karma > 90) return true;
  
  // Always keep rejections (defections are interesting)
  if (event.action.value === 'Reject') return true;
  
  // Sample the rest at 10%
  return Math.random() < 0.10;
}
```

#### Definition of Done
- [ ] `src/logging.ts` exports `WideEventLogger` and `DecisionEventBuilder` classes
- [ ] Each decision emits exactly one wide event (not multiple log lines)
- [ ] Events include all fields from the schema above
- [ ] Events written in JSONL format to `results/<run-id>/decisions.jsonl`
- [ ] Logger buffers writes for performance, flushes on episode end
- [ ] Summary stats available: total cost, avg latency, decision distribution
- [ ] Events are append-only and safe for long runs

#### Validation
```bash
# Run simulation and check event structure
npm run simulate -- --episodes 5 --model google/gemini-2.5-flash-lite
cat results/latest/decisions.jsonl | head -1 | jq '.'

# Verify all required fields present
cat results/latest/decisions.jsonl | jq -s 'map(keys) | add | unique | length'
# Should be 30+ fields

# Verify one event per decision (not scattered logs)
cat results/latest/decisions.jsonl | wc -l
# Should equal: episodes × rounds × 2 (one per agent per round)
```

---

### Task 4: Causal Tracing
**Files:** `src/tracing.ts` (new), `src/prompts.ts`

Capture the full decision chain for post-hoc analysis. The wide events already contain the reasoning — this task creates a per-episode trace that links decisions together.

```typescript
interface CausalTrace {
  run_id: string;
  episode: number;
  
  // The causal chain (ordered list of decisions)
  decisions: DecisionEvent[];
  
  // Episode outcome
  outcome: {
    final_protocol: string;
    breach_occurred: boolean;
    payoffs: { a: number; b: number };
    converged: boolean;
    rounds_to_convergence: number;
    karma_deltas: { a: number; b: number };
  };
  
  // Cross-decision analysis
  analysis: {
    belief_trajectory: BeliefState[];  // How beliefs evolved
    cooperation_score: number;          // 0-1 measure of mutual cooperation
    key_turning_point?: {               // If collapse occurred, when?
      round: number;
      trigger_decision: string;
      reasoning: string;
    };
  };
}
```

Key insight: The `reasoning` field from structured output is the model's explanation of its decision — crucial for understanding cooperation/defection dynamics.

#### Definition of Done
- [ ] `src/tracing.ts` exports `CausalTracer` class
- [ ] Each episode produces a complete causal trace JSON
- [ ] Traces link: beliefs → prompt → reasoning → action → outcome
- [ ] Traces stored in `results/<run-id>/traces/<episode>.json`
- [ ] Traces are human-readable (pretty-printed JSON)
- [ ] Analysis can reconstruct decision logic from traces

#### Validation
```bash
npm run simulate -- --episodes 1 --trace
cat results/latest/traces/episode-0.json | jq '.decisions[0].action.reasoning'
cat results/latest/traces/episode-0.json | jq '.analysis.key_turning_point'
```

---

### Task 5: Multi-Model Comparison Runner
**Files:** `src/compare.ts` (new), `src/cli.ts`

Run identical scenarios across all models:

```typescript
interface ComparisonConfig {
  models: string[];
  episodes_per_model: number;
  seed: number;  // Same seed for fair comparison
  scenarios: Scenario[];
}

interface ComparisonResults {
  by_model: {
    [model: string]: {
      avg_cooperation_rate: number;
      avg_payoff: number;
      avg_karma_delta: number;
      collapse_rate: number;  // Episodes ending in mutual defection
      cost_total: number;
      latency_avg_ms: number;
    }
  };
  head_to_head: {
    // Model A as proposer vs Model B as reviewer
    [matchup: string]: MatchupStats;
  };
}
```

#### Definition of Done
- [ ] `src/compare.ts` exports `runComparison()` function
- [ ] CLI supports `npm run compare -- --models "gemini,deepseek,kimi,mistral"`
- [ ] Same random seed used across all models for fair comparison
- [ ] Results include per-model aggregates and head-to-head matchups
- [ ] Cost tracking shows total spend per model
- [ ] Comparison summary saved to `results/<run-id>/comparison.json`

#### Validation
```bash
npm run compare -- --episodes 10 --seed 12345
cat results/latest/comparison.json | jq '.by_model | keys'
# Should show all 4 models
```

---

### Task 6: Visualization Dashboard
**Files:** `src/visualize.ts` (new), `viz/` directory

Generate HTML visualizations from run data. This task is exploratory — we'll iterate based on what insights emerge from the data.

#### Planned Visualizations

1. **Karma Trajectories** — Line chart of karma over episodes per agent, colored by model
2. **Cooperation Dynamics** — Heatmap of cooperation rates by proposer×reviewer model
3. **Collapse Detection** — Scatter plot identifying collapsed episodes (mutual defection or both karma < 30)
4. **Reasoning Analysis** — Frequency chart of reasoning patterns, grouped by cooperative vs defection decisions

Implementation: Generate static HTML with embedded charts (Recharts or Chart.js).

#### Definition of Done
- [ ] `npm run visualize` generates `results/<run-id>/dashboard.html`
- [ ] Dashboard includes at least karma trajectories and cooperation heatmap
- [ ] Charts are interactive (hover for details)
- [ ] Dashboard is self-contained (no external dependencies)

#### Validation
```bash
npm run visualize -- --input results/latest
open results/latest/dashboard.html
# Manual inspection: charts render and show meaningful data
```

---

## Environment Setup

```bash
# Add to .bashrc or load-secrets
export OPENROUTER_API_KEY=$(sops -d ~/dotfiles/secrets/secrets.enc.yaml | yq '.api.openrouter_token')

# Or create .env file (gitignored)
echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY" > .env
```

---

## Success Criteria

After implementation:
1. Run `npm run compare -- --episodes 20 --seed 42` with all 4 models
2. Total cost < $1 for proof-of-life run
3. Wide events enable queries like "show all defections where karma < 30"
4. Traces allow reconstruction of why each decision was made
5. Dashboard shows clear behavioral differences between models
