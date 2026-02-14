/**
 * AgentState — Ported from RepuNet's persona/memory_structures/scratch.py
 *
 * Mutable per-step agent state including identity, role, counters,
 * relationships, and resources.
 */

import { AgentState } from '../types';

const BLACK_LIST_MAX_SIZE = 5;

/** Create a fresh AgentState with default values */
export function createAgentState(
  name: string,
  id: number,
  resourcesUnit: number = 10
): AgentState {
  return {
    name,
    id,
    role: null,
    currentStep: 0,
    learned: {},
    complainBuffer: [],
    successCounts: {},
    relationship: {
      bindList: [],
      blackList: [],
    },
    resourcesUnit,
    observed: {},
  };
}

/** Advance the agent to the next step */
export function advanceStep(state: AgentState): void {
  state.currentStep += 1;
}

/** Set the agent's role for the current interaction */
export function setRole(state: AgentState, role: string): void {
  state.role = role;
}

/** Record a success or failure for a given role */
export function recordOutcome(
  state: AgentState,
  role: string,
  success: boolean
): void {
  if (!state.successCounts[role]) {
    state.successCounts[role] = { total: 0, success: 0 };
  }
  state.successCounts[role].total += 1;
  if (success) {
    state.successCounts[role].success += 1;
  }
}

/** Add a complaint to the gossip buffer */
export function addComplaint(state: AgentState, complaint: string): void {
  state.complainBuffer.push(complaint);
}

/** Drain and return all pending complaints */
export function drainComplaints(state: AgentState): string[] {
  const complaints = [...state.complainBuffer];
  state.complainBuffer = [];
  return complaints;
}

/** Add a connection to the bind list */
export function addBind(
  state: AgentState,
  name: string,
  role: string
): void {
  const exists = state.relationship.bindList.some(
    ([n, r]) => n === name && r === role
  );
  if (!exists) {
    state.relationship.bindList.push([name, role]);
  }
}

/** Remove a connection from the bind list */
export function removeBind(
  state: AgentState,
  name: string,
  role: string
): void {
  state.relationship.bindList = state.relationship.bindList.filter(
    ([n, r]) => !(n === name && r === role)
  );
}

/**
 * Add a target to the black list.
 * Uses FIFO eviction when the list exceeds maxSize (mirrors Python deque).
 */
export function addToBlackList(
  state: AgentState,
  name: string,
  maxSize: number = BLACK_LIST_MAX_SIZE
): void {
  if (!state.relationship.blackList.includes(name)) {
    state.relationship.blackList.push(name);
    while (state.relationship.blackList.length > maxSize) {
      state.relationship.blackList.shift();
    }
  }
}

/** Check if a target is on the black list */
export function isBlackListed(state: AgentState, name: string): boolean {
  return state.relationship.blackList.includes(name);
}

/** Update learned trait for a role */
export function updateLearned(
  state: AgentState,
  role: string,
  value: string
): void {
  state.learned[role] = value;
}

/** Record an observed interaction for later reputation update */
export function recordObservation(
  state: AgentState,
  key: string,
  data: unknown
): void {
  state.observed[key] = data;
}

/** Clear observed interactions after processing */
export function clearObservations(state: AgentState): void {
  state.observed = {};
}

/** Serialize agent state to JSON-safe object */
export function serializeAgentState(
  state: AgentState
): Record<string, unknown> {
  return { ...state };
}

/** Deserialize agent state from JSON */
export function deserializeAgentState(
  data: Record<string, unknown>
): AgentState {
  return {
    name: data.name as string,
    id: data.id as number,
    role: (data.role as string) || null,
    currentStep: (data.currentStep as number) || 0,
    learned: (data.learned as Record<string, string>) || {},
    complainBuffer: (data.complainBuffer as string[]) || [],
    successCounts:
      (data.successCounts as Record<
        string,
        { total: number; success: number }
      >) || {},
    relationship: (data.relationship as AgentState['relationship']) || {
      bindList: [],
      blackList: [],
    },
    resourcesUnit: (data.resourcesUnit as number) || 10,
    observed: (data.observed as Record<string, unknown>) || {},
  };
}
