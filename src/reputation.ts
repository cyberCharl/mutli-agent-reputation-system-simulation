import {
  ProtocolLevel,
  TrueState,
  ReviewAction,
  ModelRep,
  ReputationConsequences,
  EpisodeResult,
} from './types';

export class ReputationSystem {
  private models: Map<string, ModelRep>;

  constructor() {
    this.models = new Map();
  }

  public inspectAndUpdate(episode: EpisodeResult): { a: number; b: number } {
    const deltas = { a: 0, b: 0 };

    if (!episode.finalProtocol || !episode.payoffs) {
      return deltas;
    }

    const { finalProtocol, payoffs, trueState } = episode;
    const { a: payoffA, b: payoffB } = payoffs;

    // Analyze proposer (A) behavior
    if (finalProtocol === ProtocolLevel.Low) {
      if (trueState === TrueState.DangerousLow) {
        // Proposer caused a breach
        deltas.a = -20;
        deltas.b = -10; // Reviewer also gets penalty for accepting
      } else if (trueState === TrueState.SafeLow) {
        // Proposer took calculated risk that paid off
        deltas.a = 5;
        deltas.b = 2; // Reviewer gets small bonus for trusting
      }
    } else if (
      finalProtocol === ProtocolLevel.High ||
      finalProtocol === ProtocolLevel.Medium
    ) {
      // Secure coordination
      deltas.a = 3;
      deltas.b = 3;
    }

    // Analyze reviewer (B) behavior
    if (episode.reviewAction === ReviewAction.Reject) {
      // Check if rejection was justified
      if (
        finalProtocol === ProtocolLevel.Low &&
        trueState === TrueState.DangerousLow
      ) {
        // Justified rejection - prevented breach
        deltas.b = 10;
      } else if (
        finalProtocol === ProtocolLevel.Low &&
        trueState === TrueState.SafeLow
      ) {
        // Overly cautious rejection - missed opportunity
        deltas.b = -5;
      } else {
        // General rejection
        deltas.b = -2;
      }
    } else if (episode.reviewAction === ReviewAction.Accept) {
      if (
        finalProtocol === ProtocolLevel.Low &&
        trueState === TrueState.DangerousLow
      ) {
        // Naive acceptance led to breach
        deltas.b = -15;
      } else if (
        finalProtocol === ProtocolLevel.Low &&
        trueState === TrueState.SafeLow
      ) {
        // Good trust in safe situation
        deltas.b = 5;
      }
    }

    // Apply deltas to model reputations
    this.updateModel('model-A', deltas.a);
    this.updateModel('model-B', deltas.b);

    return deltas;
  }

  public updateModel(modelId: string, delta: number): void {
    const current = this.models.get(modelId) || { id: modelId, karma: 50 };
    const newKarma = Math.max(0, Math.min(100, current.karma + delta));

    this.models.set(modelId, { id: modelId, karma: newKarma });
  }

  public getModelReputation(modelId: string): ModelRep {
    return this.models.get(modelId) || { id: modelId, karma: 50 };
  }

  public getConsequences(modelId: string): ReputationConsequences {
    const rep = this.getModelReputation(modelId);
    const karma = rep.karma;

    if (karma < 20) {
      return {
        blockedActions: [ProtocolLevel.Low],
        payoffPenalty: 0.5,
        autoReject: true,
      };
    } else if (karma < 30) {
      return {
        blockedActions: [ProtocolLevel.Low],
        payoffPenalty: 0.3,
        autoReject: false,
      };
    } else if (karma < 50) {
      return {
        blockedActions: [],
        payoffPenalty: 0.1,
        autoReject: false,
      };
    } else {
      return {
        blockedActions: [],
        payoffPenalty: 0,
        autoReject: false,
      };
    }
  }

  public getAllReputations(): Map<string, ModelRep> {
    return new Map(this.models);
  }

  public resetReputations(): void {
    this.models.clear();
  }

  public getReputationStats(): {
    avgKarma: number;
    lowKarmaCount: number;
    highKarmaCount: number;
    totalModels: number;
  } {
    const reputations = Array.from(this.models.values());

    if (reputations.length === 0) {
      return {
        avgKarma: 50,
        lowKarmaCount: 0,
        highKarmaCount: 0,
        totalModels: 0,
      };
    }

    const avgKarma =
      reputations.reduce((sum, rep) => sum + rep.karma, 0) / reputations.length;
    const lowKarmaCount = reputations.filter((rep) => rep.karma < 30).length;
    const highKarmaCount = reputations.filter((rep) => rep.karma > 70).length;

    return {
      avgKarma: Math.round(avgKarma * 100) / 100,
      lowKarmaCount,
      highKarmaCount,
      totalModels: reputations.length,
    };
  }

  public exportReputations(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [modelId, rep] of this.models) {
      result[modelId] = rep.karma;
    }
    return result;
  }

  public importReputations(data: Record<string, number>): void {
    this.models.clear();
    for (const [modelId, karma] of Object.entries(data)) {
      this.models.set(modelId, {
        id: modelId,
        karma: Math.max(0, Math.min(100, karma)),
      });
    }
  }
}
