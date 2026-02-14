/**
 * AssociativeMemory — Ported from RepuNet's persona/memory_structures/associative_memory.py
 *
 * Triple-store event log with Node, Chat, and Event types.
 * Stored in-memory with serialization support.
 */

import { MemoryNode, ChatNode, EventNode } from '../types';

export class AssociativeMemory {
  private nodes: MemoryNode[] = [];
  private nextId: number = 0;

  /** Add a basic memory node */
  addNode(
    subject: string,
    predicate: string,
    object: string,
    description: string,
    step: number
  ): MemoryNode {
    const node: MemoryNode = {
      id: this.nextId++,
      subject,
      predicate,
      object,
      description,
      createdAt: step,
    };
    this.nodes.push(node);
    return node;
  }

  /** Add a chat memory (interaction dialogue) */
  addChat(
    subject: string,
    predicate: string,
    object: string,
    description: string,
    conversation: string,
    step: number
  ): ChatNode {
    const node: ChatNode = {
      id: this.nextId++,
      subject,
      predicate,
      object,
      description,
      conversation,
      createdAt: step,
    };
    this.nodes.push(node);
    return node;
  }

  /** Add an event memory (observed or participated) */
  addEvent(
    subject: string,
    predicate: string,
    object: string,
    description: string,
    eventType: string,
    step: number
  ): EventNode {
    const node: EventNode = {
      id: this.nextId++,
      subject,
      predicate,
      object,
      description,
      eventType,
      createdAt: step,
    };
    this.nodes.push(node);
    return node;
  }

  /** Get the N most recent memory nodes */
  getLatest(n: number): MemoryNode[] {
    return this.nodes.slice(-n);
  }

  /** Get the most recent event */
  getLatestEvent(): MemoryNode | null {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if ('eventType' in this.nodes[i]) {
        return this.nodes[i];
      }
    }
    return this.nodes.length > 0 ? this.nodes[this.nodes.length - 1] : null;
  }

  /** Get the latest event involving a specific target */
  getLatestEventWithTarget(targetName: string): MemoryNode | null {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (node.subject === targetName || node.object === targetName) {
        return node;
      }
    }
    return null;
  }

  /** Get all nodes in a step range */
  getNodesInRange(fromStep: number, toStep: number): MemoryNode[] {
    return this.nodes.filter(
      (n) => n.createdAt >= fromStep && n.createdAt <= toStep
    );
  }

  /** Get total node count */
  size(): number {
    return this.nodes.length;
  }

  /** Serialize to JSON-safe array */
  toJSON(): Record<string, unknown>[] {
    return this.nodes.map((n) => ({ ...n }));
  }

  /** Load from serialized data */
  static fromJSON(data: Record<string, unknown>[]): AssociativeMemory {
    const mem = new AssociativeMemory();
    for (const item of data) {
      const node = item as unknown as MemoryNode;
      mem.nodes.push(node);
      if (node.id >= mem.nextId) {
        mem.nextId = node.id + 1;
      }
    }
    return mem;
  }
}
