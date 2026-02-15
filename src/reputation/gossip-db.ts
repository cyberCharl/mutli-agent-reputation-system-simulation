import { GossipEntry } from '../types';

export interface GossipQuery {
  complainedName?: string;
  gossiperName?: string;
  minStep?: number;
  maxStep?: number;
}

export class GossipDatabase {
  private readonly entries: GossipEntry[] = [];

  addEntry(entry: GossipEntry): void {
    this.entries.push({
      ...entry,
      sourceChain: [...entry.sourceChain],
    });
  }

  getAllEntries(): GossipEntry[] {
    return this.entries.map((entry) => ({
      ...entry,
      sourceChain: [...entry.sourceChain],
    }));
  }

  query(query: GossipQuery): GossipEntry[] {
    return this.entries.filter((entry) => {
      if (
        query.complainedName &&
        entry.complainedName !== query.complainedName
      ) {
        return false;
      }
      if (query.gossiperName && entry.gossiperName !== query.gossiperName) {
        return false;
      }
      if (query.minStep !== undefined && entry.createdAtStep < query.minStep) {
        return false;
      }
      if (query.maxStep !== undefined && entry.createdAtStep > query.maxStep) {
        return false;
      }
      return true;
    });
  }

  getRecentEntries(currentStep: number, window: number): GossipEntry[] {
    const minStep = currentStep - Math.max(0, window);
    return this.query({ minStep, maxStep: currentStep });
  }

  getRecentByTarget(
    targetName: string,
    currentStep: number,
    window: number
  ): GossipEntry[] {
    const minStep = currentStep - Math.max(0, window);
    return this.query({
      complainedName: targetName,
      minStep,
      maxStep: currentStep,
    });
  }

  export(): GossipEntry[] {
    return this.getAllEntries();
  }

  import(data: GossipEntry[]): void {
    this.entries.length = 0;
    for (const entry of data) {
      this.addEntry(entry);
    }
  }

  clear(): void {
    this.entries.length = 0;
  }
}
