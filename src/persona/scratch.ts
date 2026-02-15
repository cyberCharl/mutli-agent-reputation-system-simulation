import { AgentRole } from '../types';

export interface RelationshipState {
  bindList: Array<{ name: string; role: AgentRole }>;
  blackList: string[];
}

export interface RoleCounters {
  total: number;
  success: number;
}

export interface ObservedInteraction {
  step: number;
  agents: [string, string];
  roles: [AgentRole, AgentRole];
  action: string;
  outcome: string;
}

export interface AgentState {
  name: string;
  id: number;
  role: AgentRole | null;
  currentStep: number;
  innate: string | null;
  learned: Record<AgentRole, string>;
  complainBuffer: string[];
  roleCounters: Record<AgentRole, RoleCounters>;
  relationship: RelationshipState;
  resourcesUnit: number;
  observed: ObservedInteraction[];
}

function makeEmptyRoleCounters(): Record<AgentRole, RoleCounters> {
  return {
    investor: { total: 0, success: 0 },
    trustee: { total: 0, success: 0 },
    player: { total: 0, success: 0 },
    resident: { total: 0, success: 0 },
    proposer: { total: 0, success: 0 },
    reviewer: { total: 0, success: 0 },
  };
}

function makeEmptyLearned(): Record<AgentRole, string> {
  return {
    investor: '',
    trustee: '',
    player: '',
    resident: '',
    proposer: '',
    reviewer: '',
  };
}

export function createAgentState(params: {
  name: string;
  id: number;
  role?: AgentRole | null;
  innate?: string | null;
  resourcesUnit?: number;
}): AgentState {
  return {
    name: params.name,
    id: params.id,
    role: params.role ?? null,
    currentStep: 0,
    innate: params.innate ?? null,
    learned: makeEmptyLearned(),
    complainBuffer: [],
    roleCounters: makeEmptyRoleCounters(),
    relationship: {
      bindList: [],
      blackList: [],
    },
    resourcesUnit: params.resourcesUnit ?? 10,
    observed: [],
  };
}
