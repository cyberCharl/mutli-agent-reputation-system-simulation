# OpenRouter Integration & Research Infrastructure Plan

*Created 2026-02-07*

---

## Goal

Transform the Karmic Debt simulation from a prototype into research-ready infrastructure by:
1. Integrating OpenRouter for multi-model comparisons
2. Implementing structured output for reliable parsing
3. Building robust data capture and logging
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
**Effort:** 2-3 hours

Create OpenRouter client with:
- Multi-model support via model parameter
- Structured output using `response_format` with JSON schema
- Rate limiting integration (existing p-limit)
- Error handling with retries and backoff
- Cost tracking per request

```typescript
// src/openrouter.ts
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
- [ ] Unit tests cover success/failure/retry paths

#### Validation
```bash
# Test with each model
npm run test:openrouter -- --model google/gemini-2.5-flash-lite
npm run test:openrouter -- --model deepseek/deepseek-chat-v3.1

# Verify structured output
curl test output | jq '.proposal' # Should be valid ProtocolLevel
```

---

### Task 2: Structured Output Schemas
**Files:** `src/schemas.ts` (new), `src/types.ts`
**Effort:** 1-2 hours

Define JSON schemas for all LLM responses:

```typescript
// src/schemas.ts
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
# Validate schemas are valid JSON Schema
npx ajv validate -s schemas/proposal.json -d test-response.json

# Type generation check
npm run build  # No type errors
```

---

### Task 3: Decision Logging Infrastructure
**Files:** `src/logging.ts` (new), `src/types.ts`
**Effort:** 2-3 hours

Structured logging for every decision point:

```typescript
// src/logging.ts
interface DecisionLog {
  timestamp: string;
  episode: number;
  round: number;
  agent: string;
  model: string;
  action_type: "propose" | "review";
  
  // Context
  karma: number;
  opponent_karma: number;
  belief_state: NestedBelief;
  
  // Input
  prompt_hash: string;  // For deduplication
  prompt_tokens: number;
  
  // Output
  decision: string;
  reasoning: string;
  confidence: number;
  
  // Metrics
  latency_ms: number;
  cost_usd: number;
  completion_tokens: number;
}

export class DecisionLogger {
  constructor(outputPath: string);
  log(decision: DecisionLog): void;
  flush(): Promise<void>;
  getSummary(): LogSummary;
}
```

Output format: JSONL (one JSON object per line) for easy streaming and analysis.

#### Definition of Done
- [ ] `src/logging.ts` exports `DecisionLogger` class
- [ ] Logs written in JSONL format to `results/<run-id>/decisions.jsonl`
- [ ] Each log entry includes full context (karma, beliefs, prompt hash)
- [ ] Logger buffers writes for performance, flushes on episode end
- [ ] Summary stats available: total cost, avg latency, decision distribution
- [ ] Logs are append-only (safe for long runs)

#### Validation
```bash
# Run simulation and check logs
npm run simulate -- --episodes 5 --model google/gemini-2.5-flash-lite
cat results/latest/decisions.jsonl | head -5 | jq '.'

# Verify all required fields present
cat results/latest/decisions.jsonl | jq -s 'map(keys) | add | unique'
```

---

### Task 4: Causal Tracing
**Files:** `src/tracing.ts` (new), `src/prompts.ts`
**Effort:** 2-3 hours

Capture the full decision chain for post-hoc analysis:

```typescript
// src/tracing.ts
interface CausalTrace {
  run_id: string;
  episode: number;
  round: number;
  
  // The causal chain
  chain: {
    agent: string;
    input_beliefs: NestedBelief;
    karma_context: { own: number; opponent: number };
    prompt_template: string;
    prompt_variables: Record<string, any>;
    
    model_output: {
      raw_response: string;
      parsed: StructuredResponse;
      reasoning: string;
    };
    
    action_taken: string;
    belief_update: NestedBelief;  // After observing outcome
    karma_delta: number;
  }[];
  
  // Episode outcome
  outcome: {
    final_protocol: string;
    breach_occurred: boolean;
    payoffs: { a: number; b: number };
    converged: boolean;
    rounds_to_convergence: number;
  };
}
```

Key insight: Store the **reasoning** field from structured output — this is the model's explanation of its decision, crucial for understanding cooperation/defection dynamics.

#### Definition of Done
- [ ] `src/tracing.ts` exports `CausalTracer` class
- [ ] Each episode produces a complete causal trace JSON
- [ ] Traces link: beliefs → prompt → reasoning → action → outcome
- [ ] Traces stored in `results/<run-id>/traces/<episode>.json`
- [ ] Traces are human-readable (pretty-printed JSON)
- [ ] Analysis script can reconstruct decision logic from traces

#### Validation
```bash
# Generate trace
npm run simulate -- --episodes 1 --trace

# Inspect trace
cat results/latest/traces/episode-0.json | jq '.chain[0].model_output.reasoning'

# Verify chain completeness
cat results/latest/traces/episode-0.json | jq '.chain | length'  # Should match round count * 2
```

---

### Task 5: Multi-Model Comparison Runner
**Files:** `src/compare.ts` (new), `src/cli.ts`
**Effort:** 2-3 hours

Run identical scenarios across all models:

```typescript
// src/compare.ts
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
# Run comparison
npm run compare -- --episodes 10 --seed 12345

# Check results
cat results/latest/comparison.json | jq '.by_model | keys'
# Should show all 4 models

# Verify same scenarios used
cat results/latest/comparison.json | jq '.config.seed'
```

---

### Task 6: Visualization Dashboard
**Files:** `src/visualize.ts` (new), `viz/` directory
**Effort:** 4-6 hours

Generate HTML visualizations from run data:

#### 6.1 Karma Trajectories
Line chart showing karma over episodes for each agent, colored by model.
- X-axis: Episode number
- Y-axis: Karma (0-100)
- Lines: One per agent, grouped by model
- Annotations: Mark breach events

#### 6.2 Cooperation Dynamics
Heatmap of action frequencies:
- Rows: Proposer model
- Columns: Reviewer model  
- Cells: Cooperation rate (color intensity)

#### 6.3 Collapse Detection
Scatter plot identifying "collapse" episodes:
- X-axis: Episode
- Y-axis: Cumulative payoff
- Color: Green (cooperative) / Red (collapsed)
- Define collapse: Both agents below karma 30 OR mutual defection

#### 6.4 Reasoning Analysis
Word cloud or frequency chart of reasoning patterns:
- Extract key phrases from reasoning fields
- Group by cooperative vs defection decisions
- Identify model-specific reasoning patterns

Implementation: Use Recharts + React for interactive charts, output as static HTML.

#### Definition of Done
- [ ] `npm run visualize` generates `results/<run-id>/dashboard.html`
- [ ] Dashboard includes karma trajectories chart
- [ ] Dashboard includes cooperation heatmap
- [ ] Dashboard includes collapse detection scatter
- [ ] Dashboard includes reasoning frequency chart
- [ ] Charts are interactive (hover for details)
- [ ] Dashboard is self-contained (no external dependencies)

#### Validation
```bash
# Generate viz
npm run visualize -- --input results/latest

# Open in browser
open results/latest/dashboard.html

# Verify all charts render
# Manual inspection: 4 chart sections visible
```

---

## Implementation Order

```
Task 1 (OpenRouter Client)
    ↓
Task 2 (Schemas) ←──────────────┐
    ↓                           │
Task 3 (Logging) ───────────────┤
    ↓                           │
Task 4 (Tracing) ───────────────┘
    ↓
Task 5 (Comparison Runner)
    ↓
Task 6 (Visualizations)
```

Tasks 2, 3, 4 can be developed in parallel after Task 1.

---

## Environment Setup

```bash
# Add to .bashrc or load-secrets
export OPENROUTER_API_KEY=$(sops -d ~/dotfiles/secrets/secrets.enc.yaml | yq '.api.openrouter_token')

# Or create .env file (gitignored)
echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY" > .env
```

---

## Effort Summary

| Task | Effort | Dependencies |
|------|--------|--------------|
| 1. OpenRouter Client | 2-3h | None |
| 2. Structured Schemas | 1-2h | None |
| 3. Decision Logging | 2-3h | Task 1 |
| 4. Causal Tracing | 2-3h | Task 1, 2 |
| 5. Comparison Runner | 2-3h | Task 1-4 |
| 6. Visualizations | 4-6h | Task 3-5 |

**Total: 13-20 hours**

Recommended first session: Tasks 1-3 (~6-8h) — gets structured output working with logging.

---

## Success Criteria

After implementation:
1. Run `npm run compare -- --episodes 20 --seed 42` with all 4 models
2. Total cost < $1 for proof-of-life run
3. Dashboard shows clear behavioral differences between models
4. Traces allow reconstruction of why each decision was made
5. Data format supports future statistical analysis (P2 items from main PLAN.md)
