/**
 * Scenario — Pluggable game scenario interface.
 *
 * All game scenarios (MSPN, Investment, PD, Sign-up) implement this interface.
 * The simulator uses it to run any scenario through a uniform execution pipeline.
 */

import { AgentState, ScenarioResult, ReputationBackend, RepuNetConfig } from '../types';
import { SocialNetwork } from '../network/social-network';
import { GossipEngine } from '../reputation/gossip';

/** Context passed to scenario execution */
export interface ScenarioContext {
  step: number;
  network: SocialNetwork;
  reputationBackend: ReputationBackend | null;
  gossipEngine: GossipEngine | null;
  config: RepuNetConfig;
  /** If true, use mock (non-LLM) decision logic */
  mockMode: boolean;
}

/** A scenario plugin that can be executed by the simulator */
export interface Scenario {
  /** Unique scenario name */
  name: string;
  /** Roles agents can take in this scenario */
  roles: string[];

  /**
   * Pair agents for this step's interactions.
   * Returns arrays of agent pairs (could be 2+ agents per group).
   */
  pair(
    agents: AgentState[],
    network: SocialNetwork,
    step: number
  ): Array<[AgentState, AgentState]>;

  /**
   * Execute a single interaction between a pair of agents.
   * Returns the result including payoffs, actions, and history.
   */
  execute(
    pair: [AgentState, AgentState],
    context: ScenarioContext
  ): Promise<ScenarioResult>;

  /**
   * Update reputations after an interaction.
   * Called after execute() for each pair.
   */
  updateReputation(
    pair: [AgentState, AgentState],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void>;
}

/** Registry for available scenarios */
const scenarioRegistry: Map<string, Scenario> = new Map();

export function registerScenario(scenario: Scenario): void {
  scenarioRegistry.set(scenario.name, scenario);
}

export function getScenario(name: string): Scenario | undefined {
  return scenarioRegistry.get(name);
}

export function getAvailableScenarios(): string[] {
  return Array.from(scenarioRegistry.keys());
}
