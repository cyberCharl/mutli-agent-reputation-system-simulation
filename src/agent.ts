import seedrandom from 'seedrandom';
import {
  ProtocolLevel,
  ReviewAction,
  NestedBelief,
  AgentId,
  ModelRep,
  ReputationConsequences,
  TrueState,
} from './types';
import { formatProposalPrompt, formatReviewPrompt } from './prompts';
import { OpenRouterClient } from './openrouter';
import {
  ProposalResponseSchema,
  ReviewResponseSchema,
  ProposalResponseJsonSchema,
  ReviewResponseJsonSchema,
} from './schemas';

function mapProposalToProtocol(proposal: string): ProtocolLevel {
  const map: Record<string, ProtocolLevel> = {
    Low: ProtocolLevel.Low,
    Medium: ProtocolLevel.Medium,
    High: ProtocolLevel.High,
  };
  return map[proposal] || ProtocolLevel.Medium;
}

function mapDecisionToReviewAction(
  decision: string,
  counterProposal?: string | null
): ReviewAction {
  if (decision === 'Accept') return ReviewAction.Accept;
  if (decision === 'Reject') return ReviewAction.Reject;
  // Modify — use counter_proposal or default to ModifyMedium
  if (counterProposal === 'Low') return ReviewAction.ModifyLow;
  if (counterProposal === 'High') return ReviewAction.ModifyHigh;
  return ReviewAction.ModifyMedium;
}

export interface DecisionMetadata {
  reasoning: string;
  confidence?: number;
  beliefState?: {
    own_safety_belief: number;
    opponent_cooperation_belief: number;
  };
  trustAssessment?: number;
}

export class LLMModel {
  private openRouterClient: OpenRouterClient | null;
  private modelId: string;
  private isMockMode: boolean;
  private rng: seedrandom.PRNG;
  private lastDecisionMetadata: DecisionMetadata | null = null;

  constructor(
    apiKey?: string,
    modelId: string = 'google/gemini-2.5-flash-lite',
    seed?: string
  ) {
    this.modelId = modelId;
    this.isMockMode = !apiKey || apiKey === 'mock';
    this.rng = seedrandom(seed || 'default-agent');

    if (!this.isMockMode) {
      this.openRouterClient = new OpenRouterClient({
        apiKey: apiKey!,
        model: modelId,
      });
    } else {
      this.openRouterClient = null;
    }
  }

  public getLastDecisionMetadata(): DecisionMetadata | null {
    return this.lastDecisionMetadata;
  }

  public async decidePropose(
    belief: NestedBelief,
    history: string[],
    reputationWarning?: string,
    karma?: number,
    opponentKarma?: number
  ): Promise<ProtocolLevel> {
    if (this.isMockMode) {
      this.lastDecisionMetadata = null;
      return this.mockPropose(belief);
    }

    const prompt = formatProposalPrompt(
      belief,
      history,
      reputationWarning,
      karma,
      opponentKarma
    );

    try {
      const response = await this.openRouterClient!.complete(
        prompt,
        ProposalResponseJsonSchema,
        ProposalResponseSchema,
        { temperature: 0.7 }
      );

      this.lastDecisionMetadata = {
        reasoning: response.data.reasoning,
        confidence: response.data.confidence,
        beliefState: response.data.belief_state,
      };

      return mapProposalToProtocol(response.data.proposal);
    } catch (error) {
      console.warn(`LLM proposal failed, using mock: ${error}`);
      this.lastDecisionMetadata = null;
      return this.mockPropose(belief);
    }
  }

  public async decideReview(
    proposal: ProtocolLevel,
    belief: NestedBelief,
    history: string[],
    karma?: number,
    opponentKarma?: number
  ): Promise<ReviewAction> {
    if (this.isMockMode) {
      this.lastDecisionMetadata = null;
      return this.mockReview(proposal, belief);
    }

    const prompt = formatReviewPrompt(
      proposal,
      belief,
      history,
      karma,
      opponentKarma
    );

    try {
      const response = await this.openRouterClient!.complete(
        prompt,
        ReviewResponseJsonSchema,
        ReviewResponseSchema,
        { temperature: 0.7 }
      );

      this.lastDecisionMetadata = {
        reasoning: response.data.reasoning,
        trustAssessment: response.data.trust_assessment,
      };

      return mapDecisionToReviewAction(
        response.data.decision,
        response.data.counter_proposal
      );
    } catch (error) {
      console.warn(`LLM review failed, using mock: ${error}`);
      this.lastDecisionMetadata = null;
      return this.mockReview(proposal, belief);
    }
  }

  private mockPropose(belief: NestedBelief): ProtocolLevel {
    const safeProb = belief.own[TrueState.SafeLow] || 0;
    const roll = this.rng();

    if (safeProb > 0.7) {
      return roll < 0.8 ? ProtocolLevel.Low : ProtocolLevel.Medium;
    } else if (safeProb > 0.4) {
      if (roll < 0.6) return ProtocolLevel.Medium;
      return roll < 0.8 ? ProtocolLevel.Low : ProtocolLevel.High;
    } else {
      return roll < 0.7 ? ProtocolLevel.High : ProtocolLevel.Medium;
    }
  }

  private mockReview(
    proposal: ProtocolLevel,
    belief: NestedBelief
  ): ReviewAction {
    const safeProb = belief.own[TrueState.SafeLow] || 0;
    const roll = this.rng();

    if (proposal === ProtocolLevel.Low && safeProb < 0.3) {
      return roll < 0.8 ? ReviewAction.Reject : ReviewAction.ModifyMedium;
    } else if (proposal === ProtocolLevel.High && safeProb > 0.6) {
      return roll < 0.7
        ? ReviewAction.ModifyMedium
        : roll < 0.9
          ? ReviewAction.Accept
          : ReviewAction.ModifyLow;
    } else {
      return roll < 0.7 ? ReviewAction.Accept : ReviewAction.ModifyMedium;
    }
  }
}

export class Agent {
  private id: AgentId;
  private model: LLMModel;
  private reputation: ModelRep;
  private consequences: ReputationConsequences;

  constructor(id: AgentId, model: LLMModel, initialKarma: number = 50) {
    this.id = id;
    this.model = model;
    this.reputation = { id: `model-${id}`, karma: initialKarma };
    this.consequences = {
      blockedActions: [],
      payoffPenalty: 0,
      autoReject: false,
    };
  }

  public async act(
    actionType: 'propose' | 'review',
    belief: NestedBelief,
    history: string[],
    proposal?: ProtocolLevel,
    opponentKarma?: number
  ): Promise<ProtocolLevel | ReviewAction> {
    if (actionType === 'propose') {
      const reputationWarning = this.getReputationWarning();
      return await this.model.decidePropose(
        belief,
        history,
        reputationWarning,
        this.reputation.karma,
        opponentKarma
      );
    } else {
      if (!proposal) {
        throw new Error('Proposal required for review action');
      }
      return await this.model.decideReview(
        proposal,
        belief,
        history,
        this.reputation.karma,
        opponentKarma
      );
    }
  }

  public getLastDecisionMetadata(): DecisionMetadata | null {
    return this.model.getLastDecisionMetadata();
  }

  private getReputationWarning(): string | undefined {
    if (this.reputation.karma < 30) {
      return "Your low reputation means you should avoid proposing 'low' protocol to maintain trust.";
    }
    return undefined;
  }

  public getReputation(): ModelRep {
    return { ...this.reputation };
  }

  public setReputation(karma: number): void {
    this.reputation.karma = Math.max(0, Math.min(100, karma));
    this.updateConsequences();
  }

  public getConsequences(): ReputationConsequences {
    return { ...this.consequences };
  }

  private updateConsequences(): void {
    const karma = this.reputation.karma;

    if (karma < 30) {
      this.consequences = {
        blockedActions: [ProtocolLevel.Low],
        payoffPenalty: 0.5,
        autoReject: false,
      };
    } else if (karma < 50) {
      this.consequences = {
        blockedActions: [],
        payoffPenalty: 0.2,
        autoReject: false,
      };
    } else {
      this.consequences = {
        blockedActions: [],
        payoffPenalty: 0,
        autoReject: false,
      };
    }
  }

  public applyConsequences(
    action: ProtocolLevel | ReviewAction
  ): ProtocolLevel | ReviewAction {
    // Apply blocked actions
    if (this.consequences.blockedActions.includes(action as ProtocolLevel)) {
      return ProtocolLevel.Medium; // Force medium if low is blocked
    }

    // Apply auto-reject for very low karma
    if (
      this.reputation.karma < 20 &&
      this.id === 'B' &&
      action === ReviewAction.Accept
    ) {
      return ReviewAction.Reject;
    }

    return action;
  }

  public applyPayoffPenalty(payoff: number): number {
    return Math.round(payoff * (1 - this.consequences.payoffPenalty));
  }

  public getId(): AgentId {
    return this.id;
  }

  public getModelId(): string {
    return this.reputation.id;
  }
}
