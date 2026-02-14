# RepuNet — Repository Analysis

> Comprehensive architecture, module, data-flow, configuration, runtime, dependency, and algorithm documentation for the RepuNet codebase.
>
> Generated: 2026-02-13 | Source: <https://github.com/RGB-0000FF/RepuNet>

---

## 1. Overview

RepuNet is a **Python-based multi-agent simulation framework** for studying reputation dynamics in social networks. It models how agents form, update, and propagate reputations through direct interactions and gossip, and how these reputations drive social network evolution (connection/disconnection decisions).

The system implements three game-theoretic scenarios — **Investment Game**, **Sign-up/Chat**, and **Prisoner's Dilemma** — each with optional reputation tracking and gossip propagation. All agent decisions are made by LLM calls (OpenAI-compatible API), making this an LLM-driven agent-based model (ABM).

### Key Design Principles

- **LLM-as-decision-engine**: Every non-trivial agent decision (invest, cooperate, evaluate gossip, connect/disconnect) is an LLM call with structured prompt templates.
- **Filesystem-based persistence**: Each simulation step is a full snapshot in `sim_storage/<run>/step_N/`, enabling resume, replay, and diff analysis.
- **Combinatorial ablation**: 4 variants per scenario (with/without reputation x with/without gossip) as separate code paths to keep LLM prompts clean.
- **NetworkX social graphs**: Directed graphs model agent relationships per role, with bind/black lists governing connection state.

---

## 2. Directory Structure

```
RepuNet/
├── start.py                          # Interactive REPL entry point (Creation class)
├── auto_run.py                       # Non-interactive CLI entry point
├── prompt_interface.py               # LLM request layer (prompt templating + API calls)
├── pyproject.toml                    # Project metadata + dependencies
│
├── scripts/
│   ├── run_simulation.py             # Auto-seed + run orchestrator
│   └── batch_run.sh                  # Parallel batch launcher
│
├── persona/
│   ├── persona.py                    # Persona class (agent container)
│   └── memory_structures/
│       ├── scratch.py                # Scratch class (mutable agent state)
│       └── associative_memory.py     # AssociativeMemory (event/chat log)
│
├── reputation/
│   ├── reputation_database.py        # ReputationDB class
│   ├── gossip_database.py            # GossipDB class
│   ├── reputation_update.py          # Post-interaction reputation update orchestration
│   ├── social_network.py             # Network rewiring (connect/disconnect decisions)
│   ├── gossip.py                     # Gossip generation and propagation
│   └── prompt_template/
│       ├── run_gpt_prompt.py         # LLM prompt functions for reputation decisions
│       └── prompt/                   # Text template files with !<INPUT N>! placeholders
│
├── task/
│   ├── investment/                   # Investment game (with reputation + gossip)
│   ├── investment_without_gossip/    # Investment game (reputation only)
│   ├── investment_without_reputation/
│   ├── investment_without_reputation_without_gossip/
│   ├── sign_up/                      # Sign-up/Chat scenario variants
│   ├── sign_up_without_gossip/
│   ├── sign_up_without_reputation/
│   ├── sign_up_without_reputation_without_gossip/
│   ├── pd_game/                      # Prisoner's Dilemma variants
│   ├── pd_game_without_gossip/
│   ├── pd_game_without_reputation/
│   └── pd_game_without_reputation_without_gossip/
│
├── sim_storage/
│   ├── change_sim_folder.py          # Seed generation + persona initialization
│   ├── export_profiles.py            # Extract persona profiles for reuse
│   ├── profiles.json                 # Custom persona descriptions (optional)
│   └── <run_name>/step_N/            # Simulation snapshots (runtime-generated)
│
└── analysis/                         # Post-hoc analysis notebooks/scripts
```

---

## 3. Module Architecture

### 3.1 Core Agent Model

#### `persona/persona.py` — Persona Class

The top-level agent container. Each persona owns a `Scratch` (mutable state), `AssociativeMemory` (event log), `ReputationDB`, and `GossipDB`.

```
Persona
├── name: str
├── scratch: Scratch              # Mutable agent state
├── a_mem: AssociativeMemory      # Event/chat history
├── reputation_db: ReputationDB   # Reputation scores for other agents
├── gossip_db: GossipDB           # Gossip heard about others
└── folder_mem: str               # Filesystem path to agent's data
```

**Key methods:**
- `save(save_folder)` — Persist all sub-structures to filesystem
- `get_latest_memory_list(n)` — Recent events from associative memory
- `update_interaction_memory(event)` — Record direct interaction
- `update_observation_memory(event)` — Record observed interaction

#### `persona/memory_structures/scratch.py` — Scratch Class

Mutable per-step agent state: identity, role, counters, relationships, resources.

```python
Scratch:
  name: str
  innate: str | None              # Immutable personality (unused in most scenarios)
  learned: dict | str             # Role-keyed learned traits, updated by LLM
  currently: str | None           # Current activity description
  ID: int                         # 0-based unique identifier
  role: str | None                # Current role (investor/trustee/player/resident)
  curr_step: int                  # Current simulation step
  complain_buffer: list           # Grievances to gossip about
  total_num_investor: int         # Investment game counters
  success_num_investor: int
  total_num_trustee: int
  success_num_trustee: int
  total_chat_num: int             # Sign-up scenario counters
  success_chat_num: int
  relationship:
    bind_list: list               # Active connections: [[name, role], ...]
    black_list: deque(maxlen=5)   # Blocked agents (bounded)
  resources_unit: int             # Starting capital (default 10)
  observed: dict                  # Witnessed interactions (for later reputation update)
```

#### `persona/memory_structures/associative_memory.py` — AssociativeMemory

Triple-store event log with three node types:
- `Node(id, subject, predicate, object, description, created_at)` — Base
- `Chat(...)` — Adds `conversation` field
- `Event(...)` — Event-specific

Persisted as `nodes.json`. Key methods: `add_chat()`, `add_event()`, `get_latest_event_with_target()`.

### 3.2 Reputation Subsystem

#### `reputation/reputation_database.py` — ReputationDB

Stores per-agent reputation assessments of other agents.

**Reputation entry structure:**
```json
{
  "name": "Agent Name",
  "ID": 0,
  "role": "Trustee",
  "content": "Narrative description of agent's behavior",
  "numerical record": "(a, b, c, d, e)",
  "reason": "Why this was updated"
}
```

The **5-tuple numerical record** encodes:
- `a` — investment failures
- `b` — trustee failures
- `c` — return issues
- `d` — return successes
- `e` — investor successes

**Key methods:**
- `get_targets_individual_reputation(target_index, role)` — Look up reputation of a specific agent
- `update_individual_reputation(reputation, curr_step, reason)` — Update and archive old value to `out_of_date_reputations`
- `get_all_reputations(role, self_id, with_self)` — List all reputations for a role

**Persistence:** `reputation_database.json` (current) + `out_of_date_reputation_database.json` (historical).

#### `reputation/gossip_database.py` — GossipDB

Stores gossip heard about other agents with credibility assessment.

**Gossip entry structure:**
```json
{
  "complained name": "Target Name",
  "complained ID": 0,
  "complained role": "Trustee",
  "gossiper role": "Investor",
  "gossip info": "Description of alleged behavior",
  "credibility level": "very credible | credible | uncredible | very uncredible",
  "whether to spread gossip second-hand": "Yes | No",
  "reasons": "...",
  "created_at": 5
}
```

**Key methods:**
- `add_gossip(gossips, curr_step)` — Add entries, increment credibility counters
- `get_target_gossips_info(target_persona)` — Retrieve recent gossip (30-step window)

#### `reputation/reputation_update.py` — Update Orchestration

Post-interaction reputation update functions that coordinate LLM calls:

| Function | Trigger |
|----------|---------|
| `reputation_update_invest(A, B, info, full)` | After investment game stage 4 |
| `reputation_update_sign_up(A, B, info)` | After sign-up chat |
| `reputation_update_pd_game(A, B, info)` | After PD game round |
| `reputation_update_after_gossip_*(...)` | After receiving gossip |
| `learned_update_sign(persona, role, view)` | Update learned trait post-chat |
| `learned_update_invest(persona, role, view)` | Update learned trait post-investment |

Each function: (1) calls LLM to produce new reputation assessment, (2) calls `update_individual_reputation()` to persist, (3) optionally updates learned traits.

#### `reputation/social_network.py` — Network Rewiring

Decides connect/disconnect based on interaction outcomes. Uses NetworkX DiGraph per role.

**`social_network_update()` flow:**
1. LLM asked: "Should you disconnect from this agent?"
2. If YES + connection exists → move to `black_list`, remove from `bind_list`
3. If NO + no connection → LLM asked: "Should you connect?"
4. If YES → add to `bind_list`

**Graph structure:**
- `G["investor"]` — Directed edges from investor i to trustee j
- `G["trustee"]` — Directed edges from trustee i to investor j
- `G["player"]` — Edges for PD game
- `G["resident"]` — Edges for sign-up scenario

#### `reputation/gossip.py` — Gossip Propagation

Two-tier gossip mechanism:

1. **First-order gossip** (`first_order_gossip`):
   - Gossiper (with `complain_buffer` entries) selects listener via LLM
   - Generates gossip conversation
   - Listener evaluates credibility (LLM)
   - Updates listener's ReputationDB
   - May trigger network rewiring
   - If marked "spread" → triggers second-order

2. **Second-order gossip** (`second_order_gossip`):
   - Listener becomes gossiper to a third party
   - Carries credibility decay information
   - Same evaluation + update cycle

### 3.3 Prompt Template System

#### `prompt_interface.py`

Central LLM interaction layer:

- **`generate_prompt_role_play(curr_input, template_file)`** — Loads template with `!<INPUT N>!` placeholders, substitutes values, splits on `<commentblockmarker>###</commentblockmarker>` into system/user messages.
- **`llm_request(prompt, gpt_parameter)`** — Calls OpenAI-compatible API. Supports dict prompts (system+user) and plain strings.
- **`safe_generate_response(prompt, params, repeat=5, fail_safe, validate, cleanup)`** — Retry wrapper with validation and cleanup functions.

Each scenario has `task/<scenario>/prompt_template/run_gpt_prompt.py` containing scenario-specific prompt builders (e.g., `run_gpt_prompt_investor_decided_v1`, `run_gpt_prompt_stage2_game_result_v1`).

---

## 4. Key Algorithms

### 4.1 Reputation Score Aggregation

For investment game, the aggregate reputation score is derived from the 5-tuple:

```
score = numerical_record[4] + numerical_record[3] - numerical_record[1] - numerical_record[0]
clamp(score, -1, 1)
```

Where indices map to: `[invest_fail, trustee_fail, return_issues, return_success, investor_success]`.

This produces a normalized score in [-1, 1] representing net trustworthiness.

### 4.2 Reputation-Weighted Pairing

Investment game pairing algorithm:

1. Shuffle agents into investor/trustee pools
2. Sort investors by average reputation score (descending — highest-reputation agents pick first)
3. For each investor:
   - With 50% probability: LLM selects trustee from connected trustees based on reputation
   - Otherwise: random selection from unchosen trustees
4. Return `(investor, trustee)` pairs

This creates a **reputation-stratified matching** where high-reputation investors get priority access to preferred partners.

### 4.3 Network Evolution

Connect/disconnect decisions follow a **two-stage LLM gate**:

```
For each agent pair after interaction:
  1. LLM: "Should you disconnect?"
     → YES + connected: remove from bind_list, add to black_list (max 5, FIFO eviction)
     → NO: proceed to step 2
  2. LLM: "Should you connect?"
     → YES + not connected: add to bind_list
     → NO: no change
```

The bounded black_list (deque, maxlen=5) means agents can eventually reconnect after old grudges are evicted.

### 4.4 Gossip Credibility Cascade

```
Gossiper has grievance → selects listener
  → Generates gossip narrative (LLM)
  → Listener evaluates credibility (LLM):
      "very credible" | "credible" | "uncredible" | "very uncredible"
  → Listener updates reputation of complained agent
  → Listener decides connect/disconnect with complained agent
  → If listener marks "spread":
      → Listener becomes second-order gossiper
      → Selects new listener
      → Credibility information decays through chain
```

### 4.5 Observation-Based Reputation (Investment)

Every 5 steps, observation-based updates fire:

1. All agents collect `observed` interactions (witnessed investment games)
2. For each witness, retrieve their memory of the interaction
3. LLM updates witness's reputation of both investor and trustee
4. Witness decides connect/disconnect based on observed behavior

This models **third-party reputation formation** — agents form opinions from watching others, not just from direct experience.

### 4.6 Investment Stage Sequence

```
Stage 0: Investor decides Accept/Refuse (LLM)
  └─ Refuse → end interaction

Stage 1: Investor allocates 1-10 units (LLM)
  └─ Trustee receives 3x allocated amount

Stage 3: Trustee returns 0%/25%/75%/100%/150% (LLM)
  └─ Investor receives returned amount

Stage 4: Reputation + Network Update
  ├─ Both agents update reputations (LLM)
  ├─ Both agents update learned traits (LLM)
  ├─ Social network rewires (LLM)
  └─ Every 5 steps: observation-based updates from witnesses
```

### 4.7 Prisoner's Dilemma Stage Sequence

```
Stage 1: Both accept to play

Stage 2: Each independently chooses Cooperate/Defect (LLM, parallel)

Stage 3: Payoff resolution
  CC → (3,3)  |  CD → (0,5)  |  DC → (5,0)  |  DD → (1,1)

Stage 4: Reputation + Network Update + Gossip Queue

Post-step: Sequential gossip execution
```

PD games run with `ThreadPoolExecutor` for parallel pair execution, with gossip serialized afterward.

### 4.8 Sign-up/Chat Sequence

```
Step N (every 5 steps): New agent signs up
  → Existing agents update reputations of newcomer

Each step: Chat phase
  → Random pairing
  → Each decides to chat based on partner's reputation (LLM)
  → If both accept: generate conversation (LLM), summarize (LLM)
  → Update reputations based on chat quality
  → Network rewires
  → Optional gossip
```

---

## 5. Configuration System

### 5.1 `utils.py` (User-Created)

Not included in the repository — must be created by the user:

```python
import os

openai_api_key = os.getenv("OPENAI_API_KEY", "sk-...")
key_owner = "user_id"
fs_storage = "./sim_storage"

llm_model = os.getenv("LLM_MODEL", "gpt-4o-mini")
llm_api_base = os.getenv("LLM_API_BASE", "https://api.openai.com/v1")

gpt_default_params = {
    "engine": llm_model,
    "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "4096")),
    "temperature": float(os.getenv("LLM_TEMPERATURE", "0")),
    "top_p": float(os.getenv("LLM_TOP_P", "1")),
    "stream": False,
    "frequency_penalty": float(os.getenv("LLM_FREQUENCY_PENALTY", "0")),
    "presence_penalty": float(os.getenv("LLM_PRESENCE_PENALTY", "0")),
    "stop": None,
}

def default_gpt_params():
    return gpt_default_params.copy()
```

### 5.2 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | LLM API key |
| `LLM_MODEL` | `gpt-4o-mini` | Model name |
| `LLM_API_BASE` | `https://api.openai.com/v1` | API endpoint |
| `LLM_MAX_TOKENS` | `4096` | Max output tokens |
| `LLM_TEMPERATURE` | `0` | Sampling temperature |
| `LLM_TOP_P` | `1` | Nucleus sampling |
| `LLM_FREQUENCY_PENALTY` | `0` | Frequency penalty |
| `LLM_PRESENCE_PENALTY` | `0` | Presence penalty |

### 5.3 Persona Profiles

`sim_storage/profiles.json` supports custom persona definitions, either flat or scenario-keyed:

```json
{
  "investment": {
    "Persona Name": {"investor": "risk-averse...", "trustee": "reliable..."}
  },
  "pd_game": {
    "Persona Name": "tit-for-tat strategist..."
  }
}
```

**Default personas (20):** 10 "Rational" (self-interested) + 10 "Altruistic" (cooperative).

---

## 6. Runtime & Execution Model

### 6.1 Entry Points

| Entry Point | Mode | Command |
|-------------|------|---------|
| `start.py` | Interactive REPL | `python start.py` |
| `auto_run.py` | Non-interactive CLI | `python auto_run.py --sim <path> --mode <scenario> --steps N --reputation y --gossip n` |
| `scripts/run_simulation.py` | Auto-seed + run | `python scripts/run_simulation.py --scenario pd --steps 5 --reputation y --gossip n` |
| `scripts/batch_run.sh` | Parallel batch | `bash scripts/batch_run.sh` |

### 6.2 Simulation Loop

```python
for step in 1..N:
    copy step_{x} → step_{x+1}           # Full snapshot

    pairs = pair_each(personas, G)         # Reputation-weighted pairing

    for pair in pairs:
        start_<scenario>(pair, ...)        # Execute game + updates

    save(personas)                         # Persist to step_{x+1}/
```

### 6.3 Parallel Execution (PD Game)

PD games use `ThreadPoolExecutor` with max_workers=len(pairs):
- All pairs execute concurrently with up to 5 retries on failure
- Gossip runs sequentially after all games complete (avoids race conditions on shared state)

---

## 7. Data Persistence

### 7.1 Snapshot Structure

```
sim_storage/<run>/step_N/
├── reverie/
│   └── meta.json                    # {"persona_names": [...], "step": N}
├── personas/<name>/
│   ├── memory/
│   │   ├── scratch.json             # Full Scratch state
│   │   └── associative_memory/
│   │       └── nodes.json           # Event/chat log
│   └── reputation/
│       ├── reputation_database.json
│       ├── out_of_date_reputation_database.json
│       └── gossip_database.json
└── <scenario>_results/              # Interaction records (text/JSON)
```

### 7.2 Resume Logic

`scripts/run_simulation.py` accepts:
- Exact step path: `run/step_3` → continues from step 3
- Run directory: `run` → finds largest `step_X` and continues
- Relative path from `sim_storage/`

---

## 8. Dependencies

**Python 3.13+** (from `pyproject.toml`):

| Package | Version | Purpose |
|---------|---------|---------|
| openai | >=1.97.1 | LLM API client |
| networkx | >=3.5 | Social network graphs |
| numpy | >=2.3.2 | Numerical operations |
| pandas | >=2.3.1 | Data analysis |
| matplotlib | ==3.9.4 | Plotting |
| seaborn | >=0.13.2 | Statistical visualization |
| statsmodels | >=0.14.5 | Statistical models |
| infomap | >=2.8.0 | Community detection (optional) |
| ruff | >=0.12.5 | Code linting |
| tqdm | >=4.67.1 | Progress bars |

---

## 9. Ablation Variant Matrix

The system supports all 12 combinations (3 scenarios x 4 feature toggles):

| Scenario | Reputation | Gossip | Code Path |
|----------|-----------|--------|-----------|
| Investment | Yes | Yes | `task/investment/` |
| Investment | Yes | No | `task/investment_without_gossip/` |
| Investment | No | Yes | `task/investment_without_reputation/` |
| Investment | No | No | `task/investment_without_reputation_without_gossip/` |
| Sign-up | Yes | Yes | `task/sign_up/` |
| Sign-up | Yes | No | `task/sign_up_without_gossip/` |
| Sign-up | No | Yes | `task/sign_up_without_reputation/` |
| Sign-up | No | No | `task/sign_up_without_reputation_without_gossip/` |
| PD Game | Yes | Yes | `task/pd_game/` |
| PD Game | Yes | No | `task/pd_game_without_gossip/` |
| PD Game | No | Yes | `task/pd_game_without_reputation/` |
| PD Game | No | No | `task/pd_game_without_reputation_without_gossip/` |

Each variant is a separate code path to keep LLM prompts clean (no runtime conditionals in decision-critical paths).

---

## 10. Summary: Key Classes & Methods

| Class | Module | Key Responsibility |
|-------|--------|--------------------|
| `Persona` | `persona/persona.py` | Agent container (state + memory + reputation + gossip) |
| `Scratch` | `persona/memory_structures/scratch.py` | Mutable per-step agent state |
| `AssociativeMemory` | `persona/memory_structures/associative_memory.py` | Event/chat triple-store |
| `ReputationDB` | `reputation/reputation_database.py` | Per-agent reputation scores with history |
| `GossipDB` | `reputation/gossip_database.py` | Gossip entries with credibility tracking |
| `Creation` | `start.py` | Simulation orchestrator (load, run, save) |

| Function Module | Key Functions |
|-----------------|---------------|
| `reputation/reputation_update.py` | `reputation_update_invest`, `reputation_update_pd_game`, `learned_update_*` |
| `reputation/social_network.py` | `social_network_update`, `social_network_update_after_*` |
| `reputation/gossip.py` | `first_order_gossip`, `second_order_gossip` |
| `prompt_interface.py` | `llm_request`, `safe_generate_response`, `generate_prompt_role_play` |
| `task/*/prompt_template/run_gpt_prompt.py` | Scenario-specific LLM prompt builders |
| `sim_storage/change_sim_folder.py` | `generate_seed` (persona initialization) |

---

## 11. Architectural Diagram

```
                    ┌─────────────────────────┐
                    │   Entry Point            │
                    │ start.py / auto_run.py   │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   Creation (Orchestrator) │
                    │   • load personas + graph │
                    │   • step loop             │
                    │   • save snapshots        │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
    ┌─────────▼────────┐ ┌──────▼──────┐ ┌─────────▼────────┐
    │ Investment Game   │ │ Sign-up     │ │ PD Game          │
    │ pair_each()       │ │ chat_pair() │ │ pair_each()      │
    │ start_investment()│ │ start_chat()│ │ start_pd_game()  │
    └─────────┬────────┘ └──────┬──────┘ └─────────┬────────┘
              │                  │                   │
              └──────────────────┼───────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │        Reputation Subsystem          │
              │ ┌──────────────┐ ┌────────────────┐  │
              │ │ ReputationDB │ │ GossipDB       │  │
              │ └──────┬───────┘ └───────┬────────┘  │
              │        │                 │            │
              │ ┌──────▼─────────────────▼────────┐  │
              │ │ reputation_update.py             │  │
              │ │ social_network.py                │  │
              │ │ gossip.py                        │  │
              │ └──────┬──────────────────────────┘  │
              └────────┼─────────────────────────────┘
                       │
              ┌────────▼──────────────┐
              │ prompt_interface.py    │
              │ • Template loading     │
              │ • LLM API calls        │
              │ • Retry + validation   │
              └────────┬──────────────┘
                       │
              ┌────────▼──────────────┐
              │ OpenAI-compatible API  │
              └───────────────────────┘
```

---

## 12. Design Observations & Integration Notes

1. **Heavy LLM coupling**: Nearly every decision point is an LLM call. Porting to TypeScript requires either replicating this pattern or abstracting decision-making behind an interface that can be backed by LLM or algorithmic logic.

2. **No explicit reputation algebra**: Reputation updates are narrative-driven (LLM produces new text descriptions + 5-tuple adjustments). The only mathematical aggregation is the simple score formula in Section 4.1.

3. **Filesystem as database**: All state lives in JSON files organized by step. This is straightforward to port but may benefit from in-memory state management in a TypeScript port.

4. **Gossip as information cascade**: The two-tier gossip with credibility evaluation is the most distinctive feature. It creates emergent information asymmetry that drives network evolution.

5. **Social network as directed multigraph**: Per-role graphs with bind/black lists create role-dependent relationship dynamics. The bounded black_list (max 5) is a forgiveness mechanism.

6. **20-agent default scale**: The system is designed for small-to-medium agent populations where O(n^2) pairwise interactions are feasible.
