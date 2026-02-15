import { AgentRole, NetworkConfig } from '../types';

export interface NetworkEdge {
  from: string;
  to: string;
  role: AgentRole;
  createdAt: number;
}

export interface SocialNetworkExport {
  edges: NetworkEdge[];
  blackLists: Record<string, string[]>;
}

export class SocialNetwork {
  private readonly graphs: Map<AgentRole, Map<string, Set<string>>> = new Map();
  private readonly blackLists: Map<string, string[]> = new Map();
  private readonly edgeMeta: Map<string, NetworkEdge> = new Map();

  constructor(private readonly config: NetworkConfig) {}

  addEdge(
    from: string,
    to: string,
    role: AgentRole,
    createdAt: number = 0
  ): void {
    if (!this.canConnect(from, to)) {
      return;
    }

    const roleGraph = this.graphs.get(role) ?? new Map<string, Set<string>>();
    const adjacency = roleGraph.get(from) ?? new Set<string>();
    adjacency.add(to);
    roleGraph.set(from, adjacency);
    this.graphs.set(role, roleGraph);

    this.edgeMeta.set(this.makeEdgeKey(role, from, to), {
      from,
      to,
      role,
      createdAt,
    });
  }

  removeEdge(from: string, to: string, role: AgentRole): void {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) {
      return;
    }

    const adjacency = roleGraph.get(from);
    if (!adjacency) {
      return;
    }

    adjacency.delete(to);
    if (adjacency.size === 0) {
      roleGraph.delete(from);
    }

    this.edgeMeta.delete(this.makeEdgeKey(role, from, to));
  }

  hasEdge(from: string, to: string, role: AgentRole): boolean {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) {
      return false;
    }
    return roleGraph.get(from)?.has(to) ?? false;
  }

  getConnections(agentId: string, role: AgentRole): string[] {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) {
      return [];
    }
    return Array.from(roleGraph.get(agentId) ?? []);
  }

  getIncomingConnections(agentId: string, role: AgentRole): string[] {
    const roleGraph = this.graphs.get(role);
    if (!roleGraph) {
      return [];
    }
    const incoming: string[] = [];
    for (const [from, tos] of roleGraph.entries()) {
      if (tos.has(agentId)) {
        incoming.push(from);
      }
    }
    return incoming;
  }

  getAllConnections(agentId: string): Record<AgentRole, string[]> {
    return {
      investor: this.getConnections(agentId, 'investor'),
      trustee: this.getConnections(agentId, 'trustee'),
      player: this.getConnections(agentId, 'player'),
      resident: this.getConnections(agentId, 'resident'),
      proposer: this.getConnections(agentId, 'proposer'),
      reviewer: this.getConnections(agentId, 'reviewer'),
    };
  }

  addToBlackList(agentId: string, targetId: string): void {
    const list = this.blackLists.get(agentId) ?? [];
    const existingIdx = list.indexOf(targetId);
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
    }
    list.push(targetId);

    while (list.length > this.config.blackListMaxSize) {
      list.shift();
    }

    this.blackLists.set(agentId, list);
  }

  removeFromBlackList(agentId: string, targetId: string): void {
    const list = this.blackLists.get(agentId);
    if (!list) {
      return;
    }

    const next = list.filter((id) => id !== targetId);
    this.blackLists.set(agentId, next);
  }

  getBlackList(agentId: string): string[] {
    return [...(this.blackLists.get(agentId) ?? [])];
  }

  isBlackListed(agentId: string, targetId: string): boolean {
    return (this.blackLists.get(agentId) ?? []).includes(targetId);
  }

  canConnect(agentId: string, targetId: string): boolean {
    return !this.isBlackListed(agentId, targetId);
  }

  getEdges(role?: AgentRole): NetworkEdge[] {
    const edges = Array.from(this.edgeMeta.values());
    if (!role) {
      return edges;
    }
    return edges.filter((edge) => edge.role === role);
  }

  export(): SocialNetworkExport {
    return {
      edges: this.getEdges(),
      blackLists: Object.fromEntries(this.blackLists.entries()),
    };
  }

  import(data: SocialNetworkExport): void {
    this.graphs.clear();
    this.blackLists.clear();
    this.edgeMeta.clear();

    for (const edge of data.edges ?? []) {
      this.addEdge(edge.from, edge.to, edge.role, edge.createdAt);
    }

    for (const [agentId, blocked] of Object.entries(data.blackLists ?? {})) {
      const list = [...blocked];
      while (list.length > this.config.blackListMaxSize) {
        list.shift();
      }
      this.blackLists.set(agentId, list);
    }
  }

  private makeEdgeKey(role: AgentRole, from: string, to: string): string {
    return `${role}:${from}->${to}`;
  }
}
