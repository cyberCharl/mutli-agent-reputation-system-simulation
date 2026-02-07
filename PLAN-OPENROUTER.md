# OpenRouter Integration Plan

*Created 2026-02-07*

---

## Goal

Integrate OpenRouter for multi-model simulation runs with structured output for reliable parsing.

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

### Task 3: Multi-Model Comparison Runner
**Files:** `src/compare.ts` (new), `src/cli.ts`

Run identical scenarios across all models:

```typescript
interface ComparisonConfig {
  models: string[];
  episodes_per_model: number;
  seed: number;  // Same seed for fair comparison
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

## Environment Setup

```bash
# Add to .bashrc or load-secrets
export OPENROUTER_API_KEY=$(sops -d ~/dotfiles/secrets/secrets.enc.yaml | yq '.api.openrouter_token')

# Or create .env file (gitignored)
echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY" > .env
```

---

## Out of Scope (Separate Planning)

The following require further ideation and research before implementation:

- **Wide Event Logging** — Structured decision logging following canonical log line patterns
- **Causal Tracing** — Linking decisions to outcomes for post-hoc analysis
- **Visualization Dashboard** — Charts for karma trajectories, cooperation dynamics, collapse detection

See `PLAN-OBSERVABILITY.md` (to be created) for these items.

---

## Success Criteria

After implementation:
1. Run `npm run compare -- --episodes 20 --seed 42` with all 4 models
2. Total cost < $1 for proof-of-life run
3. Structured output parses reliably across all models
4. Results JSON shows per-model behavioral differences
