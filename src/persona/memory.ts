export type NodeType = 'event' | 'chat' | 'observation';

export interface MemoryNode {
  id: string;
  type: NodeType;
  subject: string;
  predicate: string;
  object: string;
  description: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export class AssociativeMemory {
  private readonly nodes: MemoryNode[] = [];
  private nextId = 1;

  addNode(
    node: Omit<MemoryNode, 'id'> & Partial<Pick<MemoryNode, 'id'>>
  ): MemoryNode {
    const created: MemoryNode = {
      ...node,
      id: node.id ?? this.makeId(),
    };
    this.nodes.push(created);
    return created;
  }

  addMemory(node: Omit<MemoryNode, 'id'>): MemoryNode {
    return this.addNode(node);
  }

  getLatestNodes(n: number): MemoryNode[] {
    if (n <= 0) {
      return [];
    }
    return this.nodes.slice(-n);
  }

  getNodesWithTarget(target: string): MemoryNode[] {
    return this.nodes.filter(
      (node) => node.object === target || node.subject === target
    );
  }

  getNodesWithType(type: NodeType): MemoryNode[] {
    return this.nodes.filter((node) => node.type === type);
  }

  getAll(): MemoryNode[] {
    return [...this.nodes];
  }

  clear(): void {
    this.nodes.length = 0;
  }

  import(nodes: MemoryNode[]): void {
    this.clear();
    for (const node of nodes) {
      this.nodes.push({ ...node });
    }
  }

  export(): MemoryNode[] {
    return this.nodes.map((node) => ({ ...node }));
  }

  private makeId(): string {
    const id = `mem-${this.nextId}`;
    this.nextId += 1;
    return id;
  }
}
