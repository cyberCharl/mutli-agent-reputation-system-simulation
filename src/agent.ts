import OpenAI from 'openai';
import seedrandom from 'seedrandom';
import pLimit from 'p-limit';
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

// Rate limiting: configurable via RATE_LIMIT_MS env var (default 200ms = 5 req/sec)
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '200', 10);
const apiLimiter = pLimit(1); // Serialize API calls
let lastApiCallTime = 0;

async function rateLimitedApiCall<T>(fn: () => Promise<T>): Promise<T> {
  return apiLimiter(async () => {
    const now = Date.now();
    const elapsed = now - lastApiCallTime;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_MS - elapsed)
      );
    }
    lastApiCallTime = Date.now();
    return fn();
  });
}

export class LLMModel {
  private client: OpenAI | null;
  private modelId: string;
  private isMockMode: boolean;
  private rng: seedrandom.PRNG;

  constructor(
    apiKey?: string,
    modelId: string = 'openai/gpt-4o-mini',
    seed?: string
  ) {
    this.modelId = modelId;
    this.isMockMode = !apiKey || apiKey === 'mock';
    this.rng = seedrandom(seed || 'default-agent');

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
    reputationWarning?: string,
    karma?: number,
    opponentKarma?: number
  ): Promise<ProtocolLevel> {
    if (this.isMockMode) {
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
      const response = await rateLimitedApiCall(() =>
        this.client!.chat.completions.create({
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
        })
      );

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
    history: string[],
    karma?: number,
    opponentKarma?: number
  ): Promise<ReviewAction> {
    if (this.isMockMode) {
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
      const response = await rateLimitedApiCall(() =>
        this.client!.chat.completions.create({
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
        })
      );

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
