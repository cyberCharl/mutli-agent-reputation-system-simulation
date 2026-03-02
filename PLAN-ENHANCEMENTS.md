# Multi-Agent Reputation System Enhancement Plan

*Generated 2026-03-02*

## Scope

This plan focuses on practical improvements that strengthen the core research question:

**Does reputation visibility change agent behavior in mixed-motive multi-agent settings?**

It is grounded in the current codebase state:

- `src/game.ts` implements a hardcoded 2-role MSPN negotiation loop.
- `src/reputation.ts` implements a scalar, centrally-scored karma system with static consequences.
- `src/simulator.ts` runs a baseline vs reputation A/B test and writes summary episode outputs.
- `src/agent.ts` wraps LLM/mock agents with prompt-time karma visibility and local consequence enforcement.
- `.ai/plans/PLAN.md` already covers some completed MVP work such as reputation persistence, prompt wiring, and basic stats.

This document therefore prioritizes the next layer of work rather than re-planning completed items.

## Prioritization Summary

### P0 Critical

1. Event-sourced observability and traceability
2. Generalize the simulation kernel beyond fixed A/B roles
3. Evaluation hardening: multi-evaluator support, agreement metrics, and ground-truth checks
4. Statistical rigor upgrades for experiment design and reporting

### P1 Important

5. Anti-gaming reputation mechanics: stake, identity cost, and decay windows
6. Scenario expansion beyond MSPN
7. Hierarchical reputation for sub-agents and delegation
8. Configurable rubrics and context-sensitive reputation policies
9. Behaviorally meaningful mock and synthetic agents

### P2 Nice-to-have

10. Dynamic norm emergence experiments
11. Federated anomaly detection and monitoring coordination
12. Goodhart-resistance stress tests and failure-mode benchmarks

## Design Principles

- Preserve reproducibility: every new stochastic component must be seedable.
- Separate mechanism from scenario: reputation, evaluation, and logging should not be MSPN-specific.
- Prefer append-only artifacts over ad hoc console logs.
- Keep ground-truth labels explicit wherever the environment can supply them.
- Make the minimum architectural changes needed to unlock multiple experiments.

## P0 Enhancements

### P0.1 Event-Sourced Observability and Causal Tracing

**Problem statement**

The current simulator stores only coarse episode results plus free-form string history. There is no structured trace connecting prompt inputs, agent decisions, evaluator outputs, reputation updates, and final outcomes. That blocks debugging, causal analysis, and post hoc audit of whether visible reputation actually changed decisions.

**Proposed solution**

Introduce a typed event log and trace model:

- Add a shared event schema with event types such as `episode_started`, `agent_prompted`, `agent_acted`, `action_constrained`, `belief_updated`, `evaluator_scored`, `reputation_updated`, and `episode_finished`.
- Replace free-form-only history as the primary audit artifact with structured episode traces.
- Assign `runId`, `episodeId`, `turnId`, `agentId`, `parentSpanId`, and `causeEventIds` so downstream analysis can reconstruct decision chains.
- Keep the existing human-readable `history` as a derived convenience view.
- Write traces to NDJSON for streaming-safe output plus a compact per-episode JSON summary.

**Technical approach**

- Create `src/telemetry/events.ts` for event types and validation.
- Create `src/telemetry/logger.ts` for buffered append-only logging.
- Thread a `SimulationLogger` through `runEpisode`, `Agent.act`, `MSPNGame` transitions, evaluators, and `ReputationSystem.inspectAndUpdate`.
- Add an adapter that derives the current string `history` from events to preserve compatibility.

**Files affected**

- `src/simulator.ts`
- `src/agent.ts`
- `src/game.ts`
- `src/reputation.ts`
- `src/types.ts`
- `src/visualize.ts`
- New: `src/telemetry/events.ts`
- New: `src/telemetry/logger.ts`
- New: `tests/telemetry.test.ts`

**Estimated effort**

4-6 days

**Definition of done**

- Every episode produces a structured trace file.
- Each agent action has a corresponding prompt, output, and post-constraint event.
- Each reputation update records source evaluator, rubric version, and delta reason.
- `history` is generated from structured events rather than being the only record.
- Existing result generation still works.

**Validation mechanism**

- Unit tests validate event schemas and event ordering invariants.
- Run 20 seeded episodes twice and confirm identical trace content modulo timestamps.
- Spot-check that a breach episode can be reconstructed from trace alone.
- Build one analysis script that computes action frequencies from NDJSON without reading `history`.

**Research questions enabled**

- Which specific reputation signals changed a decision?
- Do agents react to reputation warnings directly, or only after constraints are enforced?
- Are outcome differences driven by behavior change or evaluator/reputation artifacts?

---

### P0.2 Generalize the Simulation Kernel to N Agents and Role Graphs

**Problem statement**

Core types and logic are hardcoded to `A`/`B`, proposer/reviewer sequencing, and two-party payoffs. That prevents testing whether reputation effects survive in larger populations, rotating counterparties, or mixed coalitional settings.

**Proposed solution**

Refactor the simulation around generic agents, roles, and interaction protocols:

- Replace fixed `AgentId = 'A' | 'B'` with generic `AgentId = string`.
- Replace `agentBeliefs: { a, b }` and two-party payoffs with maps keyed by agent id.
- Introduce a `Scenario` interface describing turn order, legal actions, state transition logic, payoff resolution, and ground truth.
- Recast MSPN as one implementation of that interface.
- Add a role graph or turn scheduler so one episode can contain arbitrary participants and role assignments.

**Technical approach**

- Add `src/scenarios/types.ts` with `Scenario`, `ScenarioState`, `ScenarioAction`, and `ScenarioOutcome`.
- Move MSPN logic into `src/scenarios/mspn.ts`.
- Update `runEpisode` to consume a scenario instance plus roster config.
- Extend reputation lookups to arbitrary model or identity ids.
- Maintain a compatibility wrapper for current CLI entrypoints that creates a 2-agent MSPN scenario.

**Files affected**

- `src/types.ts`
- `src/game.ts` or replace with `src/scenarios/mspn.ts`
- `src/simulator.ts`
- `src/agent.ts`
- `src/compare.ts`
- `src/reputation.ts`
- New: `src/scenarios/types.ts`
- New: `src/scenarios/mspn.ts`
- New: `tests/scenario-kernel.test.ts`

**Estimated effort**

1.5-2.5 weeks

**Definition of done**

- The simulator can run the existing MSPN experiment with no behavior regression.
- The simulator can run at least one 3+ agent scenario using the same kernel.
- Payoffs, beliefs, and event traces are keyed by arbitrary agent ids.
- No core module assumes exactly two agents.

**Validation mechanism**

- Regression tests confirm current 2-agent MSPN outputs remain stable under seeded runs.
- New tests run a 3-agent scenario with deterministic synthetic agents.
- Static search for `model-A`, `model-B`, `'A'`, `'B'`, `.a`, `.b` in core runtime paths yields only compatibility or fixture code.

**Research questions enabled**

- Does reputation visibility still improve cooperation when interactions are not strictly dyadic?
- Does role asymmetry matter less or more in larger agent populations?
- How does public reputation interact with partner selection and coalition formation?

---

### P0.3 Evaluation Hardening: Multi-Evaluator, Agreement Metrics, Ground Truth

**Problem statement**

Reputation updates currently come from a single hardcoded scoring function tied directly to episode outcome. That is brittle and risks evaluator bias. The system needs evaluator comparison, ground-truth checks, and inter-rater reliability to ensure measured reputation effects are not artifacts of one oracle.

**Proposed solution**

Build an evaluator layer:

- Introduce a pluggable evaluator interface with multiple implementations:
  - deterministic outcome-based scorer
  - rubric-based judge
  - optional LLM evaluator
- Store evaluator outputs separately from the final reputation decision.
- Add evaluator aggregation modes such as majority vote, weighted average, and adjudication-on-disagreement.
- Compute inter-rater reliability metrics such as percent agreement and Cohen/Fleiss-style agreement where applicable.
- Use environment ground truth when available to check evaluator correctness.

**Technical approach**

- Create `src/evaluation/types.ts` and `src/evaluation/evaluators/*`.
- Refactor `ReputationSystem.inspectAndUpdate` into:
  - `collectEvaluations(episodeTrace)`
  - `aggregateEvaluations(evaluations, policy)`
  - `applyReputationDelta(decision)`
- Extend result artifacts to include evaluator records and agreement summaries.

**Files affected**

- `src/reputation.ts`
- `src/simulator.ts`
- `src/types.ts`
- New: `src/evaluation/types.ts`
- New: `src/evaluation/evaluators/outcome.ts`
- New: `src/evaluation/evaluators/rubric.ts`
- New: `src/evaluation/evaluators/llm.ts`
- New: `src/evaluation/aggregate.ts`
- New: `tests/evaluation.test.ts`

**Estimated effort**

1-1.5 weeks

**Definition of done**

- At least two evaluator implementations are available and runnable in the simulator.
- Episode outputs include raw evaluator judgments plus the aggregated decision.
- Agreement metrics are reported per run.
- Reputation updates can be reproduced from stored evaluator artifacts.

**Validation mechanism**

- Unit tests cover evaluator aggregation and disagreement handling.
- A seeded benchmark set with hand-labeled cases yields expected evaluator rankings.
- Run a comparison where one evaluator is intentionally perturbed and verify disagreement surfaces in the summary.

**Research questions enabled**

- Are apparent reputation effects robust across evaluators?
- Which kinds of actions are evaluator-sensitive?
- How much does evaluator disagreement inflate uncertainty in outcome claims?

---

### P0.4 Statistical Rigor for Experiment Planning and Reporting

**Problem statement**

The current simulator reports a paired t-test and bootstrap confidence intervals, but lacks power analysis, effect sizes, multiple-comparison control, and experiment manifests. That makes it too easy to underpower claims or over-interpret noisy treatment differences.

**Proposed solution**

Add an experiment-analysis layer that standardizes:

- minimum sample size planning from expected effect sizes
- preregistered metric manifest per run
- effect size reporting such as Cohen's d or rank-based alternatives
- multiple comparison corrections for runs with many metrics or scenarios
- stratified reporting by scenario, model family, and role

**Technical approach**

- Extend `src/stats.ts` with power analysis helpers, multiple testing corrections, and effect size calculators.
- Add `ExperimentConfig` and `AnalysisManifest` types.
- Save planned hypotheses and metrics next to run results.
- Fail fast or warn when configured episode count is below target power.

**Files affected**

- `src/stats.ts`
- `src/simulator.ts`
- `src/cli.ts`
- `src/types.ts`
- New: `src/analysis/manifest.ts`
- New: `tests/stats-power.test.ts`

**Estimated effort**

4-6 days

**Definition of done**

- Run configuration supports target power, alpha, and expected effect size.
- Results report effect sizes and corrected p-values alongside raw p-values.
- Multi-scenario runs identify which tests belong to the same correction family.
- Summary artifacts include the analysis manifest used.

**Validation mechanism**

- Unit tests compare power/effect-size outputs to known reference cases.
- Simulate a multi-metric run and verify corrected significance differs from raw significance where expected.
- Manual review confirms run summaries contain enough information for later replication.

**Research questions enabled**

- Are detected reputation effects practically meaningful, not only statistically detectable?
- How many episodes are needed per scenario to resolve a given hypothesis?
- Which reported wins survive correction for multiple comparisons?

## P1 Enhancements

### P1.1 Anti-Gaming Reputation Mechanics: Stake, Identity Cost, Recovery Windows

**Problem statement**

The current scalar karma system is vulnerable to sybil attacks, karma laundering, and low-cost opportunism. Agents can rebuild reputation too cheaply and there is no commitment mechanism that makes misconduct costly.

**Proposed solution**

Upgrade reputation from a single balance to a policy-driven ledger:

- Add stake-backed actions where risky moves require escrow that can be slashed.
- Add identity creation cost or warm-up periods for new identities.
- Separate long-term trust from short-term behavior windows to reduce laundering.
- Add severity-weighted recovery rules so severe breaches require sustained good behavior.
- Track suspicious identity clusters and interaction rings for simple anomaly flags.

**Technical approach**

- Replace direct integer deltas with ledger entries carrying `reason`, `severity`, `window`, `stakeChange`, and `source`.
- Introduce `IdentityProfile` with age, lineage, and interaction graph metadata.
- Add policy config for slashing, cooldowns, and recovery curves.

**Files affected**

- `src/reputation.ts`
- `src/types.ts`
- `src/simulator.ts`
- New: `src/reputation/policy.ts`
- New: `src/reputation/ledger.ts`
- New: `src/reputation/identity.ts`
- New: `tests/reputation-policy.test.ts`

**Estimated effort**

1-1.5 weeks

**Definition of done**

- Reputation updates are stored as ledger entries, not only clamped totals.
- The simulator can enable stake requirements for selected actions.
- New identities cannot immediately bypass consequences without paying configured costs.
- Severe misconduct is not fully erased by a few low-risk positive actions.

**Validation mechanism**

- Adversarial tests simulate sybil creation and laundering patterns.
- Recovery-curve tests show slow rebuild after severe breaches.
- Trace output exposes stake posted, slashing events, and anomaly flags.

**Research questions enabled**

- Does visible stake amplify the behavioral effect of reputation?
- Which anti-gaming mechanisms preserve cooperation without freezing exploration?
- How robust are reputation effects under strategic identity manipulation?

---

### P1.2 Scenario Expansion Beyond MSPN

**Problem statement**

A single MSPN scenario is too narrow to support claims about reputation effects in mixed-motive settings generally. Results may be scenario-specific.

**Proposed solution**

Add at least two new scenarios with distinct incentive structures:

- resource allocation / commons management
- delegated monitoring or incident triage with false positives and false negatives

Scenarios should differ on:

- whether cooperation is symmetric or role-asymmetric
- whether ground truth is partially observable
- whether one agent can exploit another via trust

**Technical approach**

- Implement new scenarios on top of the generalized kernel from P0.2.
- Define scenario-specific state, legal actions, payoffs, and ground-truth labels.
- Reuse the same agent wrapper, evaluation layer, and reputation system.

**Files affected**

- New: `src/scenarios/commons.ts`
- New: `src/scenarios/triage.ts`
- `src/simulator.ts`
- `src/cli.ts`
- `src/visualize.ts`
- New: `tests/scenarios/commons.test.ts`
- New: `tests/scenarios/triage.test.ts`

**Estimated effort**

1-2 weeks after P0.2

**Definition of done**

- The CLI can select scenario type.
- At least three scenarios total are runnable under one experiment harness.
- Each scenario exports ground-truth labels and evaluator hooks.
- Result summaries are scenario-aware.

**Validation mechanism**

- Unit tests cover transition and payoff logic for each scenario.
- Smoke tests run each scenario with mock agents and save valid outputs.
- Cross-scenario reports show metrics grouped by scenario.

**Research questions enabled**

- Are reputation effects scenario-general or domain-local?
- Does reputation help more in prevention, coordination, or monitoring games?
- Which scenario properties moderate the treatment effect?

---

### P1.3 Hierarchical Reputation for Sub-Agents and Delegation

**Problem statement**

If agents delegate work to spawned sub-agents, the current system has no notion of lineage or karma propagation. That creates a major loophole and prevents studying delegation accountability.

**Proposed solution**

Add hierarchical identity and attribution:

- Support parent-child agent relationships and delegation events.
- Propagate reputation effects according to configurable rules:
  - full parent liability
  - partial shared liability
  - escrowed delegation liability
- Include delegated task scope and authority limits in traces and evaluation.

**Technical approach**

- Extend identity model with `parentAgentId`, `delegationDepth`, and `spawnReason`.
- Add delegation-aware evaluator fields so bad delegated actions can be attributed to both actor and sponsor.
- Add simulator support for sub-agent creation in scenarios that use delegation.

**Files affected**

- `src/reputation.ts`
- `src/agent.ts`
- `src/types.ts`
- `src/simulator.ts`
- New: `src/reputation/hierarchy.ts`
- New: `tests/reputation-hierarchy.test.ts`

**Estimated effort**

4-6 days after P1.1 foundation

**Definition of done**

- Agents can spawn child identities under policy control.
- Reputation updates can target child, parent, or both.
- Trace artifacts capture delegation chains.
- A delegation scenario demonstrates propagation behavior.

**Validation mechanism**

- Unit tests cover propagation policies.
- Adversarial test confirms a parent cannot fully escape a child breach under configured shared-liability mode.
- Trace review shows complete lineage for delegated actions.

**Research questions enabled**

- Does parent accountability change willingness to delegate?
- Can hierarchical reputation reduce blame-shifting behavior?
- How should reputation propagate in agent organizations?

---

### P1.4 Configurable Rubrics and Context-Sensitive Reputation Policies

**Problem statement**

Reputation rules are hardcoded and globally uniform. That prevents norm variation, domain-specific scoring, and controlled experiments about what kinds of reputation signals matter.

**Proposed solution**

Externalize the rubric and consequence policy:

- Define rubric config files with dimensions such as safety, honesty, reciprocity, efficiency, and monitoring effort.
- Support scenario-specific weighting and context-dependent rules.
- Version rubric configs and store the version with every evaluation.
- Allow experiments to swap rubric families without code changes.

**Technical approach**

- Load rubric definitions from JSON or YAML.
- Update evaluator and reputation policy code to consume rubric configs.
- Add schema validation and defaults.

**Files affected**

- `src/reputation.ts`
- `src/evaluation/*`
- `src/types.ts`
- New: `src/config/rubric-schema.ts`
- New: `config/rubrics/default.json`
- New: `config/rubrics/safety-first.json`
- New: `tests/rubric-config.test.ts`

**Estimated effort**

4-5 days

**Definition of done**

- Reputation and evaluation rules can be swapped by config.
- Rubric version is stored in outputs and trace events.
- Invalid rubric files fail validation with actionable errors.
- At least two rubric presets ship with the repo.

**Validation mechanism**

- Config validation tests for missing/invalid dimensions.
- A/B run using two rubric presets produces different evaluator outputs on the same episodes.
- Summaries clearly show which rubric was active.

**Research questions enabled**

- Which norms must be visible for reputation to change behavior?
- Does emphasizing safety vs efficiency alter cooperation patterns?
- Are reputation effects robust to rubric design choices?

---

### P1.5 Behaviorally Meaningful Mock and Synthetic Agents

**Problem statement**

Current mock agents are stochastic but still shallow. They do not explicitly model reputation sensitivity, risk appetite, deception, or strategic adaptation well enough to isolate mechanism effects without paying for live LLM runs.

**Proposed solution**

Add configurable synthetic agent archetypes:

- reputation-sensitive cooperator
- opportunist that defects when expected gains exceed penalty
- laundering attacker
- sybil attacker
- monitor-heavy cautious agent

These should respond to visible reputation, stake, and evaluator policy in explicit, testable ways.

**Technical approach**

- Split `LLMModel` mock behavior into a strategy layer with parameterized policies.
- Add `SyntheticAgentPolicy` configs.
- Allow simulator runs mixing synthetic and live LLM agents.

**Files affected**

- `src/agent.ts`
- `src/simulator.ts`
- New: `src/agents/synthetic.ts`
- New: `tests/synthetic-agents.test.ts`

**Estimated effort**

4-6 days

**Definition of done**

- The simulator supports selecting synthetic agent archetypes by config.
- At least four archetypes produce measurably different behavior distributions.
- Reputation-visible vs hidden conditions produce divergent actions for at least one archetype.

**Validation mechanism**

- Distribution tests compare action frequencies by archetype.
- Seeded runs show stable reproducibility.
- Mechanism checks verify an opportunist defects less under high visible stake/reputation penalty.

**Research questions enabled**

- Which strategic profiles are most responsive to visible reputation?
- Can observed effects be reproduced without model-specific LLM quirks?
- What failure modes should live-model experiments target?

## P2 Enhancements

### P2.1 Dynamic Norm Emergence Experiments

**Problem statement**

Static rubrics cannot answer whether norms can emerge endogenously from repeated interaction and feedback.

**Proposed solution**

Add a mode where rubric weights or sanction policies adapt over time based on population outcomes, evaluator consensus, or coordination proposals.

**Technical approach**

- Introduce a norm update policy that periodically revises rubric weights.
- Log every norm revision as a first-class event.
- Compare fixed-norm vs adaptive-norm populations.

**Files affected**

- `src/reputation.ts`
- `src/evaluation/*`
- New: `src/norms/update-policy.ts`
- New: `tests/norm-emergence.test.ts`

**Estimated effort**

1 week

**Definition of done**

- Norm updates are configurable, reproducible, and logged.
- Runs can compare fixed and adaptive norm regimes.

**Validation mechanism**

- Seeded runs show deterministic norm evolution under synthetic agents.
- Summaries include norm trajectories over time.

**Research questions enabled**

- Can useful norms emerge without a fixed external rubric?
- Does visible reputation accelerate convergence to stable norms?

---

### P2.2 Federated Anomaly Detection and Monitoring Coordination

**Problem statement**

Samuele Marro’s suggestion points to trust as a distributed monitoring problem, but the current simulator lacks coordination mechanisms around anomaly detection.

**Proposed solution**

Model agents as contributors to a shared monitoring or anomaly scoring process with reputation-weighted trust in reports, plus explicit Schelling-point coordination rules for escalation.

**Technical approach**

- Add a monitoring scenario with noisy private signals.
- Use reputation to weight reports and escalate when a coordination threshold is met.
- Compare centralized vs federated aggregation.

**Files affected**

- New: `src/scenarios/federated-monitoring.ts`
- New: `src/monitoring/aggregation.ts`
- `src/reputation.ts`
- `src/simulator.ts`

**Estimated effort**

1-1.5 weeks after P0.2 and P1.2

**Definition of done**

- A federated monitoring scenario runs end-to-end.
- Reputation can weight monitor reports.
- Coordination thresholds are configurable.

**Validation mechanism**

- Simulated noisy-signal tests show different false positive and false negative rates under different trust schemes.
- Trace output shows why an escalation threshold was reached.

**Research questions enabled**

- Does reputation improve distributed monitoring quality?
- Can Schelling-point escalation rules stabilize coordination under uncertainty?

---

### P2.3 Goodhart-Resistance and Malthusian Trap Stress Tests

**Problem statement**

Any explicit metric may be gamed. Without dedicated stress tests, the system may reward optimization against the evaluator rather than actual cooperative behavior.

**Proposed solution**

Add benchmark suites that intentionally push agents toward evaluator exploitation, over-optimization of visible metrics, or population dynamics where competition erodes quality.

**Technical approach**

- Create adversarial synthetic populations and evaluator-blind-spot scenarios.
- Track divergence between evaluator score, ground truth, and welfare metrics.
- Add failure dashboards highlighting Goodhart gaps.

**Files affected**

- `src/evaluation/*`
- `src/visualize.ts`
- New: `src/benchmarks/goodhart.ts`
- New: `tests/goodhart-benchmark.test.ts`

**Estimated effort**

4-6 days

**Definition of done**

- At least two benchmark suites demonstrate metric gaming pressure.
- Reports highlight when evaluator score improves while true welfare degrades.

**Validation mechanism**

- Benchmark runs reproduce known failure patterns using synthetic agents.
- Summary artifacts explicitly flag score-welfare divergence.

**Research questions enabled**

- When does visible reputation become a proxy target rather than a cooperation mechanism?
- Which policy variants are most resistant to metric gaming?

## Dependency Map

### Core dependencies

- `P0.1 Event-sourced observability` is the foundation for reliable debugging, evaluator audit, and most advanced analysis.
- `P0.2 Generalized simulation kernel` is required before meaningful multi-agent, sub-agent, and multi-scenario work.
- `P0.3 Evaluation hardening` depends on `P0.1` for auditability and should land before anti-gaming claims are trusted.
- `P0.4 Statistical rigor` can begin in parallel with `P0.1`, but final integration depends on richer run metadata from `P0.1` and `P0.3`.

### Downstream dependencies

- `P1.1 Anti-gaming mechanics` depends on `P0.1` and benefits from `P0.3`.
- `P1.2 Scenario expansion` depends on `P0.2`.
- `P1.3 Hierarchical reputation` depends on `P0.2` and `P1.1`.
- `P1.4 Configurable rubrics` depends on `P0.3`.
- `P1.5 Synthetic agents` can start earlier, but is much more useful once `P0.1` traces and `P1.1` policies exist.
- `P2.1` depends on `P1.4`.
- `P2.2` depends on `P0.2`, `P0.3`, and `P1.2`.
- `P2.3` depends on `P0.3`, `P1.1`, and preferably `P1.5`.

## Suggested Execution Order

1. P0.1 Event-sourced observability
2. P0.2 Generalized simulation kernel
3. P0.3 Evaluation hardening
4. P0.4 Statistical rigor
5. P1.1 Anti-gaming mechanics
6. P1.2 Scenario expansion
7. P1.4 Configurable rubrics
8. P1.5 Synthetic agents
9. P1.3 Hierarchical reputation
10. P2.1 Dynamic norms
11. P2.2 Federated monitoring
12. P2.3 Goodhart-resistance benchmarks

## Parallel Work Breakdown for Multiple Coding Agents

### Workstream A: Core runtime refactor

- Own `P0.2`
- Prepare compatibility adapters so existing CLI/tests keep passing
- Deliver scenario kernel before new scenarios begin

### Workstream B: Telemetry and analysis infrastructure

- Own `P0.1`
- Add trace schemas, writers, and analysis helpers
- Coordinate schema contracts with all other streams

### Workstream C: Evaluation and rubric layer

- Own `P0.3` and `P1.4`
- Build evaluator interfaces, aggregation, agreement metrics, and config-driven rubrics
- Depends on telemetry schemas from Workstream B

### Workstream D: Stats and experiment design

- Own `P0.4`
- Add power analysis, effect sizes, correction logic, and analysis manifests
- Can proceed mostly in parallel after result schemas stabilize

### Workstream E: Reputation policy hardening

- Own `P1.1` and later `P1.3`
- Build ledger, stake, identity-cost, lineage, and delegation propagation
- Depends on Workstreams A, B, and C

### Workstream F: Scenario and agent expansion

- Own `P1.2`, `P1.5`, and later `P2.2`
- Build new scenarios and synthetic agent archetypes
- Depends on Workstream A; benefits from Workstream E policies

### Integration checkpoints

- Checkpoint 1: after `P0.1` and `P0.2`, freeze core schemas for one cycle
- Checkpoint 2: after `P0.3` and `P0.4`, run a pilot experiment and validate end-to-end outputs
- Checkpoint 3: after `P1.1`, `P1.2`, and `P1.5`, run adversarial and cross-scenario experiments

## Suggested Issue Breakdown

1. Create trace event schema and NDJSON writer
2. Instrument `runEpisode` and `ReputationSystem` with structured events
3. Introduce scenario interface and wrap existing MSPN logic
4. Migrate state/payoff types from fixed `a/b` fields to keyed maps
5. Build evaluator interface and outcome-based evaluator
6. Add rubric evaluator and evaluator aggregation
7. Extend stats with effect sizes, power analysis, and multiple-comparison correction
8. Convert scalar karma updates into ledger entries with policy hooks
9. Implement identity age, stake, and recovery-window mechanics
10. Add commons scenario
11. Add monitoring/triage scenario
12. Add synthetic archetype agent framework
13. Add delegation lineage and reputation propagation
14. Add rubric config loader and presets
15. Build pilot notebooks or scripts for trace analysis and evaluator agreement

## Risks and Tradeoffs

- A full N-agent refactor is the highest leverage change, but also the largest regression risk. Preserve a compatibility MSPN path until scenario-kernel tests are stable.
- More sophisticated reputation policies without evaluator hardening risk making bias less visible, not less severe.
- Dynamic norm work should wait until fixed-rubric experiments are reproducible, otherwise interpretability drops sharply.
- LLM evaluator support is useful, but deterministic evaluators and hand-labeled fixtures should remain the anchor for validation.

## Minimum Research-Ready Milestone

The smallest milestone that materially improves the project’s ability to answer the core question is:

- `P0.1` event traces
- `P0.2` generalized kernel with at least one 3-agent scenario
- `P0.3` multi-evaluator scoring with agreement metrics
- `P0.4` effect sizes and power analysis
- `P1.2` one non-MSPN scenario
- `P1.5` one reputation-sensitive synthetic agent and one adversarial synthetic agent

At that point the project can test whether visible reputation changes behavior across more than one scenario, with auditable traces and defensible evaluation.
