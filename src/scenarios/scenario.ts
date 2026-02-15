import { Persona } from '../agent';
import { SocialNetwork } from '../network';
import {
  GossipEngine,
  ReputationDatabase,
  ReputationUpdater,
} from '../reputation';
import { AgentRole, SimulationConfig, ScenarioResult } from '../types';
import { PDDecision } from '../schemas';

export interface ScenarioDecisionProvider {
  decideInvestmentAccept?(input: {
    investor: Persona;
    trustee: Persona;
    step: number;
  }): Promise<{ accept: boolean; reasoning: string }>;
  decideInvestmentAmount?(input: {
    investor: Persona;
    trustee: Persona;
    step: number;
  }): Promise<{ amount: number; reasoning: string }>;
  decideInvestmentReturn?(input: {
    trustee: Persona;
    investor: Persona;
    amount: number;
    received: number;
    step: number;
  }): Promise<{
    percentage: '0' | '25' | '75' | '100' | '150';
    reasoning: string;
  }>;
  decidePDAction?(input: {
    self: Persona;
    opponent: Persona;
    step: number;
  }): Promise<PDDecision>;
  decideSignUpAction?(input: {
    self: Persona;
    partner: Persona;
    step: number;
  }): Promise<{ action: 'sign_up' | 'wait'; reasoning: string }>;
}

export interface ScenarioContext {
  step: number;
  network: SocialNetwork;
  reputationDb: ReputationDatabase;
  reputationUpdater: ReputationUpdater;
  gossipEngine: GossipEngine | null;
  config: SimulationConfig;
  decisionProvider?: ScenarioDecisionProvider;
  rng: () => number;
}

export interface Scenario {
  name: string;
  roles: AgentRole[];
  pair(
    agents: Persona[],
    network: SocialNetwork,
    config: SimulationConfig,
    step: number
  ): Promise<Array<[Persona, Persona]>>;
  execute(
    pair: [Persona, Persona],
    context: ScenarioContext
  ): Promise<ScenarioResult>;
  updateReputation(
    pair: [Persona, Persona],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void>;
  shouldTriggerGossip(result: ScenarioResult): boolean;
}
