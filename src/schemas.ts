import { z } from 'zod';

// --- Zod schemas (runtime validation) ---

export const ProposalResponseSchema = z.object({
  proposal: z.enum(['Low', 'Medium', 'High']),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  belief_state: z
    .object({
      own_safety_belief: z.number().min(0).max(1),
      opponent_cooperation_belief: z.number().min(0).max(1),
    })
    .optional(),
});

export const ReviewResponseSchema = z.object({
  decision: z.enum(['Accept', 'Reject', 'Modify']),
  counter_proposal: z.enum(['Low', 'Medium', 'High']).nullable().optional(),
  reasoning: z.string(),
  trust_assessment: z.number().min(0).max(1).optional(),
});

// --- TypeScript types derived from Zod ---

export type ProposalResponse = z.infer<typeof ProposalResponseSchema>;
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

// --- JSON Schema representations for OpenRouter response_format ---

export const ProposalResponseJsonSchema = {
  type: 'object' as const,
  properties: {
    proposal: {
      type: 'string' as const,
      enum: ['Low', 'Medium', 'High'],
    },
    reasoning: { type: 'string' as const },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
    belief_state: {
      type: 'object' as const,
      properties: {
        own_safety_belief: {
          type: 'number' as const,
          minimum: 0,
          maximum: 1,
        },
        opponent_cooperation_belief: {
          type: 'number' as const,
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['own_safety_belief', 'opponent_cooperation_belief'],
    },
  },
  required: ['proposal', 'reasoning'],
  additionalProperties: false,
};

export const ReviewResponseJsonSchema = {
  type: 'object' as const,
  properties: {
    decision: {
      type: 'string' as const,
      enum: ['Accept', 'Reject', 'Modify'],
    },
    counter_proposal: {
      type: ['string', 'null'] as const,
      enum: ['Low', 'Medium', 'High', null],
    },
    reasoning: { type: 'string' as const },
    trust_assessment: { type: 'number' as const, minimum: 0, maximum: 1 },
  },
  required: ['decision', 'reasoning'],
  additionalProperties: false,
};

// Generic JSON schema type for the OpenRouter client
export interface JsonSchema {
  type: string | readonly string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
}
