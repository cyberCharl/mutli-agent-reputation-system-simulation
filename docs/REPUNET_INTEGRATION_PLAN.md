# RepuNet Integration Plan — MSPN Simulation

> Concrete phased plan to port/integrate RepuNet reputation dynamics and network evolution into the MSPN TypeScript simulation project.
>
> Generated: 2026-02-13

---

## 1. Executive Summary

This plan describes how to integrate RepuNet's multi-agent reputation dynamics — including gossip propagation, social network evolution, observation-based reputation, and multi-scenario game support — into the existing MSPN TypeScript codebase. The integration enriches MSPN's existing karma-based reputation system with RepuNet's richer models while preserving MSPN's strengths (causal logging, A/B testing, statistical analysis, parallel execution).

*{ I want us to mimic the below key structural decisions made in repunet: 

- **LLM-as-decision-engine**: Every non-trivial agent decision (invest, cooperate, evaluate gossip, connect/disconnect) is an LLM call with structured prompt templates.
- **Filesystem-based persistence**: Each simulation step is a full snapshot in `sim_storage/<run>/step_N/`, enabling resume, replay, and diff analysis.
- **Combinatorial ablation**: 4 variants per scenario (with/without reputation x with/without gossip) as separate code paths to keep LLM prompts clean.
- **NetworkX social graphs**: Directed graphs model agent relationships per role, with bind/black lists governing connection state.

}*

### Current State Comparison

| Capability | MSPN (Target) | RepuNet (Source) |
|------------|---------------|-----------------|
| Language | TypeScript (strict, ES2022) | Python 3.13 |
| Agent count | 2 (A, B) | 20 (configurable) |
| Reputation model | Single karma score (0-100) | 5-tuple numerical record + narrative |
| Gossip | None | Two-tier with credibility cascade |
| Social network | None | NetworkX directed graphs with bind/black lists |
| Network evolution | None | LLM-driven connect/disconnect decisions |
| Observation | None | Witness-based third-party reputation formation |
| Game scenarios | MSPN protocol negotiation | Investment, Sign-up, Prisoner's Dilemma |
| LLM integration | OpenRouter (structured JSON) | OpenAI-compatible (free-text parsed) |
| Persistence | File-based karma snapshots | Full filesystem snapshots per step |
| Statistical analysis | Paired t-test, bootstrap CI | None (external analysis scripts) |
| Causal logging | Full decision audit trail | None |
| Parallel execution | p-limit concurrency | ThreadPoolExecutor (PD only) |

### Integration Strategy

**Hybrid enrichment** — *{ Pull from Repunet's strengths. The primnary strengths of the MSPN simulation is the game scenario and llm integration. Keeping the statistical analysis separate from the main simulation seems to be a smart decision as well. }*

1. Port RepuNet's reputation model as a *{ replacement to MSPN's simplistic and niave karma system }*
2. Add gossip and social network as new optional modules
3. Scale from 2 agents to N agents, *{ replicating the patterns in Repunet's implementation }*
4. Keep MSPN's *{ causal logging, game scenario, and separate the statistical analysis from the project. }*
5. Mimic the 
---

## 2. Module Mapping

### 2.1 RepuNet → MSPN Type/Module Mapping

| RepuNet Module | RepuNet Class/Function | MSPN Target | Action |
|----------------|----------------------|-------------|--------|
| `persona/persona.py` | `Persona` | `src/agent.ts` → `Agent` | Extend Agent with memory + reputation DB |
| `persona/memory_structures/scratch.py` | `Scratch` | New: `src/persona/scratch.ts` | Port as `AgentState` interface |
| `persona/memory_structures/associative_memory.py` | `AssociativeMemory` | New: `src/persona/memory.ts` | Port as `AssociativeMemory` class |
| `reputation/reputation_database.py` | `ReputationDB` | New: `src/reputation/reputation-db.ts` | Port as `ReputationDatabase` class |
| `reputation/gossip_database.py` | `GossipDB` | New: `src/reputation/gossip-db.ts` | Port as `GossipDatabase` class |
| `reputation/reputation_update.py` | Update functions | New: `src/reputation/reputation-update.ts` | Port as `ReputationUpdater` class |
| `reputation/social_network.py` | Network functions | New: `src/network/social-network.ts` | Port with lightweight graph library |
| `reputation/gossip.py` | Gossip functions | New: `src/reputation/gossip.ts` | Port as `GossipEngine` class |
| `prompt_interface.py` | `safe_generate_response` | `src/openrouter.ts` | Reuse existing OpenRouter client |
| `task/investment/` | Investment game | New: `src/scenarios/investment.ts` | Port as scenario plugin |
| `task/pd_game/` | PD game | New: `src/scenarios/prisoner-dilemma.ts` | Port as scenario plugin |
| `task/sign_up/` | Sign-up | New: `src/scenarios/sign-up.ts` | Port as scenario plugin |
| `sim_storage/change_sim_folder.py` | `generate_seed` | New: `src/persona/seed.ts` | Port seed generation |
| `start.py` / `auto_run.py` | `Creation` | `src/simulator.ts` | Extend simulation runner |

### 2.2 New Directory Structure

```
src/
├── types.ts                          # Extended with new types
├── game.ts                           # Existing (unchanged)
├── agent.ts                          # Extended: multi-agent, persona state
├── reputation.ts                     # Extended: pluggable reputation backends
├── simulator.ts                      # Extended: multi-scenario runner
├── openrouter.ts                     # Existing (reused for LLM calls)
├── causal.ts                         # Existing (extended for new scenarios)
├── stats.ts                          # Existing (unchanged)
├── prompts.ts                        # Extended: new scenario prompts
├── schemas.ts                        # Extended: new response schemas
│
├── persona/                          # NEW — RepuNet agent model
│   ├── scratch.ts                    # AgentState (mutable per-step state)
│   ├── memory.ts                     # AssociativeMemory (event log)
│   └── seed.ts                       # Persona generation + initialization
│
├── reputation/                       # NEW — RepuNet reputation subsystem
│   ├── reputation-db.ts              # Per-agent reputation database
│   ├── gossip-db.ts                  # Gossip database with credibility
│   ├── gossip.ts                     # Gossip engine (propagation + evaluation)
│   └── reputation-update.ts          # Post-interaction update orchestration
│
├── network/                          # NEW — Social network module
│   └── social-network.ts             # Graph-based network with evolution
│
├── scenarios/                        # NEW — Pluggable game scenarios
│   ├── scenario.ts                   # Scenario interface
│   ├── mspn-negotiation.ts           # Existing MSPN game (extracted)
│   ├── investment.ts                 # RepuNet investment game
│   ├── prisoner-dilemma.ts           # RepuNet PD game
│   └── sign-up.ts                    # RepuNet sign-up/chat
│
├── karma/                            # Existing
│   └── storage.ts
│
└── visualize.ts                      # Extended with network visualizations
```

---

## 3. Interface Definitions

### 3.1 Core Interfaces

```typescript
// --- Reputation Model ---

interface NumericalRecord {
  investmentFailures: number;
  trusteeFailures: number;
  returnIssues: number;
  returnSuccesses: number;
  investorSuccesses: number;
}

interface ReputationEntry {
  name: string;
  id: number;
  role: string;
  content: string;                      // Narrative description
  numericalRecord: NumericalRecord;     // 5-tuple
  reason: string;
  updatedAtStep: number;
}

interface GossipEntry {
  complainedName: string;
  complainedId: number;
  complainedRole: string;
  gossiperRole: string;
  gossipInfo: string;
  credibilityLevel: 'very_credible' | 'credible' | 'uncredible' | 'very_uncredible';
  shouldSpread: boolean;
  reasons: string;
  createdAtStep: number;
}

// --- Agent State (from Scratch) ---

interface AgentState {
  name: string;
  id: number;
  role: string | null;
  currentStep: number;
  learned: Record<string, string>;      // Role-keyed learned traits
  complainBuffer: string[];
  successCounts: Record<string, { total: number; success: number }>;
  relationship: {
    bindList: Array<[string, string]>;  // [name, role]
    blackList: string[];                // Bounded (max 5)
  };
  resourcesUnit: number;
  observed: Record<string, unknown>;
}

// --- Social Network ---

interface SocialNetwork {
  addEdge(from: string, to: string, role: string): void;
  removeEdge(from: string, to: string, role: string): void;
  hasEdge(from: string, to: string, role: string): boolean;
  getConnections(agentId: string, role: string): string[];
  getBlackList(agentId: string): string[];
  addToBlackList(agentId: string, target: string): void;
  toJSON(): Record<string, unknown>;
}

// --- Scenario Plugin ---

interface Scenario {
  name: string;
  roles: string[];
  pair(agents: Agent[], network: SocialNetwork): Array<[Agent, Agent]>;
  execute(pair: [Agent, Agent], context: ScenarioContext): Promise<ScenarioResult>;
  updateReputation(pair: [Agent, Agent], result: ScenarioResult): Promise<void>;
}

interface ScenarioContext {
  step: number;
  network: SocialNetwork;
  reputationSystem: ReputationBackend;
  gossipEngine: GossipEngine | null;
  llm: OpenRouterClient;
  config: SimulationConfig;
}

interface ScenarioResult {
  payoffs: Record<string, number>;
  actions: Record<string, string>;
  history: string[];
  metadata: Record<string, unknown>;
}

// --- Pluggable Reputation Backend ---

interface ReputationBackend {
  getReputation(agentId: string, targetId: string, role: string): ReputationEntry | null;
  updateReputation(agentId: string, entry: ReputationEntry): void;
  getAllReputations(agentId: string, role: string): ReputationEntry[];
  getAggregateScore(agentId: string, role: string): number;
  export(): Record<string, unknown>;
  import(data: Record<string, unknown>): void;
}
```

### 3.2 Extended Existing Types

```typescript
// Extend existing SimulationConfig
interface SimulationConfig {
  // ... existing MSPN fields ...
  agentCount: number;                   // NEW: default 20
  scenario: 'mspn' | 'investment' | 'pd_game' | 'sign_up';  // NEW
  enableGossip: boolean;                // NEW: default false
  enableNetwork: boolean;               // NEW: default false
  reputationBackend: 'karma' | 'repunet' | 'hybrid';  // NEW
  gossipConfig?: {
    maxSpreadDepth: number;             // Max gossip chain length
    credibilityDecay: number;           // Per-hop credibility reduction
    recentWindow: number;               // Steps to consider "recent"
  };
  networkConfig?: {
    blackListMaxSize: number;           // Max black list entries (default 5)
    observationInterval: number;        // Steps between observation updates (default 5)
  };
}
```

---

## 4. Phased Implementation Plan

### Phase 1: Foundation — Agent Model & Reputation Database

**Goal:** Port the core agent state model and reputation database, establishing the data structures everything else builds on.

**Tasks:**
1. Create `src/persona/scratch.ts` — Port `Scratch` class as `AgentState` type + factory
2. Create `src/persona/memory.ts` — Port `AssociativeMemory` with Node/Chat/Event types
3. Create `src/reputation/reputation-db.ts` — Port `ReputationDB` with 5-tuple scoring
4. Create `src/reputation/gossip-db.ts` — Port `GossipDB` with credibility levels
5. Extend `src/types.ts` with new interfaces (NumericalRecord, ReputationEntry, GossipEntry, AgentState)
6. Write unit tests for all new data structures

**Key decisions:**
- Use Zod schemas for all new types (consistent with existing codebase)
- Store reputation data in-memory with optional persistence via `KarmaStorage` pattern
- Reputation score aggregation: implement the `score = e + d - b - a` formula as a pure function

**Estimated files:** 5 new, 1 modified | **Tests:** ~30 new

### Phase 2: Social Network Module

**Goal:** Implement the social network graph with connect/disconnect dynamics.

**Tasks:**
1. Create `src/network/social-network.ts` — Directed graph with per-role edges, bind/black lists
2. Implement `SocialNetwork` interface with adjacency-list storage (no external graph library needed for the scale involved)
3. Port network evolution logic (connect/disconnect decisions)
4. Add LLM prompt templates for network decisions to `src/prompts.ts`
5. Add Zod schemas for network decision responses to `src/schemas.ts`
6. Write unit tests for graph operations and evolution logic

**Key decisions:**
- Use simple adjacency-list Map<string, Set<string>> per role instead of importing a graph library — the agent count (20-50) doesn't warrant NetworkX-level infrastructure
*{ Why not use a typescript graph visualisation library? I would want to include this graph network. }*
- Black list as bounded array with shift eviction (mirrors Python deque behavior)

**Estimated files:** 1 new, 2 modified | **Tests:** ~20 new

### Phase 3: Gossip Engine

**Goal:** Implement two-tier gossip propagation with credibility evaluation.

**Tasks:**
1. Create `src/reputation/gossip.ts` — `GossipEngine` class
2. Implement first-order gossip (select listener, generate narrative, evaluate credibility)
3. Implement second-order gossip (spread with credibility decay)
4. Port gossip-related LLM prompts to `src/prompts.ts`
5. Add gossip credibility evaluation schemas to `src/schemas.ts`
6. Wire gossip into reputation update flow
7. Write unit tests with mock LLM responses

**Key decisions:**
- Gossip runs sequentially (matching RepuNet's design) to avoid race conditions on shared reputation state
- Credibility evaluation via structured LLM response (Zod-validated)
- Gossip entries timestamped with step number for recency windowing

**Estimated files:** 1 new, 3 modified | **Tests:** ~15 new

### Phase 4: Scenario Plugin System & Multi-Agent Support

**Goal:** Refactor simulator to support N agents and pluggable game scenarios.

**Tasks:**
1. Create `src/scenarios/scenario.ts` — `Scenario` interface definition
2. Create `src/scenarios/mspn-negotiation.ts` — Extract existing MSPN game logic into scenario plugin
3. Extend `src/agent.ts` — Support N agents with persona state, role assignment
4. Extend `src/simulator.ts`:
   - Multi-agent episode runner (pair agents, execute scenario, update reputations)
   - Support for scenario selection via config
   - Reputation-weighted pairing algorithm
5. Extend `src/persona/seed.ts` — Persona generation with configurable count and personality descriptions
6. Update causal logging (`src/causal.ts`) to handle N-agent episodes
7. Write integration tests for multi-agent scenarios

**Key decisions:**
- Existing MSPN 2-agent game remains default; new scenarios are opt-in
- Pairing algorithm: reputation-sorted priority selection (port RepuNet's approach)
- Episode results extended with scenario-specific metadata

**Estimated files:** 3 new, 4 modified | **Tests:** ~25 new

### Phase 5: RepuNet Game Scenarios

**Goal:** Port Investment, PD, and Sign-up scenarios as scenario plugins.

**Tasks:**
1. Create `src/scenarios/investment.ts` — 4-stage investment game
2. Create `src/scenarios/prisoner-dilemma.ts` — PD with payoff matrix
3. Create `src/scenarios/sign-up.ts` — Chat-based sign-up scenario
4. Port scenario-specific LLM prompts (structured JSON format, not free-text)
5. Add Zod schemas for all scenario responses
6. Implement observation-based reputation updates (every N steps)
7. Wire reputation updates into each scenario's post-execution hook
8. Write unit tests for each scenario with mock agents

**Key decisions:**
- Prompts rewritten for structured JSON output (leveraging OpenRouter's `response_format`) rather than RepuNet's free-text parsing
- Payoff matrices configurable via scenario config
- Observation interval configurable (default 5 steps)

**Estimated files:** 3 new, 2 modified | **Tests:** ~30 new

### Phase 6: Visualization & Analysis Extensions

**Goal:** Extend dashboard and analysis tools for new reputation model and network dynamics.

**Tasks:**
1. Extend `src/visualize.ts`:
   - Network graph visualization (node = agent, edge = connection, color = reputation)
   - Gossip propagation timeline
   - Reputation evolution per agent (5-tuple over time)
   - Cross-scenario comparison charts
2. Extend `results/` output format with network snapshots and gossip logs
3. Add new statistical tests for multi-agent metrics (e.g., network density, clustering coefficient)

**Estimated files:** 0 new, 2 modified | **Tests:** ~10 new

### Phase 7: Integration Testing & Validation

**Goal:** End-to-end validation that ported behavior matches RepuNet's dynamics.

**Tasks:**
1. Run MSPN with RepuNet scenarios in mock mode, verify:
   - Reputation scores converge similarly to RepuNet runs
   - Network density evolves (connects increase with cooperation, decrease with defection)
   - Gossip spreads and affects reputation as expected
2. Compare A/B test results: baseline (no reputation) vs. RepuNet reputation model
3. Run existing MSPN tests to confirm no regressions
4. Performance profiling for 20-agent simulations
5. Document any behavioral divergences and their causes

**Estimated files:** 0 new, 0 modified | **Tests:** ~20 new (integration)

---

## 5. Milestones

| Milestone | Phase | Deliverable | Verification |
|-----------|-------|-------------|--------------|
| M1: Data Model | Phase 1 | AgentState, ReputationDB, GossipDB types + classes | Unit tests pass; types compile cleanly |
| M2: Network | Phase 2 | SocialNetwork module with evolution | Graph operations correct; connect/disconnect logic matches RepuNet |
| M3: Gossip | Phase 3 | GossipEngine with two-tier propagation | Gossip spreads correctly; credibility decays; recent window filters work |
| M4: Multi-Agent | Phase 4 | N-agent simulator with scenario plugin system | Existing MSPN tests pass; 20-agent episodes complete without error |
| M5: Scenarios | Phase 5 | Investment + PD + Sign-up scenarios | Each scenario produces correct payoffs; reputation updates fire correctly |
| M6: Viz | Phase 6 | Extended dashboard with network + gossip views | Dashboard renders with new charts; no regressions on existing charts |
| M7: Validated | Phase 7 | End-to-end integration tests | All tests pass; no regressions; reputation dynamics qualitatively match RepuNet |

---

## 6. Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **LLM prompt divergence**: RepuNet uses free-text parsing; MSPN uses structured JSON. Behavioral differences from prompt reformulation. | Medium | High | Validate against RepuNet outputs with same LLM model. Accept some divergence as improvement (structured > free-text). |
| **Scale mismatch**: MSPN optimized for 2 agents; N-agent scaling may hit performance walls. | Medium | Medium | Use p-limit concurrency for pair execution. Profile early. Keep N configurable (default 20). |
| **State consistency**: Multi-agent with concurrent pair execution may cause race conditions on shared reputation state. | High | Medium | Follow RepuNet's pattern: parallelize game execution, serialize reputation updates. Use AsyncMutex (already exists in MSPN). |
| **Gossip complexity**: Two-tier gossip with LLM evaluation is the most complex subsystem to port. | Medium | Medium | Implement Phase 3 with extensive mock testing before attempting real LLM calls. |
| **Regression risk**: Extending core types (agent.ts, simulator.ts) may break existing MSPN functionality. | High | Low | Phase 4 extracts existing MSPN game as scenario plugin first, ensuring backward compatibility before adding new scenarios. |
| **Graph library**: RepuNet uses NetworkX (mature, full-featured). TypeScript has no direct equivalent. | Low | Low | Agent count is small enough (20-50) that a simple adjacency-list implementation suffices. No external library needed. |
| **Prompt token costs**: 20 agents x N pairs x multiple LLM calls per interaction = significant token usage. | Medium | High | Default to mock agents for development/testing. Document expected token costs per scenario per step. Use cheap models (Gemini Flash Lite, Mistral Small). |

---

## 7. Verification Strategy

### 7.1 Unit Tests (Per Phase)

Each new module gets unit tests with mock LLM responses:
- **Data structures**: Serialization roundtrips, score calculations, bounded collections
- **Network**: Graph operations, evolution logic, black list eviction
- **Gossip**: Propagation, credibility evaluation, recent window filtering
- **Scenarios**: Payoff matrices, stage sequences, pairing algorithms

### 7.2 Integration Tests (Phase 7)

- **Scenario smoke tests**: Run each scenario for 5 steps with mock agents, verify no crashes
- **Reputation convergence**: After 10 steps, cooperative agents should have higher reputation than defectors
- **Network evolution**: After 10 steps, network density should reflect cooperation patterns
- **Gossip impact**: Agents receiving negative gossip about a target should lower that target's reputation
- **Backward compatibility**: All existing MSPN tests must pass without modification

### 7.3 Behavioral Validation

Compare MSPN+RepuNet outputs against RepuNet Python outputs:
1. Run both systems with same personas, same seed, same LLM model
2. Compare: reputation scores, network density, gossip propagation patterns
3. Accept qualitative similarity (not exact match, due to prompt format differences)
4. Document divergences

### 7.4 Performance Benchmarks

- **Target**: 20-agent, 10-step simulation completes in <60s with mock agents
- **LLM mode**: 20-agent, 5-step simulation completes in <10min with rate-limited API
- **Memory**: Peak memory <500MB for 20-agent simulations

---

## 8. Dependencies to Add

```json
{
  "dependencies": {
    // No new dependencies required.
    // Social network: simple adjacency-list (no graph library needed at this scale)
    // All LLM calls: reuse existing OpenRouter client
    // All validation: reuse existing Zod schemas
    // All persistence: reuse existing KarmaStorage pattern
  }
}
```

**Zero new dependencies** — the integration uses only existing MSPN infrastructure.

---

## 9. Configuration Extensions

New fields in simulation config (all optional, with defaults):

```typescript
{
  // Existing fields unchanged...

  // NEW: Multi-agent
  agentCount: 20,                           // Number of agents (default 2 for backward compat)
  scenario: 'mspn',                         // 'mspn' | 'investment' | 'pd_game' | 'sign_up'

  // NEW: Reputation backend
  reputationBackend: 'karma',               // 'karma' (existing) | 'repunet' | 'hybrid'

  // NEW: Gossip
  enableGossip: false,
  gossipConfig: {
    maxSpreadDepth: 2,                      // Max second-order hops
    credibilityDecay: 0.3,                  // Per-hop credibility reduction
    recentWindow: 30,                       // Steps to consider "recent" gossip
  },

  // NEW: Network
  enableNetwork: false,
  networkConfig: {
    blackListMaxSize: 5,
    observationInterval: 5,                 // Steps between witness-based updates
  },
}
```

---

## 10. Open Questions

1. **Hybrid reputation mode**: Should the `hybrid` backend merge RepuNet's 5-tuple with MSPN's karma into a single score, or maintain both in parallel? **Recommendation**: Maintain both; let scenarios choose which to query.

2. **Prompt strategy**: Should we replicate RepuNet's role-play system prompts or adopt MSPN's concise structured-output style? **Recommendation**: Use MSPN's structured-output style for reliability; include RepuNet's persona context in system prompts.

3. **Agent identity persistence**: RepuNet agents have fixed identities across steps. Should MSPN agents persist identity across episodes (within an A/B test run)? **Recommendation**: Yes, for RepuNet scenarios. MSPN's existing per-episode reset remains default.

4. **Scenario mixing**: Should a single simulation run support mixing scenarios (e.g., some steps Investment, some PD)? **Recommendation**: Not in initial implementation. Single scenario per run.
