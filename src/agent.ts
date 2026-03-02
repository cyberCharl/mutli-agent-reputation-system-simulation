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
import type { EpisodeTraceRecorder } from './telemetry/logger';
import { formatProposalPrompt, formatReviewPrompt } from './prompts';

const LLMResponseSchema = z.object({
  action: z.string(),
});

// Rate limiting: configurable via RATE_LIMIT_MS env var (default 200ms = 5 req/sec)
const RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '200', 10);
const apiLimiter = pLimit(1); // Serialize API calls
let lastApiCallTime = 0;

type DecisionSource = 'mock' | 'llm' | 'fallback';

interface ModelDecision<T extends ProtocolLevel | ReviewAction> {
  action: T;
  outputText: string;
  source: DecisionSource;
  error?: string;
}

export interface AgentDecision<T extends ProtocolLevel | ReviewAction> {
  action: T;
  turnId?: string;
  promptEventId?: string;
  actedEventId?: string;
}

interface AgentTraceContext {
  recorder: EpisodeTraceRecorder;
  round: number;
}

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
    prompt: string
  ): Promise<ModelDecision<ProtocolLevel>> {
    if (this.isMockMode) {
      const action = this.mockPropose(belief);
      return {
        action,
        outputText: JSON.stringify({ action }),
        source: 'mock',
      };
    }

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
        return {
          action: action as ProtocolLevel,
          outputText: content,
          source: 'llm',
        };
      } else {
        throw new Error(`Invalid proposal action: ${action}`);
      }
    } catch (error) {
      console.warn(`LLM proposal failed, using mock: ${error}`);
      const action = this.mockPropose(belief);
      return {
        action,
        outputText: JSON.stringify({ action }),
        source: 'fallback',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async decideReview(
    proposal: ProtocolLevel,
    belief: NestedBelief,
    prompt: string
  ): Promise<ModelDecision<ReviewAction>> {
    if (this.isMockMode) {
      const action = this.mockReview(proposal, belief);
      return {
        action,
        outputText: JSON.stringify({ action }),
        source: 'mock',
      };
    }

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
        return {
          action: action as ReviewAction,
          outputText: content,
          source: 'llm',
        };
      } else {
        throw new Error(`Invalid review action: ${action}`);
      }
    } catch (error) {
      console.warn(`LLM review failed, using mock: ${error}`);
      const action = this.mockReview(proposal, belief);
      return {
        action,
        outputText: JSON.stringify({ action }),
        source: 'fallback',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public getModelId(): string {
    return this.modelId;
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
    opponentKarma?: number,
    traceContext?: AgentTraceContext
  ): Promise<AgentDecision<ProtocolLevel | ReviewAction>> {
    const turnId = traceContext?.recorder.buildTurnId(
      traceContext.round,
      actionType,
      this.id
    );

    if (actionType === 'propose') {
      const reputationWarning = this.getReputationWarning();
      const prompt = formatProposalPrompt(
        belief,
        history,
        reputationWarning,
        this.reputation.karma,
        opponentKarma
      );
      const promptEvent = traceContext?.recorder.emit({
        eventType: 'agent_prompted',
        turnId,
        agentId: this.id,
        payload: {
          round: traceContext.round,
          actionType,
          modelId: this.model.getModelId(),
          prompt,
          history,
          belief,
          karma: this.reputation.karma,
          opponentKarma,
          reputationWarning,
        },
      });
      const decision = await this.model.decidePropose(belief, prompt);
      const actedEvent = traceContext?.recorder.emit({
        eventType: 'agent_acted',
        turnId,
        agentId: this.id,
        parentSpanId: promptEvent?.eventId,
        causeEventIds: promptEvent ? [promptEvent.eventId] : undefined,
        payload: {
          round: traceContext.round,
          actionType,
          modelId: this.model.getModelId(),
          promptEventId: promptEvent?.eventId,
          chosenAction: decision.action,
          outputText: decision.outputText,
          source: decision.source,
          error: decision.error,
        },
      });

      return {
        action: decision.action,
        turnId,
        promptEventId: promptEvent?.eventId,
        actedEventId: actedEvent?.eventId,
      };
    } else {
      if (!proposal) {
        throw new Error('Proposal required for review action');
      }
      const prompt = formatReviewPrompt(
        proposal,
        belief,
        history,
        this.reputation.karma,
        opponentKarma
      );
      const promptEvent = traceContext?.recorder.emit({
        eventType: 'agent_prompted',
        turnId,
        agentId: this.id,
        payload: {
          round: traceContext.round,
          actionType,
          modelId: this.model.getModelId(),
          prompt,
          history,
          belief,
          karma: this.reputation.karma,
          opponentKarma,
          proposal,
        },
      });
      const decision = await this.model.decideReview(proposal, belief, prompt);
      const actedEvent = traceContext?.recorder.emit({
        eventType: 'agent_acted',
        turnId,
        agentId: this.id,
        parentSpanId: promptEvent?.eventId,
        causeEventIds: promptEvent ? [promptEvent.eventId] : undefined,
        payload: {
          round: traceContext.round,
          actionType,
          modelId: this.model.getModelId(),
          promptEventId: promptEvent?.eventId,
          chosenAction: decision.action,
          outputText: decision.outputText,
          source: decision.source,
          error: decision.error,
        },
      });

      return {
        action: decision.action,
        turnId,
        promptEventId: promptEvent?.eventId,
        actedEventId: actedEvent?.eventId,
      };
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
    return this.constrainAction(action).action;
  }

  public constrainAction(
    action: ProtocolLevel | ReviewAction
  ): {
    action: ProtocolLevel | ReviewAction;
    wasConstrained: boolean;
    reason: 'none' | 'blocked_action' | 'auto_reject';
  } {
    // Apply blocked actions
    if (this.consequences.blockedActions.includes(action as ProtocolLevel)) {
      return {
        action: ProtocolLevel.Medium,
        wasConstrained: true,
        reason: 'blocked_action',
      };
    }

    // Apply auto-reject for very low karma
    if (
      this.reputation.karma < 20 &&
      this.id === 'B' &&
      action === ReviewAction.Accept
    ) {
      return {
        action: ReviewAction.Reject,
        wasConstrained: true,
        reason: 'auto_reject',
      };
    }

    return {
      action,
      wasConstrained: false,
      reason: 'none',
    };
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
