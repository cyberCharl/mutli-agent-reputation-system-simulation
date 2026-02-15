import { AssociativeMemory, MemoryNode } from '../../src/persona/memory';

function makeNode(overrides: Partial<Omit<MemoryNode, 'id'>> = {}) {
  return {
    type: 'event' as const,
    subject: 'Alice',
    predicate: 'observed',
    object: 'Bob',
    description: 'Alice observed Bob',
    createdAt: 1,
    ...overrides,
  };
}

describe('AssociativeMemory', () => {
  test('assigns deterministic incremental ids when omitted', () => {
    const memory = new AssociativeMemory();

    const first = memory.addNode(makeNode());
    const second = memory.addNode(makeNode({ createdAt: 2 }));

    expect(first.id).toBe('mem-1');
    expect(second.id).toBe('mem-2');
  });

  test('preserves explicit id when provided', () => {
    const memory = new AssociativeMemory();

    const node = memory.addNode({
      ...makeNode(),
      id: 'custom-id',
    });

    expect(node.id).toBe('custom-id');
  });

  test('supports retrieval by type, target, and latest count', () => {
    const memory = new AssociativeMemory();

    memory.addMemory(makeNode({ object: 'Bob', createdAt: 1 }));
    memory.addMemory(
      makeNode({
        type: 'chat',
        subject: 'Carol',
        object: 'Dan',
        createdAt: 2,
      })
    );
    memory.addMemory(
      makeNode({
        type: 'observation',
        subject: 'Eve',
        object: 'Bob',
        createdAt: 3,
      })
    );

    expect(memory.getNodesWithType('chat')).toHaveLength(1);
    expect(memory.getNodesWithTarget('Bob')).toHaveLength(2);
    expect(memory.getLatestNodes(2).map((n) => n.createdAt)).toEqual([2, 3]);
    expect(memory.getLatestNodes(0)).toEqual([]);
  });

  test('exports defensive copies and can import/clear', () => {
    const memory = new AssociativeMemory();
    memory.addMemory(makeNode({ createdAt: 1 }));

    const exported = memory.export();
    exported[0].description = 'mutated outside';

    expect(memory.getAll()[0].description).toBe('Alice observed Bob');

    const imported = new AssociativeMemory();
    imported.import(exported);
    expect(imported.getAll()).toHaveLength(1);

    imported.clear();
    expect(imported.getAll()).toEqual([]);
  });
});
