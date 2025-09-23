import OpenAI from 'openai';
import { z } from 'zod';
import {
  ProtocolLevel,
  ReviewAction,
  NestedBelief,
  AgentId,
  ModelRep,
  ReputationConsequences,
  LLMResponse,
  TrueState,
} from './types';
import { formatProposalPrompt, formatReviewPrompt } from './prompts';

const LLMResponseSchema = z.object({
  action: z.string(),
});

export class LLMModel {
  private client: OpenAI | null;
  private modelId: string;
  private isMockMode: boolean;

  constructor(apiKey?: string, modelId: string = 'openai/gpt-4o-mini') {
    this.modelId = modelId;
    this.isMockMode = !apiKey || apiKey === 'mock';

    if (!this.isMockMode) {
      // Use OpenRouter API endpoint
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer':
            'https://github.com/cyberCharl/mutli-agent-reputation-system-simulation',
          'X-Title': 'MSPN Simulation',
        },
      });
    } else {
      this.client = null;
    }
  }

  public async decidePropose(
    belief: NestedBelief,
    history: string[],
    reputationWarning?: string
  ): Promise<ProtocolLevel> {
    if (this.isMockMode) {
      return this.mockPropose(belief);
    }

    const prompt = formatProposalPrompt(belief, history, reputationWarning);

    try {
      const response = await this.client!.chat.completions.create({
        model: this.modelId,
        messages: [
          {
            role: 'system',
            content:
              'You are a strategic agent in a security negotiation game. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content from LLM');
      }

      const parsed = LLMResponseSchema.parse(JSON.parse(content));
      const action = parsed.action.toLowerCase();

      if (Object.values(ProtocolLevel).includes(action as ProtocolLevel)) {
        return action as ProtocolLevel;
      } else {
        throw new Error(`Invalid proposal action: ${action}`);
      }
    } catch (error) {
      console.warn(`LLM proposal failed, using mock: ${error}`);
      return this.mockPropose(belief);
    }
  }

  public async decideReview(
    proposal: ProtocolLevel,
    belief: NestedBelief,
    history: string[]
  ): Promise<ReviewAction> {
    if (this.isMockMode) {
      return this.mockReview(proposal, belief);
    }

    const prompt = formatReviewPrompt(proposal, belief, history);

    try {
      const response = await this.client!.chat.completions.create({
        model: this.modelId,
        messages: [
          {
            role: 'system',
            content:
              'You are a strategic agent in a security negotiation game. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content from LLM');
      }

      const parsed = LLMResponseSchema.parse(JSON.parse(content));
      const action = parsed.action.toLowerCase();

      if (Object.values(ReviewAction).includes(action as ReviewAction)) {
        return action as ReviewAction;
      } else {
        throw new Error(`Invalid review action: ${action}`);
      }
    } catch (error) {
      console.warn(`LLM review failed, using mock: ${error}`);
      return this.mockReview(proposal, belief);
    }
  }

  private mockPropose(belief: NestedBelief): ProtocolLevel {
    const safeProb = belief.own[TrueState.SafeLow] || 0;

    // Simple rule-based mock
    if (safeProb > 0.7) {
      return ProtocolLevel.Low; // Risky but fast
    } else if (safeProb > 0.4) {
      return ProtocolLevel.Medium; // Balanced
    } else {
      return ProtocolLevel.High; // Secure
    }
  }

  private mockReview(
    proposal: ProtocolLevel,
    belief: NestedBelief
  ): ReviewAction {
    const safeProb = belief.own[TrueState.SafeLow] || 0;

    // Simple rule-based mock
    if (proposal === ProtocolLevel.Low && safeProb < 0.3) {
      return ReviewAction.Reject; // Too risky
    } else if (proposal === ProtocolLevel.High && safeProb > 0.6) {
      return ReviewAction.ModifyMedium; // Overly cautious
    } else {
      return ReviewAction.Accept; // Reasonable
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
    proposal?: ProtocolLevel
  ): Promise<ProtocolLevel | ReviewAction> {
    if (actionType === 'propose') {
      const reputationWarning = this.getReputationWarning();
      return await this.model.decidePropose(belief, history, reputationWarning);
    } else {
      if (!proposal) {
        throw new Error('Proposal required for review action');
      }
      return await this.model.decideReview(proposal, belief, history);
    }
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
