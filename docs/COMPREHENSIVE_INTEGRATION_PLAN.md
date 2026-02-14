# Comprehensive Integration Plan: RepuNet → MSPN TypeScript Simulation

> Definitive implementation guide for integrating RepuNet's multi-agent reputation dynamics into the MSPN TypeScript simulation.
>
> Generated: 2026-02-14 | Version: 1.0

---

## 1. Executive Summary

This document outlines a **hybrid enrichment strategy** to integrate RepuNet's sophisticated reputation dynamics into the MSPN TypeScript simulation. The integration preserves MSPN's core strengths (game scenario, causal logging, LLM integration, statistical analysis) while replacing its simplistic karma system with RepuNet's richer models and adding multi-agent support, gossip propagation, and social network evolution.

### Core Integration Principles

1. **Pull from RepuNet's strengths** — Adopt LLM-as-decision-engine, filesystem snapshots, combinatorial ablation, and social network graphs
2. **Preserve MSPN's strengths** — Keep game scenario, causal logging, structured JSON LLM outputs, and separate statistical analysis
3. **Replace naive karma** — MSPN's single 0-100 karma score becomes RepuNet's 5-tuple numerical record + narrative
4. **Scale 2 → N agents** — Extend from two fixed agents (A, B) to configurable multi-agent populations

### Current State Comparison

| Capability           | MSPN (Current)       | RepuNet (Source)        | Target (After Integration)   |
| -------------------- | -------------------- | ----------------------- | ---------------------------- |
| Language             | TypeScript (ES2022)  | Python 3.13             | TypeScript (ES2022)          |
| Agent count          | 2 (A, B)             | 20 (configurable)       | N (configurable, default 20) |
| Reputation model     | Single karma (0-100) | 5-tuple + narrative     | 5-tuple + narrative          |
| Gossip               | None                 | Two-tier cascade        | Two-tier cascade             |
| Social network       | None                 | NetworkX DiGraph        | TypeScript graph lib         |
| Network evolution    | None                 | LLM-driven              | LLM-driven                   |
| Observation          | None                 | Witness-based           | Witness-based                |
| Game scenarios       | MSPN negotiation     | Investment, PD, Sign-up | All scenarios                |
| LLM integration      | OpenRouter (JSON)    | OpenAI (free-text)      | OpenRouter (JSON)            |
| Persistence          | Karma JSON file      | Full step snapshots     | Full step snapshots          |
| Statistical analysis | t-test, bootstrap    | External scripts        | t-test, bootstrap            |

---

## 2. Architectural Philosophy

### 2.1 Key Design Principles Adopted from RepuNet

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ARCHITECTURAL PHILOSOPHY                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. LLM-AS-DECISION-ENGINE                                             │
│     Every non-trivial agent decision is an LLM call:                   │
│     • Investment amount → LLM                                          │
│     • Return percentage → LLM                                          │
│     • Gossip credibility → LLM                                         │
│     • Connect/disconnect → LLM                                         │
│     • Cooperate/defect → LLM                                           │
│                                                                         │
│  2. FILESYSTEM-BASED PERSISTENCE                                       │
│     Each simulation step is a full snapshot:                           │
│     sim_storage/<run>/step_N/                                          │
│     • Enables resume from any step                                     │
│     • Enables replay with different parameters                         │
│     • Enables diff analysis across steps                               │
│                                                                         │
│  3. COMBINATORIAL ABLATION                                             │
│     4 variants per scenario (separate code paths):                     │
│     ┌─────────────────┬────────────────────────────────┐               │
│     │                 │ Gossip ON    │ Gossip OFF      │               │
│     ├─────────────────┼──────────────┼─────────────────┤               │
│     │ Reputation ON   │ Full system  │ No gossip       │               │
│     │ Reputation OFF  │ No reputation│ Minimal         │               │
│     └─────────────────┴──────────────┴─────────────────┘               │
│                                                                         │
│  4. DIRECTED SOCIAL GRAPHS                                             │
│     Per-role directed graphs with bind/black lists:                    │
│     • G["investor"]: edges from investor → trustee                     │
│     • G["trustee"]: edges from trustee → investor                      │
│     • bind_list: active connections                                    │
│     • black_list: blocked agents (max 5, FIFO eviction)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Principles Retained from MSPN

1. **Structured JSON LLM outputs** — Use Zod schemas and `response_format` for reliable parsing
2. **Causal logging** — Full audit trail of agent decisions for debugging and analysis
3. **Separate statistical analysis** — Keep `stats.ts` independent from simulation core
4. **OpenRouter integration** — Reuse existing client with rate limiting
5. **ES2022 strict TypeScript** — Maintain code quality standards

---

## 3. Detailed Module Mapping

### 3.1 RepuNet → MSPN Type/Module Translation

| RepuNet Module                                    | RepuNet Class/Function   | MSPN Target                           | Action                             |
| ------------------------------------------------- | ------------------------ | ------------------------------------- | ---------------------------------- |
| `persona/persona.py`                              | `Persona`                | `src/agent.ts` → `Persona` class      | Extend with memory + reputation DB |
| `persona/memory_structures/scratch.py`            | `Scratch`                | `src/persona/scratch.ts`              | Port as `AgentState` interface     |
| `persona/memory_structures/associative_memory.py` | `AssociativeMemory`      | `src/persona/memory.ts`               | Port as `AssociativeMemory` class  |
| `reputation/reputation_database.py`               | `ReputationDB`           | `src/reputation/reputation-db.ts`     | Port as `ReputationDatabase`       |
| `reputation/gossip_database.py`                   | `GossipDB`               | `src/reputation/gossip-db.ts`         | Port as `GossipDatabase`           |
| `reputation/reputation_update.py`                 | Update functions         | `src/reputation/reputation-update.ts` | Port as `ReputationUpdater`        |
| `reputation/social_network.py`                    | Network functions        | `src/network/social-network.ts`       | Port with graph library            |
| `reputation/gossip.py`                            | Gossip functions         | `src/reputation/gossip.ts`            | Port as `GossipEngine`             |
| `prompt_interface.py`                             | `safe_generate_response` | `src/openrouter.ts`                   | Reuse existing client              |
| `task/investment/`                                | Investment game          | `src/scenarios/investment.ts`         | Port as scenario plugin            |
| `task/pd_game/`                                   | PD game                  | `src/scenarios/prisoner-dilemma.ts`   | Port as scenario plugin            |
| `task/sign_up/`                                   | Sign-up                  | `src/scenarios/sign-up.ts`            | Port as scenario plugin            |
| `sim_storage/change_sim_folder.py`                | `generate_seed`          | `src/persona/seed.ts`                 | Port seed generation               |
| `start.py` / `auto_run.py`                        | `Creation`               | `src/simulator.ts`                    | Extend simulation runner           |

### 3.2 New Directory Structure

```
src/
├── types.ts                          # Extended with all new types
├── game.ts                           # MSPN game (preserved)
├── agent.ts                          # Extended: Persona class with memory
├── reputation.ts                     # Extended: pluggable backends
├── simulator.ts                      # Extended: multi-scenario runner
├── openrouter.ts                     # Existing (reused)
├── stats.ts                          # Existing (unchanged)
├── prompts.ts                        # Extended: scenario prompts
├── schemas.ts                        # Extended: scenario schemas
├── visualize.ts                      # Extended: network viz
│
├── persona/                          # NEW — Agent state model
│   ├── index.ts                      # Barrel export
│   ├── scratch.ts                    # AgentState interface
│   ├── memory.ts                     # AssociativeMemory class
│   └── seed.ts                       # Persona generation
│
├── reputation/                       # NEW — Reputation subsystem
│   ├── index.ts                      # Barrel export
│   ├── reputation-db.ts              # Per-agent reputation DB
│   ├── gossip-db.ts                  # Gossip with credibility
│   ├── gossip.ts                     # GossipEngine class
│   └── reputation-update.ts          # Update orchestration
│
├── network/                          # NEW — Social network module
│   ├── index.ts                      # Barrel export
│   └── social-network.ts             # Graph + evolution logic
│
├── scenarios/                        # NEW — Pluggable scenarios
│   ├── index.ts                      # Barrel export
│   ├── scenario.ts                   # Scenario interface
│   ├── mspn-negotiation.ts           # Existing MSPN (extracted)
│   ├── investment.ts                 # Investment game
│   ├── prisoner-dilemma.ts           # PD game
│   └── sign-up.ts                    # Sign-up/chat
│
├── storage/                          # NEW — Filesystem persistence
│   ├── index.ts                      # Barrel export
│   ├── snapshot.ts                   # Step snapshot manager
│   └── run-manager.ts                # Run lifecycle management
│
├── karma/                            # Existing (preserved for backward compat)
│   └── storage.ts
│
└── ablation/                         # NEW — Variant management
    ├── index.ts                      # Barrel export
    └── variants.ts                   # 4-variant configuration

sim_storage/                          # NEW — Runtime snapshots
├── profiles.json                     # Persona definitions
└── <run_name>/
    ├── config.json                   # Run configuration
    └── step_N/                       # Step snapshots
        ├── meta.json                 # {step, agentCount, scenario}
        ├── personas/
        │   └── <name>/
        │       ├── scratch.json
        │       ├── memory.json
        │       └── reputation/
        │           ├── current.json
        │           ├── historical.json
        │           └── gossip.json
        ├── network/
        │   └── graph.json
        └── results/
            └── interactions.json
```

---

## 4. Type System Design

### 4.1 Core Reputation Types

```typescript
// src/types.ts

export type AgentRole =
  | 'investor'
  | 'trustee'
  | 'player'
  | 'resident'
  | 'proposer'
  | 'reviewer';

export type CredibilityLevel =
  | 'very_credible'
  | 'credible'
  | 'uncredible'
  | 'very_uncredible';

export interface NumericalRecord {
  investmentFailures: number; // a: times failed as investor
  trusteeFailures: number; // b: times failed as trustee
  returnIssues: number; // c: issues with returns
  returnSuccesses: number; // d: successful returns
  investorSuccesses: number; // e: successful investments
}

export interface ReputationEntry {
  name: string;
  id: number;
  role: AgentRole;
  content: string; // Narrative description
  numericalRecord: NumericalRecord;
  reason: string; // Why this was updated
  updatedAtStep: number;
}

export interface GossipEntry {
  complainedName: string;
  complainedId: number;
  complainedRole: AgentRole;
  gossiperName: string;
  gossiperRole: AgentRole;
  gossipInfo: string; // Description of alleged behavior
  credibilityLevel: CredibilityLevel;
  shouldSpread: boolean; // Second-order propagation flag
  reasons: string;
  createdAtStep: number;
  sourceChain: string[]; // Path of gossip propagation
}
```

### 4.2 Agent State Types (from Scratch)

```typescript
// src/persona/scratch.ts

export interface RelationshipState {
  bindList: Array<{ name: string; role: AgentRole }>;
  blackList: string[]; // Bounded (max 5)
}

export interface RoleCounters {
  total: number;
  success: number;
}

export interface AgentState {
  name: string;
  id: number;
  role: AgentRole | null;
  currentStep: number;

  // Personality (loaded from profiles)
  innate: string | null; // Immutable personality
  learned: Record<AgentRole, string>; // LLM-updated traits per role

  // Grievances
  complainBuffer: string[]; // Issues to gossip about

  // Success tracking per role
  roleCounters: Record<AgentRole, RoleCounters>;

  // Social connections
  relationship: RelationshipState;

  // Resources
  resourcesUnit: number; // Starting capital

  // Witnessed interactions
  observed: ObservedInteraction[];
}

export interface ObservedInteraction {
  step: number;
  agents: [string, string];
  roles: [AgentRole, AgentRole];
  action: string;
  outcome: string;
}
```

### 4.3 Memory Types (Associative Memory)

```typescript
// src/persona/memory.ts

export type NodeType = 'event' | 'chat' | 'observation';

export interface MemoryNode {
  id: string;
  type: NodeType;
  subject: string; // Agent name
  predicate: string; // Action type
  object: string; // Target agent or resource
  description: string; // Full narrative
  createdAt: number; // Step number
  metadata?: Record<string, unknown>;
}

export interface ChatNode extends MemoryNode {
  type: 'chat';
  conversation: string; // Full conversation text
  partner: string;
}

export interface EventNode extends MemoryNode {
  type: 'event';
  outcome: string;
  payoffs?: Record<string, number>;
}

export interface AssociativeMemory {
  nodes: MemoryNode[];
  addNode(node: Omit<MemoryNode, 'id' | 'createdAt'>): MemoryNode;
  getLatestNodes(n: number): MemoryNode[];
  getNodesWithTarget(target: string): MemoryNode[];
  getNodesWithType(type: NodeType): MemoryNode[];
}
```

### 4.4 Social Network Types

```typescript
// src/network/social-network.ts

export interface NetworkEdge {
  from: string; // Agent name
  to: string; // Agent name
  role: AgentRole;
  weight: number; // Connection strength
  createdAt: number; // Step when created
}

export interface NetworkGraph {
  edges: NetworkEdge[];
  adjacencyList: Map<string, Set<string>>; // Per role
}

export interface ConnectDecision {
  shouldConnect: boolean;
  shouldDisconnect: boolean;
  reasoning: string;
}

export interface SocialNetworkConfig {
  blackListMaxSize: number; // Default: 5
  observationInterval: number; // Default: 5 steps
}
```

### 4.5 Scenario Plugin Interface

```typescript
// src/scenarios/scenario.ts

export interface Scenario {
  name: string;
  roles: AgentRole[];

  // Pairing logic
  pair(
    agents: Persona[],
    network: SocialNetwork,
    config: ScenarioConfig
  ): Promise<Array<[Persona, Persona]>>;

  // Execute one interaction
  execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult>;

  // Post-execution reputation update
  updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void>;

  // Check if gossip should trigger
  shouldTriggerGossip(result: ScenarioResult): boolean;
}

export interface ScenarioContext {
  step: number;
  network: SocialNetwork;
  reputationSystem: ReputationBackend;
  gossipEngine: GossipEngine | null;
  llm: LLMClient;
  config: SimulationConfig;
}

export interface ScenarioResult {
  pairId: string;
  agents: [string, string];
  roles: [AgentRole, AgentRole];
  actions: Record<string, string>;
  payoffs: Record<string, number>;
  history: string[];
  metadata: Record<string, unknown>;
}

export interface ScenarioConfig {
  maxRounds: number;
  payoffMatrix?: Record<string, [number, number]>;
}
```

### 4.6 Pluggable Reputation Backend

```typescript
// src/reputation/reputation-backend.ts

export interface ReputationBackend {
  // Core operations
  getReputation(
    agentId: string,
    targetId: string,
    role: AgentRole
  ): ReputationEntry | null;

  updateReputation(agentId: string, entry: ReputationEntry): void;

  getAllReputations(agentId: string, role: AgentRole): ReputationEntry[];

  // Aggregation
  getAggregateScore(agentId: string, targetId: string): number; // Normalized [-1, 1]

  // Persistence
  export(): Record<string, unknown>;
  import(data: Record<string, unknown>): void;

  // Stats
  getStats(): ReputationStats;
}

export interface ReputationStats {
  totalEntries: number;
  averageScore: number;
  scoreDistribution: number[];
}

// Karma backend (backward compatibility)
export interface KarmaBackend extends ReputationBackend {
  getKarma(agentId: string): number;
  setKarma(agentId: string, karma: number): void;
}

// RepuNet backend (new)
export interface RepuNetBackend extends ReputationBackend {
  getNumericalRecord(agentId: string, targetId: string): NumericalRecord;

  getHistoricalReputations(
    agentId: string,
    targetId: string
  ): ReputationEntry[];
}
```

### 4.7 Configuration Types

```typescript
// src/types.ts

export type ScenarioType = 'mspn' | 'investment' | 'pd_game' | 'sign_up';
export type ReputationBackendType = 'karma' | 'repunet' | 'hybrid';

export interface SimulationConfig {
  // Existing MSPN fields
  maxRounds: number;
  beliefUpdateStrength: {
    proposal: number;
    review: number;
  };
  payoffNoise: number;
  initialBeliefAlignment: number;

  // NEW: Multi-agent
  agentCount: number; // Default: 20
  scenario: ScenarioType; // Default: 'mspn'

  // NEW: Reputation
  reputationBackend: ReputationBackendType;

  // NEW: Gossip
  enableGossip: boolean;
  gossipConfig: GossipConfig;

  // NEW: Network
  enableNetwork: boolean;
  networkConfig: NetworkConfig;

  // NEW: Persistence
  storageConfig: StorageConfig;

  // NEW: Ablation
  ablationMode: AblationMode;
}

export interface GossipConfig {
  enabled: boolean;
  maxSpreadDepth: number; // Default: 2
  credibilityDecay: number; // Default: 0.3 (per hop)
  recentWindow: number; // Default: 30 steps
  listenerSelection: 'random' | 'reputation_weighted'; // Default: 'random'
}

export interface NetworkConfig {
  enabled: boolean;
  blackListMaxSize: number; // Default: 5
  observationInterval: number; // Default: 5
  initialConnectivity: number; // 0-1, default: 0.3
}

export interface StorageConfig {
  basePath: string; // Default: './sim_storage'
  runId: string; // Auto-generated if not provided
  persistInterval: number; // Default: 1 (every step)
}

export type AblationMode =
  | 'full' // Reputation ON, Gossip ON
  | 'no_gossip' // Reputation ON, Gossip OFF
  | 'no_reputation' // Reputation OFF, Gossip ON
  | 'minimal'; // Reputation OFF, Gossip OFF
```

### 4.8 Zod Schemas for LLM Responses

```typescript
// src/schemas.ts (extensions)

// Gossip credibility evaluation
export const GossipEvaluationSchema = z.object({
  credibilityLevel: z.enum([
    'very_credible',
    'credible',
    'uncredible',
    'very_uncredible',
  ]),
  shouldSpread: z.boolean(),
  reasoning: z.string(),
  reputationAdjustment: z.number().min(-1).max(1),
});

// Network decision
export const NetworkDecisionSchema = z.object({
  shouldDisconnect: z.boolean(),
  shouldConnect: z.boolean(),
  reasoning: z.string(),
  trustLevel: z.number().min(0).max(1),
});

// Investment decision
export const InvestmentDecisionSchema = z.object({
  accept: z.boolean(),
  reasoning: z.string(),
  amount: z.number().min(1).max(10).optional(),
});

// Return decision
export const ReturnDecisionSchema = z.object({
  percentage: z.enum(['0', '25', '75', '100', '150']),
  reasoning: z.string(),
});

// PD decision
export const PDDecisionSchema = z.object({
  action: z.enum(['cooperate', 'defect']),
  reasoning: z.string(),
});

// Reputation update
export const ReputationUpdateSchema = z.object({
  narrative: z.string(),
  recordDelta: z.object({
    investmentFailures: z.number(),
    trusteeFailures: z.number(),
    returnIssues: z.number(),
    returnSuccesses: z.number(),
    investorSuccesses: z.number(),
  }),
  reasoning: z.string(),
});
```

---

## 5. Phased Implementation Plan

### Phase 1: Foundation — Agent Model & Reputation Database

**Duration:** 2-3 days | **Dependencies:** None

**Goal:** Port the core agent state model and reputation database.

**Tasks:**

| Task | File(s)                           | Description                                                        |
| ---- | --------------------------------- | ------------------------------------------------------------------ |
| 1.1  | `src/types.ts`                    | Add NumericalRecord, ReputationEntry, GossipEntry, AgentRole types |
| 1.2  | `src/persona/scratch.ts`          | Port Scratch as AgentState interface + factory                     |
| 1.3  | `src/persona/memory.ts`           | Port AssociativeMemory with Node types                             |
| 1.4  | `src/reputation/reputation-db.ts` | Port ReputationDB with 5-tuple scoring                             |
| 1.5  | `src/reputation/gossip-db.ts`     | Port GossipDB with credibility levels                              |
| 1.6  | `src/schemas.ts`                  | Add Zod schemas for new types                                      |
| 1.7  | `tests/persona/*.test.ts`         | Unit tests for all data structures                                 |

**Key Implementation:**

```typescript
// src/reputation/reputation-db.ts

export class ReputationDatabase implements RepuNetBackend {
  private entries: Map<string, Map<string, ReputationEntry>> = new Map();
  private historical: Map<string, Map<string, ReputationEntry[]>> = new Map();

  getAggregateScore(agentId: string, targetId: string): number {
    const entry = this.getReputation(agentId, targetId, 'investor');
    if (!entry) return 0;

    const { numericalRecord } = entry;
    const score =
      numericalRecord.investorSuccesses +
      numericalRecord.returnSuccesses -
      numericalRecord.trusteeFailures -
      numericalRecord.investmentFailures;
    return Math.max(-1, Math.min(1, score / 10));
  }

  updateReputation(agentId: string, entry: ReputationEntry): void {
    const targetMap = this.entries.get(agentId) || new Map();
    const existing = targetMap.get(entry.name);

    if (existing) {
      const history = this.historical.get(agentId) || new Map();
      const targetHistory = history.get(entry.name) || [];
      targetHistory.push(existing);
      history.set(entry.name, targetHistory);
      this.historical.set(agentId, history);
    }

    targetMap.set(entry.name, entry);
    this.entries.set(agentId, targetMap);
  }
}
```

**Verification:** Unit tests pass, types compile cleanly.

---

### Phase 2: Social Network Module

**Duration:** 2 days | **Dependencies:** Phase 1

**Goal:** Implement social network graph with connect/disconnect dynamics.

**Tasks:**

| Task | File(s)                         | Description                        |
| ---- | ------------------------------- | ---------------------------------- |
| 2.1  | `src/network/social-network.ts` | Directed graph with per-role edges |
| 2.2  | `src/network/social-network.ts` | Bind/black list management         |
| 2.3  | `src/prompts.ts`                | Network decision prompt templates  |
| 2.4  | `src/schemas.ts`                | NetworkDecisionSchema              |
| 2.5  | `tests/network/*.test.ts`       | Unit tests for graph operations    |

**Key Implementation:**

```typescript
// src/network/social-network.ts

export class SocialNetwork {
  private graphs: Map<AgentRole, Map<string, Set<string>>> = new Map();
  private blackLists: Map<string, string[]> = new Map();

  constructor(private config: NetworkConfig) {}

  addEdge(from: string, to: string, role: AgentRole): void {
    const roleGraph = this.graphs.get(role) || new Map();
    const edges = roleGraph.get(from) || new Set();
    edges.add(to);
    roleGraph.set(from, edges);
    this.graphs.set(role, roleGraph);
  }

  removeEdge(from: string, to: string, role: AgentRole): void {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) return;
    const edges = roleGraph.get(from);
    if (edges) {
      edges.delete(to);
    }
  }

  addToBlackList(agentId: string, target: string): void {
    const list = this.blackLists.get(agentId) || [];
    if (list.length >= this.config.blackListMaxSize) {
      list.shift(); // FIFO eviction
    }
    if (!list.includes(target)) {
      list.push(target);
    }
    this.blackLists.set(agentId, list);
  }

  getConnections(agentId: string, role: AgentRole): string[] {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) return [];
    const edges = roleGraph.get(agentId);
    return edges ? Array.from(edges) : [];
  }

  async evaluateConnection(
    agent: Persona,
    target: Persona,
    context: ScenarioContext
  ): Promise<ConnectDecision> {
    const prompt = this.buildConnectionPrompt(agent, target);
    const response = await context.llm.request(prompt, NetworkDecisionSchema);
    return {
      shouldConnect: response.shouldConnect,
      shouldDisconnect: response.shouldDisconnect,
      reasoning: response.reasoning,
    };
  }
}
```

**Verification:** Graph operations correct, bind/black lists work.

---

### Phase 3: Gossip Engine

**Duration:** 2-3 days | **Dependencies:** Phase 1, 2

**Goal:** Implement two-tier gossip propagation with credibility evaluation.

**Tasks:**

| Task | File(s)                           | Description                                         |
| ---- | --------------------------------- | --------------------------------------------------- |
| 3.1  | `src/reputation/gossip.ts`        | GossipEngine class                                  |
| 3.2  | `src/reputation/gossip.ts`        | First-order gossip (listener selection, generation) |
| 3.3  | `src/reputation/gossip.ts`        | Second-order gossip (spread with decay)             |
| 3.4  | `src/prompts.ts`                  | Gossip evaluation prompts                           |
| 3.5  | `src/schemas.ts`                  | GossipEvaluationSchema                              |
| 3.6  | `tests/reputation/gossip.test.ts` | Unit tests with mock LLM                            |

**Key Implementation:**

```typescript
// src/reputation/gossip.ts

export class GossipEngine {
  constructor(
    private config: GossipConfig,
    private gossipDb: GossipDatabase,
    private reputationDb: ReputationDatabase
  ) {}

  async firstOrderGossip(
    gossiper: Persona,
    agents: Persona[],
    context: ScenarioContext
  ): Promise<void> {
    // 1. Select listener
    const listener = this.selectListener(gossiper, agents);

    // 2. Generate gossip narrative
    const grievance = gossiper.state.complainBuffer.shift();
    if (!grievance) return;

    const gossipInfo = await this.generateGossipNarrative(
      gossiper,
      grievance,
      context
    );

    // 3. Listener evaluates credibility
    const evaluation = await this.evaluateCredibility(
      listener,
      gossipInfo,
      context
    );

    // 4. Update listener's reputation of target
    await this.updateReputationFromGossip(
      listener,
      gossipInfo,
      evaluation,
      context
    );

    // 5. Store gossip entry
    this.gossipDb.addEntry({
      complainedName: gossipInfo.targetName,
      complainedId: gossipInfo.targetId,
      complainedRole: gossipInfo.targetRole,
      gossiperName: gossiper.state.name,
      gossiperRole: gossiper.state.role!,
      gossipInfo: gossipInfo.narrative,
      credibilityLevel: evaluation.credibilityLevel,
      shouldSpread: evaluation.shouldSpread,
      reasons: evaluation.reasoning,
      createdAtStep: context.step,
      sourceChain: [gossiper.state.name],
    });

    // 6. Trigger second-order if marked
    if (evaluation.shouldSpread && this.config.maxSpreadDepth > 1) {
      await this.secondOrderGossip(
        listener,
        gossipInfo,
        evaluation,
        context,
        2
      );
    }
  }

  private async secondOrderGossip(
    spreader: Persona,
    originalGossip: GossipInfo,
    evaluation: GossipEvaluation,
    context: ScenarioContext,
    depth: number
  ): Promise<void> {
    if (depth > this.config.maxSpreadDepth) return;

    const agents = context.config.agentCount;
    const listener = this.selectListener(spreader, agents);

    // Credibility decays with each hop
    const decayedCredibility = this.applyDecay(
      evaluation.credibilityLevel,
      depth
    );

    const secondOrderEvaluation = await this.evaluateCredibility(
      listener,
      { ...originalGossip, credibilityHint: decayedCredibility },
      context
    );

    // ... similar flow as first-order
  }

  private applyDecay(level: CredibilityLevel, depth: number): CredibilityLevel {
    const levels: CredibilityLevel[] = [
      'very_credible',
      'credible',
      'uncredible',
      'very_uncredible',
    ];
    const currentIndex = levels.indexOf(level);
    const newIndex = Math.min(currentIndex + depth, levels.length - 1);
    return levels[newIndex];
  }
}
```

**Verification:** Gossip spreads correctly, credibility decays.

---

### Phase 4: Scenario Plugin System & Multi-Agent Support

**Duration:** 3 days | **Dependencies:** Phase 1, 2, 3

**Goal:** Refactor simulator for N agents and pluggable scenarios.

**Tasks:**

| Task | File(s)                             | Description                        |
| ---- | ----------------------------------- | ---------------------------------- |
| 4.1  | `src/scenarios/scenario.ts`         | Scenario interface definition      |
| 4.2  | `src/scenarios/mspn-negotiation.ts` | Extract existing MSPN game         |
| 4.3  | `src/agent.ts`                      | Extend Agent → Persona with memory |
| 4.4  | `src/simulator.ts`                  | Multi-agent episode runner         |
| 4.5  | `src/persona/seed.ts`               | Persona generation                 |
| 4.6  | `tests/scenarios/*.test.ts`         | Integration tests                  |

**Key Implementation:**

```typescript
// src/simulator.ts (extended)

export class MultiAgentSimulator {
  private personas: Map<string, Persona> = new Map();
  private network: SocialNetwork;
  private gossipEngine: GossipEngine | null;

  constructor(private config: SimulationConfig) {
    this.network = new SocialNetwork(config.networkConfig);
    if (config.enableGossip) {
      this.gossipEngine = new GossipEngine(
        config.gossipConfig,
        new GossipDatabase(),
        new ReputationDatabase()
      );
    }
  }

  async initialize(): Promise<void> {
    // Generate personas
    const seeds = generatePersonaSeeds(
      this.config.agentCount,
      this.config.scenario
    );
    for (const seed of seeds) {
      const persona = new Persona(seed);
      this.personas.set(persona.state.name, persona);
    }

    // Initialize network connections
    this.initializeNetwork();
  }

  async runStep(step: number): Promise<StepResult> {
    const scenario = this.getScenario(this.config.scenario);

    // 1. Pair agents
    const pairs = await scenario.pair(
      Array.from(this.personas.values()),
      this.network,
      this.config
    );

    // 2. Execute interactions (parallel for PD, sequential for others)
    const results = await this.executePairs(pairs, scenario, step);

    // 3. Update reputations (serialized)
    for (const [pair, result] of results) {
      await scenario.updateReputation(pair, result, this.createContext(step));
    }

    // 4. Network rewiring
    await this.updateNetwork(results, step);

    // 5. Gossip propagation
    if (this.gossipEngine) {
      await this.runGossip(results, step);
    }

    // 6. Observation-based updates (every N steps)
    if (step % this.config.networkConfig.observationInterval === 0) {
      await this.runObservationUpdates(step);
    }

    // 7. Persist snapshot
    await this.saveSnapshot(step);

    return { step, results };
  }

  private async executePairs(
    pairs: Array<[Persona, Persona]>,
    scenario: Scenario,
    step: number
  ): Promise<Array<[[Persona, Persona], ScenarioResult]>> {
    const context = this.createContext(step);

    if (scenario.name === 'prisoner-dilemma') {
      // Parallel execution for PD
      const limit = pLimit(this.config.concurrency);
      return Promise.all(
        pairs.map((pair) =>
          limit(() =>
            scenario
              .execute(pair, context)
              .then((result) => [pair, result] as const)
          )
        )
      );
    } else {
      // Sequential for investment/sign-up
      const results: Array<[[Persona, Persona], ScenarioResult]> = [];
      for (const pair of pairs) {
        const result = await scenario.execute(pair, context);
        results.push([pair, result]);
      }
      return results;
    }
  }
}
```

**Verification:** Existing MSPN tests pass, 20-agent runs complete.

---

### Phase 5: RepuNet Game Scenarios

**Duration:** 3-4 days | **Dependencies:** Phase 4

**Goal:** Port Investment, PD, and Sign-up scenarios.

**Tasks:**

| Task | File(s)                             | Description               |
| ---- | ----------------------------------- | ------------------------- |
| 5.1  | `src/scenarios/investment.ts`       | 4-stage investment game   |
| 5.2  | `src/scenarios/prisoner-dilemma.ts` | PD with payoff matrix     |
| 5.3  | `src/scenarios/sign-up.ts`          | Chat-based sign-up        |
| 5.4  | `src/prompts.ts`                    | Scenario-specific prompts |
| 5.5  | `src/schemas.ts`                    | Response schemas          |
| 5.6  | `tests/scenarios/*.test.ts`         | Unit tests per scenario   |

**Investment Game Implementation:**

```typescript
// src/scenarios/investment.ts

export class InvestmentScenario implements Scenario {
  name = 'investment';
  roles: AgentRole[] = ['investor', 'trustee'];

  async pair(
    agents: Persona[],
    network: SocialNetwork,
    config: ScenarioConfig
  ): Promise<Array<[Persona, Persona]>> {
    // 1. Shuffle and assign roles
    const shuffled = this.shuffle([...agents]);
    const midpoint = Math.floor(shuffled.length / 2);
    const investors = shuffled.slice(0, midpoint).map((a) => {
      a.state.role = 'investor';
      return a;
    });
    const trustees = shuffled.slice(midpoint).map((a) => {
      a.state.role = 'trustee';
      return a;
    });

    // 2. Sort investors by reputation (highest first)
    investors.sort(
      (a, b) => this.getAverageReputation(b) - this.getAverageReputation(a)
    );

    // 3. Pair with reputation-weighted selection
    const pairs: Array<[Persona, Persona]> = [];
    const available = new Set(trustees);

    for (const investor of investors) {
      if (available.size === 0) break;

      // 50% LLM selection, 50% random
      let trustee: Persona;
      if (Math.random() < 0.5) {
        trustee = await this.llmSelectTrustee(investor, Array.from(available));
      } else {
        trustee =
          Array.from(available)[Math.floor(Math.random() * available.size)];
      }

      available.delete(trustee);
      pairs.push([investor, trustee]);
    }

    return pairs;
  }

  async execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [investor, trustee] = pair;
    const history: string[] = [];

    // Stage 0: Investor decides to accept/refuse
    const acceptDecision = await this.stage0Accept(investor, context);
    if (!acceptDecision.accept) {
      return this.createRefusalResult(investor, trustee);
    }

    // Stage 1: Investor allocates 1-10 units
    const allocation = await this.stage1Allocate(investor, context);
    history.push(
      `Investor ${investor.state.name} allocated ${allocation.amount} units`
    );

    // Trustee receives 3x
    const trusteeReceives = allocation.amount * 3;

    // Stage 3: Trustee returns percentage
    const returnDecision = await this.stage3Return(
      trustee,
      trusteeReceives,
      context
    );
    const returnedAmount =
      trusteeReceives * (parseInt(returnDecision.percentage) / 100);
    history.push(
      `Trustee ${trustee.state.name} returned ${returnDecision.percentage}%`
    );

    // Calculate payoffs
    const investorPayoff = returnedAmount - allocation.amount;
    const trusteePayoff = trusteeReceives - returnedAmount;

    return {
      pairId: `${investor.state.name}-${trustee.state.name}`,
      agents: [investor.state.name, trustee.state.name],
      roles: ['investor', 'trustee'],
      actions: {
        allocation: allocation.amount.toString(),
        return: returnDecision.percentage,
      },
      payoffs: {
        [investor.state.name]: investorPayoff,
        [trustee.state.name]: trusteePayoff,
      },
      history,
      metadata: { acceptDecision, allocation, returnDecision },
    };
  }
}
```

**Verification:** Each scenario produces correct payoffs.

---

### Phase 6: Visualization & Analysis Extensions

**Duration:** 2 days | **Dependencies:** Phase 4, 5

**Goal:** Extend dashboard for network and reputation visualization.

**Tasks:**

| Task | File(s)                   | Description                 |
| ---- | ------------------------- | --------------------------- |
| 6.1  | `src/visualize.ts`        | Network graph visualization |
| 6.2  | `src/visualize.ts`        | Reputation evolution charts |
| 6.3  | `src/visualize.ts`        | Gossip propagation timeline |
| 6.4  | `tests/visualize.test.ts` | Visualization tests         |

**Key Features:**

- Network graph: nodes = agents, edges = connections, color = reputation score
- Reputation timeline: 5-tuple components over time per agent
- Gossip cascade: visual representation of propagation chains

**Verification:** Dashboard renders without errors.

---

### Phase 7: Integration Testing & Validation

**Duration:** 2-3 days | **Dependencies:** All phases

**Goal:** End-to-end validation against RepuNet dynamics.

**Tasks:**

| Task | File(s)                       | Description                  |
| ---- | ----------------------------- | ---------------------------- |
| 7.1  | `tests/integration/*.test.ts` | Scenario smoke tests         |
| 7.2  | `tests/integration/*.test.ts` | Reputation convergence tests |
| 7.3  | `tests/integration/*.test.ts` | Network evolution tests      |
| 7.4  | `tests/integration/*.test.ts` | Gossip impact tests          |
| 7.5  | `tests/regression/*.test.ts`  | MSPN backward compatibility  |

**Verification Criteria:**

- All existing MSPN tests pass
- Reputation dynamics qualitatively match RepuNet
- Network density evolves with cooperation patterns
- Gossip affects reputation as expected

---

## 6. Technology Stack Additions

### 6.1 TypeScript Graph Visualization Library

**Recommendation:** `cytoscape` + `cytoscape-dagre`

```json
{
  "dependencies": {
    "cytoscape": "^3.28.0",
    "cytoscape-dagre": "^2.5.0",
    "dagre": "^0.8.5"
  },
  "devDependencies": {
    "@types/cytoscape": "^3.19.0"
  }
}
```

**Rationale:**

- Mature, well-documented library
- Supports directed graphs with custom styling
- Built-in layout algorithms (dagre for hierarchical)
- Can export to PNG/SVG for reports
- Works in Node.js (server-side) and browser

**Alternative:** `vis-network` for simpler use cases

### 6.2 Full Dependency Additions

```json
{
  "dependencies": {
    "cytoscape": "^3.28.0",
    "cytoscape-dagre": "^2.5.0",
    "dagre": "^0.8.5"
  },
  "devDependencies": {
    "@types/cytoscape": "^3.19.0"
  }
}
```

**No other dependencies needed** — all other functionality uses existing:

- OpenRouter client (`openai` package)
- Zod for validation
- `p-limit` for concurrency
- `seedrandom` for reproducibility

---

## 7. Filesystem Persistence Design

### 7.1 Snapshot Structure

```
sim_storage/
├── profiles.json                     # Persona definitions
│   {
│     "investment": {
│       "Alice": {
│         "investor": "risk-averse, analytical...",
│         "trustee": "reliable, fair-minded..."
│       }
│     },
│     "pd_game": {
│       "Bob": "tit-for-tat strategist..."
│     }
│   }
│
└── run_2026-02-14_12-30-00/         # Run directory
    ├── config.json                   # Full simulation config
    │
    ├── step_0/                       # Initial state
    │   ├── meta.json
    │   │   {"step": 0, "agentCount": 20, "scenario": "investment"}
    │   │
    │   ├── personas/
    │   │   ├── Alice/
    │   │   │   ├── scratch.json      # AgentState
    │   │   │   ├── memory.json       # AssociativeMemory nodes
    │   │   │   └── reputation/
    │   │   │       ├── current.json  # Current reputations
    │   │   │       ├── historical.json  # Past reputations
    │   │   │       └── gossip.json   # Received gossip
    │   │   └── Bob/
    │   │       └── ...
    │   │
    │   ├── network/
    │   │   └── graph.json            # Network edges
    │   │
    │   └── results/
    │       └── interactions.json     # Interaction logs
    │
    ├── step_1/
    │   └── ...
    │
    └── step_N/
        └── ...
```

### 7.2 Snapshot Manager Implementation

```typescript
// src/storage/snapshot.ts

export class SnapshotManager {
  constructor(private basePath: string) {}

  async saveStep(
    runId: string,
    step: number,
    state: SimulationState
  ): Promise<void> {
    const stepDir = path.join(this.basePath, runId, `step_${step}`);
    await fs.promises.mkdir(stepDir, { recursive: true });

    // Save meta
    await this.writeJson(path.join(stepDir, 'meta.json'), {
      step,
      agentCount: state.personas.length,
      scenario: state.scenario,
      timestamp: new Date().toISOString(),
    });

    // Save personas
    for (const persona of state.personas) {
      await this.savePersona(stepDir, persona);
    }

    // Save network
    await this.writeJson(
      path.join(stepDir, 'network', 'graph.json'),
      state.network.export()
    );

    // Save results
    await this.writeJson(
      path.join(stepDir, 'results', 'interactions.json'),
      state.interactions
    );
  }

  async loadStep(runId: string, step?: number): Promise<SimulationState> {
    const actualStep = step ?? (await this.findLatestStep(runId));
    const stepDir = path.join(this.basePath, runId, `step_${actualStep}`);

    const meta = await this.readJson(path.join(stepDir, 'meta.json'));
    const personas = await this.loadPersonas(stepDir);
    const network = await this.loadNetwork(stepDir);

    return { meta, personas, network };
  }

  async findLatestStep(runId: string): Promise<number> {
    const runDir = path.join(this.basePath, runId);
    const entries = await fs.promises.readdir(runDir);
    const steps = entries
      .filter((e) => e.startsWith('step_'))
      .map((e) => parseInt(e.replace('step_', '')))
      .sort((a, b) => b - a);
    return steps[0] ?? 0;
  }
}
```

### 7.3 Resume Logic

```typescript
// src/storage/run-manager.ts

export class RunManager {
  async resume(runId: string, additionalSteps: number): Promise<void> {
    const state = await this.snapshotManager.loadStep(runId);

    // Reconstruct simulator state
    const simulator = new MultiAgentSimulator(state.meta.config);
    await simulator.importState(state);

    // Continue from where we left off
    for (
      let step = state.meta.step + 1;
      step <= state.meta.step + additionalSteps;
      step++
    ) {
      await simulator.runStep(step);
    }
  }

  async replay(
    runId: string,
    fromStep: number,
    toStep: number
  ): Promise<DiffResult[]> {
    const diffs: DiffResult[] = [];

    for (let step = fromStep; step < toStep; step++) {
      const before = await this.snapshotManager.loadStep(runId, step);
      const after = await this.snapshotManager.loadStep(runId, step + 1);
      diffs.push(this.computeDiff(before, after));
    }

    return diffs;
  }
}
```

---

## 8. LLM Integration Architecture

### 8.1 Prompt Template System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LLM PROMPT ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  src/prompts/                                                           │
│  ├── templates/                     # Reusable prompt components        │
│  │   ├── persona-context.ts         # Persona description template      │
│  │   ├── reputation-context.ts      # Reputation summary template       │
│  │   ├── network-context.ts         # Network connections template      │
│  │   └── memory-context.ts          # Recent memory template            │
│  │                                                                     │
│  ├── scenarios/                     # Scenario-specific prompts         │
│  │   ├── investment/                                                    │
│  │   │   ├── accept.ts              # Stage 0: Accept/Refuse            │
│  │   │   ├── allocate.ts            # Stage 1: Allocation               │
│  │   │   ├── return.ts              # Stage 3: Return decision          │
│  │   │   └── reputation-update.ts   # Post-game reputation              │
│  │   │                                                                 │
│  │   ├── pd-game/                                                       │
│  │   │   ├── cooperate.ts           # Cooperate/Defect decision         │
│  │   │   └── reputation-update.ts                                        │
│  │   │                                                                 │
│  │   └── sign-up/                                                       │
│  │       ├── chat.ts                # Chat initiation                   │
│  │       └── conversation.ts        # Conversation generation           │
│  │                                                                     │
│  ├── gossip/                                                            │
│  │   ├── generate.ts                # Gossip narrative generation       │
│  │   ├── evaluate.ts                # Credibility evaluation            │
│  │   └── spread.ts                  # Second-order spread decision      │
│  │                                                                     │
│  └── network/                                                           │
│      ├── connect.ts                 # Connection decision               │
│      └── disconnect.ts              # Disconnection decision            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Structured JSON Output Pattern

```typescript
// src/prompts/base.ts

export interface PromptContext {
  persona: Persona;
  target?: Persona;
  history: string[];
  reputation?: ReputationEntry;
  network?: NetworkView;
  step: number;
}

export abstract class PromptTemplate<T> {
  abstract build(context: PromptContext): string;
  abstract schema: z.ZodSchema<T>;

  async execute(llm: LLMClient, context: PromptContext): Promise<T> {
    const prompt = this.build(context);
    const response = await llm.request({
      messages: [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response);
    return this.schema.parse(parsed);
  }

  protected abstract getSystemPrompt(): string;
}

// src/prompts/scenarios/investment/allocate.ts

export class AllocatePrompt extends PromptTemplate<InvestmentDecision> {
  schema = InvestmentDecisionSchema;

  build(context: PromptContext): string {
    return `
You are ${context.persona.state.name}, an investor in a trust game.

Your personality: ${context.persona.state.learned.investor || 'Rational and strategic'}

Your current resources: ${context.persona.state.resourcesUnit} units

Your reputation history as investor:
${this.formatReputation(context.reputation)}

Recent interactions:
${context.history.slice(-5).join('\n')}

You are paired with a trustee. You must decide:
1. Accept the game and allocate between 1-10 units
2. Refuse to play

If you accept, the trustee will receive 3x your allocation and may return some portion.

Respond with valid JSON:
{
  "accept": true/false,
  "amount": 1-10 (if accepting),
  "reasoning": "your strategic reasoning"
}
`;
  }

  getSystemPrompt(): string {
    return 'You are a strategic agent in an investment game. Respond only with valid JSON.';
  }
}
```

### 8.3 LLM Client Extension

```typescript
// src/openrouter.ts (extended)

export class LLMClient {
  async request<T>(
    prompt: PromptTemplate<T> | LLMRequestOptions,
    schema?: z.ZodSchema<T>
  ): Promise<T> {
    if (prompt instanceof PromptTemplate) {
      return prompt.execute(this, prompt.context);
    }

    const response = await this.rawRequest(prompt);
    const parsed = JSON.parse(response);

    if (schema) {
      return schema.parse(parsed);
    }

    return parsed;
  }

  private async rawRequest(options: LLMRequestOptions): Promise<string> {
    return this.rateLimitedCall(async () => {
      const completion = await this.client.chat.completions.create({
        model: this.modelId,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 500,
        response_format: options.response_format ?? { type: 'json_object' },
      });

      return completion.choices[0]?.message?.content ?? '';
    });
  }
}
```

---

## 9. Configuration System

### 9.1 Default Configuration

```typescript
// src/config/defaults.ts

export const DEFAULT_CONFIG: SimulationConfig = {
  // MSPN legacy
  maxRounds: 3,
  beliefUpdateStrength: { proposal: 0.2, review: 0.15 },
  payoffNoise: 1,
  initialBeliefAlignment: 0.7,

  // Multi-agent
  agentCount: 20,
  scenario: 'mspn',

  // Reputation
  reputationBackend: 'repunet',

  // Gossip
  enableGossip: false,
  gossipConfig: {
    enabled: false,
    maxSpreadDepth: 2,
    credibilityDecay: 0.3,
    recentWindow: 30,
    listenerSelection: 'random',
  },

  // Network
  enableNetwork: false,
  networkConfig: {
    enabled: false,
    blackListMaxSize: 5,
    observationInterval: 5,
    initialConnectivity: 0.3,
  },

  // Storage
  storageConfig: {
    basePath: './sim_storage',
    runId: '', // Auto-generated
    persistInterval: 1,
  },

  // Ablation
  ablationMode: 'full',

  // LLM
  concurrency: 4,
  rateLimitMs: 200,
};
```

### 9.2 Configuration Validation

```typescript
// src/config/validation.ts

export const SimulationConfigSchema = z.object({
  maxRounds: z.number().min(1).max(10).default(3),
  beliefUpdateStrength: z
    .object({
      proposal: z.number().min(0).max(1).default(0.2),
      review: z.number().min(0).max(1).default(0.15),
    })
    .default({ proposal: 0.2, review: 0.15 }),

  agentCount: z.number().min(2).max(100).default(20),
  scenario: z
    .enum(['mspn', 'investment', 'pd_game', 'sign_up'])
    .default('mspn'),

  reputationBackend: z.enum(['karma', 'repunet', 'hybrid']).default('repunet'),

  enableGossip: z.boolean().default(false),
  gossipConfig: z
    .object({
      enabled: z.boolean().default(false),
      maxSpreadDepth: z.number().min(1).max(5).default(2),
      credibilityDecay: z.number().min(0).max(1).default(0.3),
      recentWindow: z.number().min(1).max(100).default(30),
      listenerSelection: z
        .enum(['random', 'reputation_weighted'])
        .default('random'),
    })
    .default({}),

  enableNetwork: z.boolean().default(false),
  networkConfig: z
    .object({
      enabled: z.boolean().default(false),
      blackListMaxSize: z.number().min(1).max(20).default(5),
      observationInterval: z.number().min(1).max(20).default(5),
      initialConnectivity: z.number().min(0).max(1).default(0.3),
    })
    .default({}),

  storageConfig: z
    .object({
      basePath: z.string().default('./sim_storage'),
      runId: z.string().optional(),
      persistInterval: z.number().min(1).default(1),
    })
    .default({}),

  ablationMode: z
    .enum(['full', 'no_gossip', 'no_reputation', 'minimal'])
    .default('full'),

  concurrency: z.number().min(1).max(20).default(4),
  rateLimitMs: z.number().min(50).default(200),
});
```

### 9.3 Environment Variables

```typescript
// .env.example

# LLM Configuration
OPENROUTER_API_KEY=your_api_key_here
LLM_MODEL_PRIMARY=google/gemini-2.5-flash-lite
LLM_MODEL_SECONDARY=mistralai/mistral-small-3.1-24b-instruct
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=500

# Rate Limiting
RATE_LIMIT_MS=200

# Storage
SIM_STORAGE_PATH=./sim_storage

# Defaults
DEFAULT_AGENT_COUNT=20
DEFAULT_SCENARIO=investment
```

---

## 10. Combinatorial Ablation Design

### 10.1 Four-Variant Matrix

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ABLATION VARIANT MATRIX                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          GOSSIP                                         │
│                    ┌─────────┬─────────┐                                │
│                    │   ON    │   OFF   │                                │
│        ┌───────────┼─────────┼─────────┤                                │
│        │    ON     │  FULL   │ NO_GOSS │  ← Reputation-driven pairing   │
│  REP   │           │         │         │    Reputation updates active   │
│        ├───────────┼─────────┼─────────┤                                │
│        │   OFF     │ NO_REP  │ MINIMAL │  ← Random pairing              │
│        │           │         │         │    No reputation tracking      │
│        └───────────┴─────────┴─────────┘                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Variant Code Paths

```typescript
// src/ablation/variants.ts

export type VariantName = 'full' | 'no_gossip' | 'no_reputation' | 'minimal';

export interface AblationConfig {
  useReputation: boolean;
  useGossip: boolean;
  useNetworkEvolution: boolean;
  useObservationUpdates: boolean;
}

export const VARIANT_CONFIGS: Record<VariantName, AblationConfig> = {
  full: {
    useReputation: true,
    useGossip: true,
    useNetworkEvolution: true,
    useObservationUpdates: true,
  },
  no_gossip: {
    useReputation: true,
    useGossip: false,
    useNetworkEvolution: true, // Still use reputation for pairing
    useObservationUpdates: true,
  },
  no_reputation: {
    useReputation: false,
    useGossip: true,
    useNetworkEvolution: false,
    useObservationUpdates: false,
  },
  minimal: {
    useReputation: false,
    useGossip: false,
    useNetworkEvolution: false,
    useObservationUpdates: false,
  },
};

export class AblationRunner {
  async runAllVariants(
    baseConfig: SimulationConfig,
    steps: number
  ): Promise<Record<VariantName, RunResult>> {
    const results: Partial<Record<VariantName, RunResult>> = {};

    for (const variant of Object.keys(VARIANT_CONFIGS) as VariantName[]) {
      const config = this.applyVariant(baseConfig, variant);
      const simulator = new MultiAgentSimulator(config);

      await simulator.initialize();
      for (let step = 1; step <= steps; step++) {
        await simulator.runStep(step);
      }

      results[variant] = await simulator.getResults();
    }

    return results as Record<VariantName, RunResult>;
  }

  private applyVariant(
    base: SimulationConfig,
    variant: VariantName
  ): SimulationConfig {
    const ablationConfig = VARIANT_CONFIGS[variant];
    return {
      ...base,
      ablationMode: variant,
      enableGossip: ablationConfig.useGossip,
      enableNetwork: ablationConfig.useNetworkEvolution,
      reputationBackend: ablationConfig.useReputation ? 'repunet' : 'karma',
    };
  }
}
```

### 10.3 Scenario-Specific Directories

```
src/scenarios/
├── investment/
│   ├── full/                    # With reputation + gossip
│   │   ├── prompts.ts
│   │   └── executor.ts
│   ├── no_gossip/               # Reputation only
│   ├── no_reputation/           # Gossip only
│   └── minimal/                 # Neither
│
├── pd-game/
│   ├── full/
│   ├── no_gossip/
│   ├── no_reputation/
│   └── minimal/
│
└── sign-up/
    ├── full/
    ├── no_gossip/
    ├── no_reputation/
    └── minimal/
```

---

## 11. Visualization Architecture

### 11.1 Network Graph Visualization

```typescript
// src/visualize/network.ts

import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export class NetworkVisualizer {
  async renderNetwork(
    network: SocialNetwork,
    reputations: Map<string, number>,
    outputPath: string
  ): Promise<void> {
    const elements = this.buildElements(network, reputations);

    const cy = cytoscape({
      elements,
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 50,
        rankSep: 100,
      },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            width: 30,
            height: 30,
            'font-size': 10,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#ccc',
            'target-arrow-color': '#ccc',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        {
          selector: 'edge.blocked',
          style: {
            'line-color': '#ff6666',
            'line-style': 'dashed',
          },
        },
      ],
    });

    const png = cy.png({ full: true, scale: 2 });
    await fs.promises.writeFile(outputPath, png, 'base64');
  }

  private buildElements(
    network: SocialNetwork,
    reputations: Map<string, number>
  ): cytoscape.ElementsDefinition {
    const nodes: cytoscape.NodeDefinition[] = [];
    const edges: cytoscape.EdgeDefinition[] = [];

    // Create nodes
    for (const [agentId, score] of reputations) {
      nodes.push({
        data: {
          id: agentId,
          label: agentId,
          color: this.scoreToColor(score),
        },
      });
    }

    // Create edges
    for (const edge of network.getAllEdges()) {
      edges.push({
        data: {
          id: `${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
        },
        classes: network.isBlocked(edge.from, edge.to) ? 'blocked' : '',
      });
    }

    return { nodes, edges };
  }

  private scoreToColor(score: number): string {
    // score is in [-1, 1]
    // Map to color: red (-1) → white (0) → green (1)
    const normalized = (score + 1) / 2; // [0, 1]
    const red = Math.round(255 * (1 - normalized));
    const green = Math.round(255 * normalized);
    return `rgb(${red}, ${green}, 100)`;
  }
}
```

### 11.2 Reputation Evolution Charts

```typescript
// src/visualize/reputation.ts

export class ReputationVisualizer {
  async renderEvolution(
    history: ReputationHistory[],
    outputPath: string
  ): Promise<void> {
    // Generate data for chart
    const data = this.prepareChartData(history);

    // Use a chart library (or generate ASCII for CLI)
    const chart = this.generateChart(data);

    await fs.promises.writeFile(outputPath, chart);
  }

  private prepareChartData(history: ReputationHistory[]): ChartData {
    const steps = [...new Set(history.map((h) => h.step))].sort(
      (a, b) => a - b
    );

    const agents = [...new Set(history.map((h) => h.agentName))];

    const series = agents.map((agent) => ({
      name: agent,
      values: steps.map((step) => {
        const entry = history.find(
          (h) => h.agentName === agent && h.step === step
        );
        return entry?.aggregateScore ?? 0;
      }),
    }));

    return { steps, series };
  }
}
```

### 11.3 Gossip Propagation Timeline

```typescript
// src/visualize/gossip.ts

export class GossipVisualizer {
  renderPropagationTree(gossipChain: GossipEntry[]): string {
    // ASCII art representation of gossip cascade
    const lines: string[] = [];

    const root = gossipChain.find((g) => g.sourceChain.length === 1);
    if (!root) return 'No gossip to visualize';

    lines.push(`Gossip about ${root.complainedName}:`);
    lines.push(`  "${root.gossipInfo.substring(0, 50)}..."`);
    lines.push('');
    lines.push('Propagation:');

    this.renderNode(root, gossipChain, lines, 0);

    return lines.join('\n');
  }

  private renderNode(
    entry: GossipEntry,
    allEntries: GossipEntry[],
    lines: string[],
    depth: number
  ): void {
    const indent = '  '.repeat(depth);
    const credColor = this.credibilitySymbol(entry.credibilityLevel);

    lines.push(`${indent}├─ ${entry.gossiperName} [${credColor}]`);

    // Find children (entries where this entry is in sourceChain)
    const children = allEntries.filter(
      (e) =>
        e.sourceChain.includes(entry.gossiperName) &&
        e.sourceChain.length === entry.sourceChain.length + 1
    );

    for (const child of children) {
      this.renderNode(child, allEntries, lines, depth + 1);
    }
  }

  private credibilitySymbol(level: CredibilityLevel): string {
    switch (level) {
      case 'very_credible':
        return '✓✓';
      case 'credible':
        return '✓';
      case 'uncredible':
        return '✗';
      case 'very_uncredible':
        return '✗✗';
    }
  }
}
```

---

## 12. Migration Path

### 12.1 Backward Compatibility

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MIGRATION PATH                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phase A: Parallel Operation (Backward Compatible)                      │
│  ─────────────────────────────────────────────                          │
│  • Existing MSPN code unchanged                                         │
│  • New modules added alongside                                          │
│  • Config flag enables new features                                     │
│  • Karma backend available for legacy behavior                          │
│                                                                         │
│  Phase B: Feature Parity                                                │
│  ─────────────────────                                                  │
│  • MSPN game extracted to scenario plugin                               │
│  • Agent class extended to Persona                                      │
│  • Tests pass for both old and new paths                                │
│                                                                         │
│  Phase C: Deprecation                                                   │
│  ─────────────────                                                      │
│  • Legacy Agent class deprecated (not removed)                          │
│  • Karma backend maintained but not default                             │
│  • Documentation updated                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.2 API Compatibility

```typescript
// Backward compatible API
export async function runEpisode(
  episodeId: number,
  apiKey?: string,
  useReputation: boolean = false,
  seed?: string,
  reputationSystem?: ReputationSystem
): Promise<EpisodeResult>;

// New extended API
export async function runMultiAgentSimulation(
  config: SimulationConfig
): Promise<SimulationResult>;

// Unified API (recommended)
export async function runSimulation(
  config: SimulationConfig | LegacyConfig
): Promise<SimulationResult | EpisodeResult> {
  if (isLegacyConfig(config)) {
    return runEpisode(
      config.episodeId,
      config.apiKey,
      config.useReputation,
      config.seed
    );
  }
  return runMultiAgentSimulation(config);
}
```

### 12.3 Data Migration

```typescript
// src/storage/migration.ts

export class DataMigrator {
  migrateKarmaToReputation(
    karmaData: Record<string, number>
  ): Map<string, ReputationEntry> {
    const entries = new Map<string, ReputationEntry>();

    for (const [agentId, karma] of Object.entries(karmaData)) {
      const score = (karma - 50) / 50; // Convert 0-100 to -1 to 1

      entries.set(agentId, {
        name: agentId,
        id: parseInt(agentId.replace('model-', '')),
        role: 'proposer',
        content: `Migrated karma score: ${karma}`,
        numericalRecord: {
          investmentFailures: 0,
          trusteeFailures: 0,
          returnIssues: 0,
          returnSuccesses: Math.max(0, Math.floor(score * 10)),
          investorSuccesses: Math.max(0, Math.floor(score * 10)),
        },
        reason: 'Migrated from legacy karma system',
        updatedAtStep: 0,
      });
    }

    return entries;
  }
}
```

---

## 13. Risk Assessment & Mitigation

### 13.1 Updated Risk Matrix

| Risk                             | Severity | Likelihood | Mitigation                                                                             | Owner      |
| -------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------- | ---------- |
| **LLM prompt divergence**        | Medium   | High       | Validate against RepuNet outputs with same LLM. Accept structured JSON as improvement. | Phase 5    |
| **Scale mismatch**               | Medium   | Medium     | Use p-limit concurrency. Profile early. Keep N configurable.                           | Phase 4    |
| **State consistency**            | High     | Medium     | Serialize reputation updates. Use AsyncMutex.                                          | Phase 4    |
| **Gossip complexity**            | Medium   | Medium     | Extensive mock testing before real LLM calls.                                          | Phase 3    |
| **Regression risk**              | High     | Low        | Phase 4 extracts MSPN as plugin first. All existing tests preserved.                   | Phase 4    |
| **Graph library learning curve** | Low      | Low        | Cytoscape is well-documented. Start with simple visualizations.                        | Phase 6    |
| **Token costs**                  | Medium   | High       | Default to mock mode. Document expected costs. Use cheap models.                       | All phases |
| **Resume logic bugs**            | Medium   | Medium     | Comprehensive resume tests. Verify snapshot integrity.                                 | Phase 4    |
| **Configuration explosion**      | Low      | Medium     | Sensible defaults. Validation schema. Document all options.                            | Phase 1    |
| **Memory leaks in long runs**    | Medium   | Low        | Profile memory in Phase 7. Implement cleanup in snapshot manager.                      | Phase 7    |

### 13.2 Mitigation Strategies

**LLM Prompt Divergence:**

- Run parallel tests with RepuNet Python and MSPN TypeScript
- Compare reputation scores, network density, and gossip patterns
- Accept ~10% behavioral divergence as acceptable

**State Consistency:**

```typescript
// Use mutex for shared state updates
class ReputationUpdateCoordinator {
  private mutex = new AsyncMutex();

  async update(agentId: string, entry: ReputationEntry): Promise<void> {
    await this.mutex.acquire();
    try {
      this.db.updateReputation(agentId, entry);
    } finally {
      this.mutex.release();
    }
  }
}
```

**Token Costs:**

```typescript
// Cost estimation
const COST_PER_1K_TOKENS = {
  'google/gemini-2.5-flash-lite': 0.00001,
  'mistralai/mistral-small-3.1-24b-instruct': 0.0001,
};

function estimateCost(config: SimulationConfig): number {
  const callsPerStep = config.agentCount * 2; // Rough estimate
  const tokensPerCall = 500;
  const totalTokens = callsPerStep * tokensPerCall * config.steps;
  return (totalTokens * COST_PER_1K_TOKENS[config.model]) / 1000;
}
```

---

## 14. Milestones & Deliverables

### 14.1 Milestone Summary

| Milestone             | Phase | Deliverable                        | Verification Criteria                     | Est. Date |
| --------------------- | ----- | ---------------------------------- | ----------------------------------------- | --------- |
| **M1: Data Model**    | 1     | AgentState, ReputationDB, GossipDB | Unit tests pass; types compile            | Day 3     |
| **M2: Network**       | 2     | SocialNetwork module               | Graph operations correct; bind/black work | Day 5     |
| **M3: Gossip**        | 3     | GossipEngine with propagation      | Gossip spreads; credibility decays        | Day 8     |
| **M4: Multi-Agent**   | 4     | N-agent simulator with plugins     | MSPN tests pass; 20-agent runs complete   | Day 11    |
| **M5: Scenarios**     | 5     | Investment + PD + Sign-up          | Correct payoffs; reputation updates fire  | Day 15    |
| **M6: Visualization** | 6     | Network + reputation viz           | Dashboard renders; no errors              | Day 17    |
| **M7: Validated**     | 7     | E2E integration tests              | All tests pass; dynamics match RepuNet    | Day 20    |

### 14.2 Deliverable Checklist

**M1 Deliverables:**

- [ ] `src/types.ts` extended with all new types
- [ ] `src/persona/scratch.ts` implements AgentState
- [ ] `src/persona/memory.ts` implements AssociativeMemory
- [ ] `src/reputation/reputation-db.ts` implements ReputationDatabase
- [ ] `src/reputation/gossip-db.ts` implements GossipDatabase
- [ ] `src/schemas.ts` extended with Zod schemas
- [ ] Unit tests for all data structures passing

**M2 Deliverables:**

- [ ] `src/network/social-network.ts` implements SocialNetwork
- [ ] Bind/black list management working
- [ ] Network decision prompts added
- [ ] NetworkDecisionSchema added
- [ ] Unit tests for graph operations passing

**M3 Deliverables:**

- [ ] `src/reputation/gossip.ts` implements GossipEngine
- [ ] First-order gossip working
- [ ] Second-order gossip with decay working
- [ ] Gossip prompts and schemas added
- [ ] Unit tests with mock LLM passing

**M4 Deliverables:**

- [ ] `src/scenarios/scenario.ts` defines Scenario interface
- [ ] `src/scenarios/mspn-negotiation.ts` extracts MSPN game
- [ ] `src/agent.ts` extended to Persona
- [ ] `src/simulator.ts` supports multi-agent
- [ ] `src/persona/seed.ts` persona generation
- [ ] All existing MSPN tests passing
- [ ] 20-agent test run completes without error

**M5 Deliverables:**

- [ ] `src/scenarios/investment.ts` implements InvestmentScenario
- [ ] `src/scenarios/prisoner-dilemma.ts` implements PDScenario
- [ ] `src/scenarios/sign-up.ts` implements SignUpScenario
- [ ] Scenario prompts and schemas complete
- [ ] Unit tests per scenario passing

**M6 Deliverables:**

- [ ] Network graph visualization working
- [ ] Reputation evolution charts working
- [ ] Gossip propagation timeline working
- [ ] Visualization tests passing

**M7 Deliverables:**

- [ ] All integration tests passing
- [ ] Reputation dynamics match RepuNet qualitatively
- [ ] No regressions in MSPN functionality
- [ ] Performance within targets
- [ ] Documentation complete

---

## 15. Open Questions & Recommendations

### 15.1 Architecture Decisions

| Question                   | Options                               | Recommendation                                                                                   |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Hybrid reputation mode     | Merge scores vs. parallel             | **Maintain both in parallel**. Let scenarios choose which to query.                              |
| Prompt strategy            | RepuNet role-play vs. MSPN structured | **Use MSPN structured-output style** for reliability. Include persona context in system prompts. |
| Agent identity persistence | Per-episode reset vs. cross-episode   | **Persist for RepuNet scenarios**. MSPN's per-episode reset remains default.                     |
| Scenario mixing            | Single vs. mixed per run              | **Single scenario per run** initially. Consider mixing in future iteration.                      |
| Network library            | Cytoscape vs. vis-network vs. custom  | **Cytoscape** for maturity and features. Custom adjacency-list for internal operations.          |

### 15.2 Implementation Priorities

**High Priority:**

1. Reputation database with 5-tuple scoring
2. Multi-agent support with scenario plugins
3. Investment scenario (most studied in RepuNet)
4. Filesystem snapshot persistence

**Medium Priority:**

1. Gossip engine with two-tier propagation
2. Social network with connect/disconnect
3. PD and Sign-up scenarios
4. Network visualization

**Lower Priority:**

1. Resume/replay functionality
2. Diff analysis across steps
3. Advanced gossip listener selection
4. Hybrid reputation backend

### 15.3 Future Enhancements

1. **Community Detection**: Add clustering coefficient and community detection to network analysis
2. **Reputation Algebra**: Explore mathematical reputation composition beyond LLM-driven updates
3. **Async Gossip**: Investigate concurrent gossip propagation with conflict resolution
4. **Web Dashboard**: Real-time visualization with WebSocket updates
5. **Experiment Manager**: Batch run orchestration with parameter sweeps

---

## Appendix A: File Creation Checklist

| File                                  | Phase | Priority |
| ------------------------------------- | ----- | -------- |
| `src/types.ts` (extended)             | 1     | High     |
| `src/persona/scratch.ts`              | 1     | High     |
| `src/persona/memory.ts`               | 1     | High     |
| `src/persona/seed.ts`                 | 4     | High     |
| `src/persona/index.ts`                | 1     | Medium   |
| `src/reputation/reputation-db.ts`     | 1     | High     |
| `src/reputation/gossip-db.ts`         | 1     | High     |
| `src/reputation/gossip.ts`            | 3     | High     |
| `src/reputation/reputation-update.ts` | 5     | High     |
| `src/reputation/index.ts`             | 1     | Medium   |
| `src/network/social-network.ts`       | 2     | High     |
| `src/network/index.ts`                | 2     | Medium   |
| `src/scenarios/scenario.ts`           | 4     | High     |
| `src/scenarios/mspn-negotiation.ts`   | 4     | High     |
| `src/scenarios/investment.ts`         | 5     | High     |
| `src/scenarios/prisoner-dilemma.ts`   | 5     | Medium   |
| `src/scenarios/sign-up.ts`            | 5     | Medium   |
| `src/scenarios/index.ts`              | 4     | Medium   |
| `src/storage/snapshot.ts`             | 4     | High     |
| `src/storage/run-manager.ts`          | 4     | Medium   |
| `src/storage/index.ts`                | 4     | Medium   |
| `src/ablation/variants.ts`            | 4     | Medium   |
| `src/ablation/index.ts`               | 4     | Low      |
| `src/prompts.ts` (extended)           | 2-5   | High     |
| `src/schemas.ts` (extended)           | 1-5   | High     |
| `src/visualize.ts` (extended)         | 6     | Medium   |
| `sim_storage/profiles.json`           | 4     | Medium   |

---

## Appendix B: Test Plan

### B.1 Unit Tests (Per Phase)

| Module             | Test Count | Key Tests                           |
| ------------------ | ---------- | ----------------------------------- |
| AgentState         | ~10        | Serialization, defaults, validation |
| AssociativeMemory  | ~8         | Node CRUD, queries, persistence     |
| ReputationDatabase | ~15        | CRUD, scoring, history              |
| GossipDatabase     | ~10        | CRUD, credibility tracking          |
| SocialNetwork      | ~12        | Edge ops, black list, serialization |
| GossipEngine       | ~15        | Propagation, decay, evaluation      |
| Scenarios          | ~20 each   | Stage sequences, payoffs, pairing   |

### B.2 Integration Tests

| Test Suite           | Tests | Purpose                                 |
| -------------------- | ----- | --------------------------------------- |
| Multi-Agent          | ~10   | N-agent coordination, state consistency |
| Scenario Integration | ~15   | End-to-end scenario execution           |
| Ablation             | ~8    | All 4 variants produce valid results    |
| Resume               | ~5    | Resume from snapshot works              |
| Regression           | ~20   | All existing MSPN tests pass            |

### B.3 Performance Benchmarks

| Benchmark                | Target | Measurement |
| ------------------------ | ------ | ----------- |
| 20-agent, 10-step (mock) | <60s   | Wall clock  |
| 20-agent, 5-step (LLM)   | <10min | Wall clock  |
| Memory (20-agent)        | <500MB | Peak RSS    |
| Snapshot save            | <100ms | Per step    |

---

_End of Comprehensive Integration Plan_
