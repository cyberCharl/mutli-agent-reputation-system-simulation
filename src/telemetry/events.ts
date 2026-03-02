import { z } from 'zod';
import {
  AgentId,
  EpisodeFinishedPayload,
  ProtocolLevel,
  ReviewAction,
  TraceActionType,
  TraceEpisodeSummary,
  TraceEvent,
  TraceEventType,
  TraceVariant,
  TrueState,
} from '../types';

const protocolLevelSchema = z.nativeEnum(ProtocolLevel);
const reviewActionSchema = z.nativeEnum(ReviewAction);
const trueStateSchema = z.nativeEnum(TrueState);
const agentIdSchema = z.custom<AgentId>(
  (value) => value === 'A' || value === 'B',
  'Expected agent id A or B'
);
const traceVariantSchema = z.custom<TraceVariant>(
  (value) =>
    value === 'baseline' || value === 'reputation' || value === 'adhoc',
  'Expected trace variant'
);
const traceActionTypeSchema = z.custom<TraceActionType>(
  (value) => value === 'propose' || value === 'review',
  'Expected trace action type'
);
const traceActionSchema = z.union([protocolLevelSchema, reviewActionSchema]);
const probabilityVectorSchema = z.object({
  [TrueState.SafeLow]: z.number(),
  [TrueState.DangerousLow]: z.number(),
});
const nestedBeliefSchema = z.object({
  own: probabilityVectorSchema,
  aboutOpponent: probabilityVectorSchema,
});
const payoffsSchema = z.object({
  a: z.number(),
  b: z.number(),
});

const payloadSchemas: Record<TraceEventType, z.ZodTypeAny> = {
  episode_started: z.object({
    variant: traceVariantSchema,
    trueState: trueStateSchema,
    reputationEnabled: z.boolean(),
    seed: z.string().optional(),
    initialKarma: z.object({
      A: z.number(),
      B: z.number(),
    }),
  }),
  agent_prompted: z.object({
    round: z.number().int().positive(),
    actionType: traceActionTypeSchema,
    modelId: z.string(),
    prompt: z.string(),
    history: z.array(z.string()),
    belief: nestedBeliefSchema,
    karma: z.number(),
    opponentKarma: z.number().optional(),
    reputationWarning: z.string().optional(),
    proposal: protocolLevelSchema.optional(),
  }),
  agent_acted: z.object({
    round: z.number().int().positive(),
    actionType: traceActionTypeSchema,
    modelId: z.string(),
    promptEventId: z.string().optional(),
    chosenAction: traceActionSchema,
    outputText: z.string(),
    source: z.enum(['mock', 'llm', 'fallback']),
    error: z.string().optional(),
  }),
  action_constrained: z.object({
    round: z.number().int().positive(),
    actionType: traceActionTypeSchema,
    originalAction: traceActionSchema,
    appliedAction: traceActionSchema,
    wasConstrained: z.boolean(),
    reason: z.enum(['none', 'blocked_action', 'auto_reject']),
    blockedActions: z.array(protocolLevelSchema),
    payoffPenalty: z.number(),
    autoReject: z.boolean(),
    karma: z.number(),
  }),
  belief_updated: z.object({
    round: z.number().int().positive(),
    phase: z.enum(['proposal', 'review']),
    updateKind: z.enum(['self', 'observation']),
    sourceAgentId: agentIdSchema,
    subjectAgentId: agentIdSchema,
    targetField: z.enum(['own', 'aboutOpponent']),
    basisAction: traceActionSchema,
    before: probabilityVectorSchema,
    after: probabilityVectorSchema,
  }),
  evaluator_scored: z.object({
    sourceEvaluator: z.string(),
    rubricVersion: z.string(),
    targetModelId: z.string(),
    targetAgentId: agentIdSchema,
    delta: z.number(),
    reason: z.string(),
    outcome: z.object({
      trueState: trueStateSchema,
      finalProtocol: protocolLevelSchema.optional(),
      reviewAction: reviewActionSchema.optional(),
      payoffs: payoffsSchema,
    }),
  }),
  reputation_updated: z.object({
    sourceEvaluator: z.string(),
    rubricVersion: z.string(),
    targetModelId: z.string(),
    targetAgentId: agentIdSchema,
    previousKarma: z.number(),
    newKarma: z.number(),
    delta: z.number(),
    reason: z.string(),
  }),
  episode_finished: z.object({
    roundCount: z.number().int().positive(),
    converged: z.boolean(),
    trueState: trueStateSchema,
    finalProtocol: protocolLevelSchema.optional(),
    reviewAction: reviewActionSchema.optional(),
    payoffs: payoffsSchema,
    rawPayoffs: payoffsSchema.optional(),
  }),
};

export const traceEventSchema: z.ZodType<TraceEvent> = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    episodeId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    parentSpanId: z.string().min(1).optional(),
    causeEventIds: z.array(z.string().min(1)).optional(),
    eventType: z.enum([
      'episode_started',
      'agent_prompted',
      'agent_acted',
      'action_constrained',
      'belief_updated',
      'evaluator_scored',
      'reputation_updated',
      'episode_finished',
    ]),
    timestamp: z.string().datetime(),
    payload: z.record(z.unknown()),
  })
  .superRefine((event, ctx) => {
    const parsed = payloadSchemas[event.eventType].safeParse(event.payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload', ...issue.path],
          message: issue.message,
        });
      }
    }
  }) as z.ZodType<TraceEvent>;

export function parseTraceEvent(raw: unknown): TraceEvent {
  return traceEventSchema.parse(raw);
}

function formatEpisodeFinishedHistory(payload: EpisodeFinishedPayload): string {
  const payoffs = payload.rawPayoffs || payload.payoffs;
  return `Final protocol: ${payload.finalProtocol || 'rejected'}, Payoffs: A=${payoffs.a}, B=${payoffs.b}`;
}

export function deriveHistoryFromEvents(events: TraceEvent[]): string[] {
  const history: string[] = [];
  let proposalCount = 0;

  for (const event of events) {
    if (event.eventType === 'action_constrained') {
      if (event.payload.actionType === 'propose') {
        if (proposalCount > 0) {
          history.push('--- New negotiation round ---');
        }
        proposalCount += 1;
        history.push(`${event.agentId || 'A'} proposed ${event.payload.appliedAction}`);
      } else {
        history.push(`${event.agentId || 'B'} chose ${event.payload.appliedAction}`);
      }
    }

    if (event.eventType === 'episode_finished') {
      history.push(formatEpisodeFinishedHistory(event.payload));
    }
  }

  return history;
}

export function normalizeTraceEventsForComparison(
  events: TraceEvent[]
): TraceEvent[] {
  return events.map((event) => ({
    ...event,
    timestamp: '<normalized-timestamp>',
  }));
}

export function summarizeEpisodeTrace(summary: TraceEpisodeSummary): string {
  return JSON.stringify(summary);
}
