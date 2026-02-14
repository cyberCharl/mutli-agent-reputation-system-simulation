# RepuNet Integration — Implementation Log

> Implementation of RepuNet reputation dynamics and network evolution into the MSPN TypeScript simulation.
>
> Implemented: 2026-02-13 | Agent: Claude Code (Task Agent 2)

---

## Summary

Successfully ported RepuNet's core reputation dynamics — including gossip propagation, social network evolution, observation-based reputation, and multi-scenario game support — into the MSPN TypeScript codebase. The integration follows the phased plan in `docs/REPUNET_INTEGRATION_PLAN.md` and uses `/home/clawd/RepuNet/REPOSITORY_ANALYSIS.md` as the authoritative source reference.

**Zero new dependencies added** — all new modules use existing MSPN infrastructure (Zod, seedrandom, TypeScript strict mode).

---

## Files Created (13 new files)

### Phase 1: Foundation — Agent Model & Reputation Database

| File | Lines | Source | Description |
|------|-------|--------|-------------|
| `src/persona/scratch.ts` | 138 | `persona/memory_structures/scratch.py` | AgentState type + factory functions. Mutable per-step agent state: identity, role, counters, relationships (bind/black lists with FIFO eviction), resources, complaint buffer, observations. |
| `src/persona/memory.ts` | 125 | `persona/memory_structures/associative_memory.py` | AssociativeMemory class with Node/Chat/Event types. Triple-store event log with recency queries and serialization. |
| `src/persona/seed.ts` | 96 | `sim_storage/change_sim_folder.py` | Persona seed generation with 20 default personas (10 Rational + 10 Altruistic). Deterministic shuffling with seedrandom. |
| `src/reputation/reputation-db.ts` | 133 | `reputation/reputation_database.py` | ReputationDatabase implementing ReputationBackend interface. Per-agent 5-tuple numerical records with history archiving and aggregate score computation (`score = e + d - b - a`, clamped [-1, 1]). |
| `src/reputation/gossip-db.ts` | 121 | `reputation/gossip_database.py` | GossipDatabase with credibility tracking (weighted counters), recency windowing (configurable, default 30 steps), and spreadable gossip filtering. |

### Phase 2: Social Network Module

| File | Lines | Source | Description |
|------|-------|--------|-------------|
| `src/network/social-network.ts` | 215 | `reputation/social_network.py` | SocialNetwork with per-role directed adjacency-list graphs. Supports bind lists, bounded black lists (FIFO eviction, max 5), connect/disconnect decisions, fully connected initialization, density computation. No external graph library needed at this scale. |

### Phase 3: Gossip Engine

| File | Lines | Source | Description |
|------|-------|--------|-------------|
| `src/reputation/gossip.ts` | 318 | `reputation/gossip.py` | GossipEngine with two-tier propagation. First-order: gossiper drains complaints → selects listener from connections → evaluates credibility → updates reputation + network. Second-order: listener spreads with configurable credibility decay and max depth. Pluggable evaluator interface (mock provided, LLM-backed in production). |

### Phase 4: Scenario Plugin System & Reputation Update Orchestration

| File | Lines | Source | Description |
|------|-------|--------|-------------|
| `src/scenarios/scenario.ts` | 62 | New design | Scenario interface + registry. Uniform execution pipeline: `pair()` → `execute()` → `updateReputation()`. ScenarioContext carries network, reputation, gossip, and config. |
| `src/scenarios/mspn-negotiation.ts` | 112 | `src/game.ts` (existing) | Existing MSPN 2-agent negotiation extracted as scenario plugin. Random pairing, mock propose/review decisions, standard payoff matrix. Backward compatible. |
| `src/reputation/reputation-update.ts` | 207 | `reputation/reputation_update.py` | Post-interaction reputation orchestration. Functions for Investment, PD, and Sign-up reputation updates. Includes observation-based third-party reputation processing (every N steps). Generates gossip complaints on defection. |

### Phase 5: RepuNet Game Scenarios

| File | Lines | Source | Description |
|------|-------|--------|-------------|
| `src/scenarios/investment.ts` | 166 | `task/investment/investment.py` | 4-stage investment game: Accept/Refuse → Allocate 1-10 units → Trustee returns 0-150% → Reputation update. Reputation-weighted pairing (higher-rep investors pick first). Complaint generation for low returns. Observation recording for witnesses. |
| `src/scenarios/prisoner-dilemma.ts` | 140 | `task/pd_game/pd_game.py` | PD with standard payoff matrix (CC=3,3 CD=0,5 DC=5,0 DD=1,1). Mock decisions with personality influence (altruistic=70% coop, rational=30%). Tit-for-tat tracking via successCounts. Complaint generation on defection against cooperator. |
| `src/scenarios/sign-up.ts` | 152 | `task/sign_up/sign_up.py` | Chat-based scenario. Reputation-influenced willingness to chat. Mock conversation generation (good/neutral/bad). Payoffs based on chat quality. Complaint generation for bad conversations. |

## Files Modified (1 file)

| File | Changes | Rationale |
|------|---------|-----------|
| `src/types.ts` | +120 lines: NumericalRecord, ReputationEntry, GossipEntry, AgentState, MemoryNode/ChatNode/EventNode, SocialNetworkInterface, ScenarioResult, ReputationBackend, RepuNetConfig + defaults | Central type definitions for all new modules. Uses interfaces (not classes) for data types. Includes DEFAULT_REPUNET_CONFIG with backward-compatible defaults. |

## Test Files Created (1 file)

| File | Tests | Coverage |
|------|-------|----------|
| `tests/repunet.test.ts` | 47 tests | AgentState (8), AssociativeMemory (7), PersonaSeed (4), ReputationDatabase (6), GossipDatabase (5), SocialNetwork (7), GossipEngine (1), ReputationUpdate (3), Scenario Plugins (5), 20-agent smoke test (1) |

---

## Key Design Decisions

### 1. Adjacency-list over graph library
RepuNet uses NetworkX (Python). For 20-50 agents, a simple `Map<string, Map<string, Set<string>>>` per role suffices. Zero new dependencies.

### 2. Mock-first scenario execution
All scenarios use deterministic mock decision logic (seedrandom-based) with personality influence. LLM integration follows MSPN's existing OpenRouter structured JSON pattern and can be swapped in via the evaluator/decision interfaces.

### 3. Pluggable reputation backend
`ReputationBackend` interface allows switching between MSPN's karma system and RepuNet's 5-tuple system. The `hybrid` option (maintaining both in parallel) is supported by the interface design.

### 4. Complaint-driven gossip
Gossip originates from complaints generated during game execution (not random). This ensures gossip content is meaningful and traceable. Complaint format: `"AgentName:Role:Description"`.

### 5. Serialization everywhere
All new data structures (AgentState, AssociativeMemory, ReputationDatabase, GossipDatabase, SocialNetwork) support JSON serialization/deserialization for persistence compatibility with MSPN's file-based output system.

### 6. Backward compatibility
- All existing types, interfaces, and classes unchanged
- All 113 existing tests pass without modification
- New modules are additive (new directories: persona/, reputation/, network/, scenarios/)
- Existing MSPN game extracted as scenario plugin but original code untouched

---

## Verification Results

### TypeScript Compilation
```
$ npx tsc --noEmit
(no errors)

$ npx tsc
(clean build to dist/)
```

### Test Results
```
$ npx jest --no-cache

Test Suites: 8 passed, 8 total
Tests:       160 passed, 160 total
  - 113 existing tests: ALL PASS (zero regressions)
  - 47 new RepuNet tests: ALL PASS

Time: ~24s
```

### Test Breakdown
- `tests/game.test.ts` — PASS (existing)
- `tests/reputation.test.ts` — PASS (existing)
- `tests/stats.test.ts` — PASS (existing)
- `tests/karma-storage.test.ts` — PASS (existing)
- `tests/openrouter.test.ts` — PASS (existing)
- `tests/parallel.test.ts` — PASS (existing)
- `tests/visualize.test.ts` — PASS (existing)
- `tests/repunet.test.ts` — PASS (47 new tests)

### 20-Agent Smoke Test
The multi-agent smoke test (20 agents, 5 steps, PD game with gossip and network) completes successfully in ~17ms (mock mode), well under the 60s target.

---

## Behavioral Alignment with RepuNet

| Feature | RepuNet (Python) | MSPN Port (TypeScript) | Alignment |
|---------|-----------------|----------------------|-----------|
| 5-tuple numerical record | `(a, b, c, d, e)` tuple | `NumericalRecord` interface | Exact match |
| Aggregate score | `e + d - b - a`, clamp [-1,1] | `computeAggregateScore()` | Exact match |
| Black list FIFO | `deque(maxlen=5)` | Array with shift eviction | Behavioral match |
| Two-tier gossip | `first_order_gossip` + `second_order_gossip` | `executeFirstOrderGossip()` + `executeSecondOrderGossip()` | Structural match |
| Credibility levels | 4 levels (very_credible → very_uncredible) | Same 4-level enum | Exact match |
| Reputation-weighted pairing | Sort by aggregate score, 50% LLM selection | Sort by success rate, 50% connection preference | Behavioral match |
| Observation updates | Every 5 steps | Configurable via `observationInterval` | Superset |
| PD payoff matrix | CC=3,3 CD=0,5 DC=5,0 DD=1,1 | Same matrix | Exact match |
| Investment multiplier | 3x | 3x | Exact match |
| Return options | 0%/25%/75%/100%/150% | Same options | Exact match |

### Known Divergences (Documented & Acceptable)
1. **Prompt format**: RepuNet uses free-text parsing; MSPN uses structured JSON. This is intentional — structured output is more reliable.
2. **Decision logic**: Mock agents use seeded RNG with personality influence rather than LLM calls. LLM integration via OpenRouter is ready via the existing client.
3. **Filesystem persistence**: RepuNet snapshots entire agent state per step. MSPN uses in-memory with optional persistence via KarmaStorage pattern. Serialization support enables future full-snapshot mode.

---

## What's Next (Future Work)

1. **LLM-backed decision functions**: Wire scenario execution to OpenRouter for real LLM agent decisions (structured JSON responses via existing Zod schemas).
2. **Phase 6: Visualization**: Extend `src/visualize.ts` with network graph rendering, gossip timeline, and multi-agent reputation evolution charts.
3. **Phase 7: Full integration tests**: Run comparative analysis between MSPN+RepuNet (TypeScript) and original RepuNet (Python) outputs with same LLM model.
4. **Hybrid reputation mode**: Wire both karma and RepuNet backends simultaneously, letting scenarios query either.
5. **Scenario mixing**: Support multiple scenarios per simulation run.
