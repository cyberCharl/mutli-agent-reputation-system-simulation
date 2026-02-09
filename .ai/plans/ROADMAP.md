# Karmic Debt — Project Roadmap

*Created 2026-02-08*

---

## Current State Assessment

### What works
- **`compare.ts`** uses `OpenRouterClient` with structured output (`response_format: json_schema`), Zod validation, retries, and cost tracking. LLM responses parse reliably into typed `ProposalResponse` / `ReviewResponse` objects.
- **Reputation system** persists across episodes within a run, with mutex-guarded updates for parallel execution.
- **Statistical analysis** (paired t-test, bootstrap CI) runs on A/B test results.
- **Schemas** already defined in `src/schemas.ts` — both Zod (runtime validation) and JSON Schema (for `response_format`).

### What's broken
- **`simulator.ts`** uses `LLMModel` (in `agent.ts`) which calls the raw OpenAI SDK without structured output. It does manual `JSON.parse()` on freeform LLM text, validates against a trivial `z.object({ action: z.string() })` schema, then string-matches into enums. This fails frequently, triggering the `catch` block and falling back to mock agents. **The A/B test — the primary experiment — never actually uses real LLM reasoning.**

### The core problem
Two parallel code paths exist for running episodes:
1. `compare.ts` → `OpenRouterClient.complete()` → structured output → **works**
2. `simulator.ts` → `Agent` → `LLMModel` → raw OpenAI SDK → `JSON.parse(freetext)` → **breaks, falls back to mock**

The schemas, client, and validation infrastructure are already built. They just aren't wired into the A/B test path.

---

## Phase 1: Structured Output Port

**Goal:** Make `simulator.ts` use the same structured output pipeline as `compare.ts` so the A/B test runs with real LLM agents.

**Effort:** 4-6 hours

### 1.1 Refactor `LLMModel` to use `OpenRouterClient`

**File:** `src/agent.ts`

Replace the raw OpenAI SDK usage in `LLMModel` with `OpenRouterClient`:

- Remove `OpenAI` import and `this.client` (the raw SDK client)
- Create an `OpenRouterClient` instance instead (when not in mock mode)
- In `decidePropose()`: call `this.openRouterClient.complete()` with `ProposalResponseJsonSchema` + `ProposalResponseSchema` (Zod), extract `.data.proposal`, map to `ProtocolLevel`
- In `decideReview()`: call `this.openRouterClient.complete()` with `ReviewResponseJsonSchema` + `ReviewResponseSchema` (Zod), extract `.data.decision` and `.data.counter_proposal`, map to `ReviewAction`
- Remove the old `rateLimitedApiCall` wrapper (OpenRouterClient has its own rate limiting)
- Keep mock mode logic untouched

### 1.2 Update response mapping

**File:** `src/agent.ts`

The structured output returns `"Low"` / `"Medium"` / `"High"` (capitalized, from schema enum) while `ProtocolLevel` uses `"low"` / `"medium"` / `"high"`. Add mapping functions (or reuse `mapProposalToProtocol` / `mapDecisionToReviewAction` from `compare.ts`).

### 1.3 Capture reasoning and confidence

**File:** `src/agent.ts`, `src/types.ts`

The structured schemas return `reasoning`, `confidence`, `belief_state`, and `trust_assessment` — data that the current `LLMModel` discards. At minimum, store `reasoning` on the agent or return it alongside the action for downstream logging. This becomes critical for Phase 2.

Options:
- Return a richer object from `decidePropose` / `decideReview` instead of bare enum values
- Or store last response metadata on the `LLMModel` instance for later retrieval

### 1.4 Validate end-to-end

Run `simulator.ts` with a real API key and confirm:
- LLM responses parse without falling back to mock
- A/B test completes with real LLM decisions
- Results show behavioral variance between baseline and reputation conditions

### Acceptance Criteria
- [ ] `LLMModel` uses `OpenRouterClient` for all API calls (no raw OpenAI SDK)
- [ ] `decidePropose()` returns structured `ProposalResponse` data via `response_format: json_schema`
- [ ] `decideReview()` returns structured `ReviewResponse` data via `response_format: json_schema`
- [ ] No `"LLM proposal failed, using mock"` warnings when a valid API key is provided
- [ ] Reasoning text is captured (not discarded) for each decision
- [ ] All existing tests pass
- [ ] A/B test completes a 10-episode run with real LLM agents (no mock fallback)

### Risks
- Some OpenRouter models may not support `response_format: json_schema` — the existing `SUPPORTED_MODELS` list has been verified, but `simulator.ts` currently hardcodes `google/gemini-2.5-flash-lite` and `mistralai/mistral-small-3.1-24b-instruct` which are both on the verified list.
- Rate limiting needs to work across both agents in the same episode (they share the same API key). The current `apiLimiter` in `agent.ts` is per-process; `OpenRouterClient` has its own per-instance limiter. May need a shared limiter or accept sequential calls within an episode.

---

## Phase 2: Causal Data Collection

**Goal:** Capture the full decision context (before/during/after) for every agent action, enabling causal analysis and counterfactual reasoning.

**Effort:** 8-12 hours

**Depends on:** Phase 1 (need structured output to capture reasoning)

### 2.1 Define CausalDecisionRecord schema

**File:** `src/types.ts` (or new `src/causal.ts`)

```typescript
interface CausalDecisionRecord {
  // Identity
  traceId: string;           // Links all decisions in an episode
  decisionId: string;        // This specific decision
  parentDecisionId?: string; // Causal parent (proposer → reviewer)

  // Before (what agent observed)
  informationSet: {
    ownKarma: number;
    opponentKarma: number;
    beliefs: NestedBelief;
    historyVisible: string[];
  };

  // Decision (intervention point)
  action: {
    type: 'propose' | 'review';
    value: string;
    reasoning: string;       // Model's stated rationale
    alternatives: string[];  // What else was possible
    isForced?: boolean;      // For do-operator interventions (reputation blocking)
  };

  // Outcome
  outcome: {
    counterpartyAction: string;
    finalProtocol?: string;
    payoff: number;
    expectedPayoff: number;
    surprise: number;        // |actual - expected|
  };

  // After (enables counterfactuals)
  beliefUpdate: {
    karmaDelta: number;
    beliefDelta: Partial<NestedBelief>;
    updateMagnitude: number;
  };
}
```

### 2.2 Instrument `Agent.act()` to emit decision records

**Files:** `src/agent.ts`, `src/simulator.ts`

Before each decision:
- Snapshot the agent's information set (own karma, opponent karma, beliefs, visible history)
- Generate `traceId` (per episode) and `decisionId` (per action)
- Link reviewer's `parentDecisionId` to proposer's `decisionId`

After each decision:
- Record the action taken, reasoning (from structured output), and alternatives (from schema enum)
- Flag if action was forced by reputation consequences (`applyConsequences` changed it)

After episode resolution:
- Back-fill `outcome` fields (counterparty action, final protocol, payoff)
- Compute `surprise` = |actual payoff - expected payoff| (expected from belief state)
- Record `beliefUpdate` (karma delta, belief changes)

### 2.3 Create CausalDecisionLog collector

**File:** `src/causal.ts` (new)

A simple collector class:
- Accumulates `CausalDecisionRecord[]` per episode
- Supports serialization to JSON (for per-episode files)
- Supports NDJSON append mode (for streaming analysis)
- Generates `traceId` from episode seed for reproducibility

### 2.4 Wire into episode runner

**File:** `src/simulator.ts`

In `runEpisode()`:
- Create a `CausalDecisionLog` at episode start
- Pass it to `Agent.act()` calls (or have agent emit records that the runner collects)
- After `game.resolveExecution()`, back-fill outcome data on all records
- Save alongside episode results in the run directory

### 2.5 Persist causal data

**File:** `src/simulator.ts`

Output structure:
```
results/<run-id>/
  summary.json
  baseline/
    episodes.json
    episode_0.json
    episode_0_decisions.ndjson   ← NEW
  reputation/
    episodes.json
    episode_0.json
    episode_0_decisions.ndjson   ← NEW
  decisions/                     ← NEW: aggregated for analysis
    all_decisions.ndjson
```

### Acceptance Criteria
- [ ] `CausalDecisionRecord` type defined with all fields from the schema above
- [ ] Every propose/review action in `runEpisode()` produces a decision record
- [ ] Records include the agent's full information set at decision time
- [ ] Records include the model's stated reasoning (from structured output)
- [ ] `isForced` flag is set when `applyConsequences()` overrides the agent's choice
- [ ] `parentDecisionId` links reviewer decisions to the proposer decision they respond to
- [ ] Outcome fields (payoff, surprise) are back-filled after episode resolution
- [ ] Decision records are persisted as NDJSON alongside episode results
- [ ] Existing test suite passes with no regressions

### Design considerations
- **Key insight:** "The difference between what happened and why is capturing the agent information state at decision time, not just the action taken." Every record must snapshot what the agent knew, not just what it did.
- Keep records append-only and immutable after back-fill — never mutate in place.
- Use NDJSON (one JSON object per line) for decision logs — enables streaming `jq` analysis and avoids loading entire episodes into memory.
- `traceId` should be deterministic from the episode seed so records can be reproduced.

---

## Phase 3: Base Runner Refactor (Optional)

**Goal:** Extract the shared episode execution loop from `compare.ts` and `simulator.ts` into a common base, reducing duplication and ensuring both paths stay in sync.

**Effort:** 4-6 hours

**Priority:** Low — only pursue if Phase 1 and 2 are complete and the duplication causes maintenance pain.

### 3.1 Identify shared logic

Both `compare.ts:runMatchupEpisode()` and `simulator.ts:runEpisode()` share this structure:
1. Create `MSPNGame` with seed
2. Loop up to 3 rounds:
   a. Get game state
   b. Format proposal prompt → call LLM → map response → `game.setProposal()`
   c. Get game state
   d. Format review prompt → call LLM → map response → `game.setReview()`
   e. Check agreement → break or `game.resetForNewRound()`
3. `game.resolveExecution()`
4. Compute payoffs and metadata

The differences:
- **compare.ts** uses `OpenRouterClient` directly, tracks cost/latency per-model
- **simulator.ts** uses `Agent` wrapper (adds reputation consequences, payoff penalties)
- **simulator.ts** has reputation system integration, karma loading/saving
- **compare.ts** runs pairwise model matchups; **simulator.ts** runs A/B baseline vs treatment

### 3.2 Design the base runner

**File:** `src/runner.ts` (new)

```typescript
interface EpisodeRunner {
  // Strategy methods — overridden by each variant
  getProposal(state: GameState, round: number): Promise<ProposalResult>;
  getReview(state: GameState, proposal: ProtocolLevel, round: number): Promise<ReviewResult>;
  onEpisodeComplete(result: RawEpisodeResult): void;
}

// Shared episode execution loop
async function executeEpisode(
  seed: string,
  runner: EpisodeRunner,
  maxRounds?: number
): Promise<RawEpisodeResult>;
```

- `ComparisonRunner` implements `EpisodeRunner` — wraps `OpenRouterClient` calls, tracks cost
- `SimulationRunner` implements `EpisodeRunner` — wraps `Agent` calls, applies reputation

### 3.3 Migrate both paths

1. Refactor `compare.ts:runMatchupEpisode()` to use `executeEpisode()` + `ComparisonRunner`
2. Refactor `simulator.ts:runEpisode()` to use `executeEpisode()` + `SimulationRunner`
3. Verify both produce identical results to pre-refactor versions

### Acceptance Criteria
- [ ] `src/runner.ts` exports `executeEpisode()` and the `EpisodeRunner` interface
- [ ] `compare.ts` uses the shared runner (produces identical results)
- [ ] `simulator.ts` uses the shared runner (produces identical results)
- [ ] Episode loop logic exists in exactly one place
- [ ] Both paths still support their unique features (cost tracking, reputation, etc.)
- [ ] All tests pass

### Risks
- The two paths have diverged enough that unifying them may force awkward abstractions. If the interface feels forced, it may be better to keep them separate and just ensure `simulator.ts` uses `OpenRouterClient` (Phase 1 accomplishes this).
- Phase 2 (causal records) adds instrumentation hooks that may complicate the base runner interface. Consider doing Phase 3 *after* Phase 2 stabilizes.

---

## Summary

| Phase | Goal | Effort | Priority | Depends On |
|-------|------|--------|----------|------------|
| **1: Structured Output Port** | Fix simulator to use real LLM agents | 4-6 hrs | **P0** | — |
| **2: Causal Data Collection** | Capture decision context for analysis | 8-12 hrs | **P1** | Phase 1 |
| **3: Base Runner Refactor** | Reduce code duplication | 4-6 hrs | **P2** | Phase 1, ideally Phase 2 |

**Total estimated effort:** 16-24 hours across all phases.

**Recommended execution order:**
1. Phase 1 first — unblocks real LLM experimentation (the primary research goal)
2. Phase 2 second — adds the causal instrumentation that makes experiments scientifically valuable
3. Phase 3 if/when maintenance burden justifies it
