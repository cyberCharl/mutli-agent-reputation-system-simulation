/**
 * SocialNetwork — Ported from RepuNet's reputation/social_network.py
 *
 * Directed graph with per-role edges using adjacency-list storage.
 * Supports bind lists, bounded black lists with FIFO eviction,
 * and connect/disconnect decisions.
 *
 * No external graph library needed at this scale (20-50 agents).
 */

import { SocialNetworkInterface } from '../types';

const DEFAULT_BLACK_LIST_MAX = 5;

export class SocialNetwork implements SocialNetworkInterface {
  /** Per-role adjacency lists: role -> (fromAgent -> Set<toAgent>) */
  private graphs: Map<string, Map<string, Set<string>>> = new Map();
  /** Per-agent black lists */
  private blackLists: Map<string, string[]> = new Map();
  private blackListMaxSize: number;

  constructor(blackListMaxSize: number = DEFAULT_BLACK_LIST_MAX) {
    this.blackListMaxSize = blackListMaxSize;
  }

  /** Ensure a role graph exists */
  private ensureRole(role: string): Map<string, Set<string>> {
    if (!this.graphs.has(role)) {
      this.graphs.set(role, new Map());
    }
    return this.graphs.get(role)!;
  }

  /** Ensure an agent's adjacency set exists in a role graph */
  private ensureAgent(
    graph: Map<string, Set<string>>,
    agentId: string
  ): Set<string> {
    if (!graph.has(agentId)) {
      graph.set(agentId, new Set());
    }
    return graph.get(agentId)!;
  }

  addEdge(from: string, to: string, role: string): void {
    const graph = this.ensureRole(role);
    const neighbors = this.ensureAgent(graph, from);
    neighbors.add(to);
  }

  removeEdge(from: string, to: string, role: string): void {
    const graph = this.graphs.get(role);
    if (!graph) return;
    const neighbors = graph.get(from);
    if (neighbors) {
      neighbors.delete(to);
    }
  }

  hasEdge(from: string, to: string, role: string): boolean {
    const graph = this.graphs.get(role);
    if (!graph) return false;
    const neighbors = graph.get(from);
    return neighbors ? neighbors.has(to) : false;
  }

  getConnections(agentId: string, role: string): string[] {
    const graph = this.graphs.get(role);
    if (!graph) return [];
    const neighbors = graph.get(agentId);
    return neighbors ? Array.from(neighbors) : [];
  }

  getBlackList(agentId: string): string[] {
    return [...(this.blackLists.get(agentId) || [])];
  }

  addToBlackList(agentId: string, target: string): void {
    if (!this.blackLists.has(agentId)) {
      this.blackLists.set(agentId, []);
    }
    const list = this.blackLists.get(agentId)!;

    if (!list.includes(target)) {
      list.push(target);
      // FIFO eviction when exceeding max size (mirrors Python deque behavior)
      while (list.length > this.blackListMaxSize) {
        list.shift();
      }
    }
  }

  /** Check if target is on agent's black list */
  isBlackListed(agentId: string, target: string): boolean {
    const list = this.blackLists.get(agentId);
    return list ? list.includes(target) : false;
  }

  /** Remove target from agent's black list */
  removeFromBlackList(agentId: string, target: string): void {
    const list = this.blackLists.get(agentId);
    if (list) {
      const idx = list.indexOf(target);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  /** Get all agents that have connections in a given role */
  getAgentsInRole(role: string): string[] {
    const graph = this.graphs.get(role);
    if (!graph) return [];
    return Array.from(graph.keys());
  }

  /** Get network density for a role: actual edges / possible edges */
  getDensity(role: string): number {
    const graph = this.graphs.get(role);
    if (!graph) return 0;

    const agents = Array.from(graph.keys());
    const n = agents.length;
    if (n < 2) return 0;

    let edgeCount = 0;
    for (const neighbors of graph.values()) {
      edgeCount += neighbors.size;
    }

    const maxEdges = n * (n - 1); // directed graph
    return edgeCount / maxEdges;
  }

  /** Get total edge count across all roles */
  getTotalEdgeCount(): number {
    let count = 0;
    for (const graph of this.graphs.values()) {
      for (const neighbors of graph.values()) {
        count += neighbors.size;
      }
    }
    return count;
  }

  /**
   * Two-stage network update after interaction (mirrors RepuNet's social_network_update).
   *
   * Returns the decision made: 'disconnect', 'connect', or 'no_change'.
   * The actual LLM decision logic is handled by the caller;
   * this method applies the structural changes.
   */
  applyNetworkDecision(
    agentId: string,
    targetId: string,
    role: string,
    decision: 'disconnect' | 'connect' | 'no_change'
  ): void {
    if (decision === 'disconnect') {
      this.removeEdge(agentId, targetId, role);
      this.addToBlackList(agentId, targetId);
    } else if (decision === 'connect') {
      if (!this.isBlackListed(agentId, targetId)) {
        this.addEdge(agentId, targetId, role);
      }
    }
  }

  /** Initialize a fully connected network for a set of agents in a role */
  initializeFullyConnected(agentIds: string[], role: string): void {
    for (const from of agentIds) {
      for (const to of agentIds) {
        if (from !== to) {
          this.addEdge(from, to, role);
        }
      }
    }
  }

  toJSON(): Record<string, unknown> {
    const graphs: Record<string, Record<string, string[]>> = {};
    for (const [role, graph] of this.graphs) {
      graphs[role] = {};
      for (const [agent, neighbors] of graph) {
        graphs[role][agent] = Array.from(neighbors);
      }
    }

    const blackLists: Record<string, string[]> = {};
    for (const [agent, list] of this.blackLists) {
      blackLists[agent] = [...list];
    }

    return {
      graphs,
      blackLists,
      blackListMaxSize: this.blackListMaxSize,
    };
  }

  static fromJSON(data: Record<string, unknown>): SocialNetwork {
    const maxSize = (data.blackListMaxSize as number) || DEFAULT_BLACK_LIST_MAX;
    const network = new SocialNetwork(maxSize);

    const graphs = data.graphs as Record<
      string,
      Record<string, string[]>
    >;
    if (graphs) {
      for (const [role, graph] of Object.entries(graphs)) {
        for (const [agent, neighbors] of Object.entries(graph)) {
          for (const neighbor of neighbors) {
            network.addEdge(agent, neighbor, role);
          }
        }
      }
    }

    const blackLists = data.blackLists as Record<string, string[]>;
    if (blackLists) {
      for (const [agent, list] of Object.entries(blackLists)) {
        network.blackLists.set(agent, [...list]);
      }
    }

    return network;
  }
}
