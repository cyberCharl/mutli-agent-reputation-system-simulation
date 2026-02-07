import { OpenRouterClient, OpenRouterError } from '../src/openrouter';
import {
  ProposalResponseSchema,
  ProposalResponseJsonSchema,
  ReviewResponseSchema,
  ReviewResponseJsonSchema,
  ProposalResponse,
  ReviewResponse,
} from '../src/schemas';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeSuccessResponse(
  content: object,
  usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'test-id',
      model: 'google/gemini-2.5-flash-lite',
      choices: [
        {
          message: { role: 'assistant', content: JSON.stringify(content) },
          finish_reason: 'stop',
        },
      ],
      usage,
    }),
  };
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

describe('OpenRouterClient', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash-lite',
      rateLimit: 0, // No rate limiting in tests
      maxRetries: 2,
    });
  });

  describe('successful requests', () => {
    test('should parse a valid proposal response', async () => {
      const validProposal: ProposalResponse = {
        proposal: 'High',
        reasoning: 'The state seems dangerous, better to be safe.',
        confidence: 0.8,
        belief_state: {
          own_safety_belief: 0.3,
          opponent_cooperation_belief: 0.6,
        },
      };

      mockFetch.mockResolvedValueOnce(makeSuccessResponse(validProposal));

      const result = await client.complete<ProposalResponse>(
        'test prompt',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(result.data.proposal).toBe('High');
      expect(result.data.reasoning).toBe(
        'The state seems dangerous, better to be safe.'
      );
      expect(result.data.confidence).toBe(0.8);
      expect(result.usage.promptTokens).toBe(100);
      expect(result.usage.completionTokens).toBe(50);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.model).toBe('google/gemini-2.5-flash-lite');
    });

    test('should parse a valid review response', async () => {
      const validReview: ReviewResponse = {
        decision: 'Modify',
        counter_proposal: 'Medium',
        reasoning: 'The proposal is too risky, suggesting a compromise.',
        trust_assessment: 0.5,
      };

      mockFetch.mockResolvedValueOnce(makeSuccessResponse(validReview));

      const result = await client.complete<ReviewResponse>(
        'test prompt',
        ReviewResponseJsonSchema,
        ReviewResponseSchema
      );

      expect(result.data.decision).toBe('Modify');
      expect(result.data.counter_proposal).toBe('Medium');
      expect(result.data.trust_assessment).toBe(0.5);
    });

    test('should parse a minimal proposal response (only required fields)', async () => {
      const minimalProposal = {
        proposal: 'Low',
        reasoning: 'Safe state is likely.',
      };

      mockFetch.mockResolvedValueOnce(makeSuccessResponse(minimalProposal));

      const result = await client.complete<ProposalResponse>(
        'test prompt',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(result.data.proposal).toBe('Low');
      expect(result.data.confidence).toBeUndefined();
      expect(result.data.belief_state).toBeUndefined();
    });

    test('should track cost correctly for known models', async () => {
      const proposal = { proposal: 'Medium', reasoning: 'balanced' };
      mockFetch.mockResolvedValueOnce(
        makeSuccessResponse(proposal, {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        })
      );

      const result = await client.complete<ProposalResponse>(
        'test',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      // google/gemini-2.5-flash-lite: input $0.10/M, output $0.40/M
      // 1000 input tokens = $0.0001, 500 output tokens = $0.0002
      expect(result.cost).toBeCloseTo(0.0003, 6);
      expect(client.getTotalCost()).toBeCloseTo(0.0003, 6);
      expect(client.getRequestCount()).toBe(1);
    });

    test('should send correct headers and body', async () => {
      const proposal = { proposal: 'Medium', reasoning: 'test' };
      mockFetch.mockResolvedValueOnce(makeSuccessResponse(proposal));

      await client.complete<ProposalResponse>(
        'my prompt',
        ProposalResponseJsonSchema,
        ProposalResponseSchema,
        { temperature: 0.5, systemPrompt: 'custom system prompt' }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://openrouter.ai/api/v1/chat/completions'
      );

      const headers = options.headers;
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('google/gemini-2.5-flash-lite');
      expect(body.temperature).toBe(0.5);
      expect(body.messages[0].content).toBe('custom system prompt');
      expect(body.messages[1].content).toBe('my prompt');
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.strict).toBe(true);
    });
  });

  describe('error handling', () => {
    test('should throw on schema validation failure without retrying', async () => {
      const invalidProposal = {
        proposal: 'Invalid',
        reasoning: 'test',
      };
      mockFetch.mockResolvedValueOnce(makeSuccessResponse(invalidProposal));

      await expect(
        client.complete<ProposalResponse>(
          'test',
          ProposalResponseJsonSchema,
          ProposalResponseSchema
        )
      ).rejects.toThrow('Schema validation failed');

      // Should NOT retry on validation errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should throw on 4xx errors without retrying (except 429)', async () => {
      mockFetch.mockResolvedValueOnce(
        makeErrorResponse(401, 'Unauthorized')
      );

      await expect(
        client.complete<ProposalResponse>(
          'test',
          ProposalResponseJsonSchema,
          ProposalResponseSchema
        )
      ).rejects.toThrow('OpenRouter API error 401');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should retry on 429 rate limit errors', async () => {
      const proposal = { proposal: 'Medium', reasoning: 'test' };

      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(429, 'Rate limited'))
        .mockResolvedValueOnce(makeSuccessResponse(proposal));

      const result = await client.complete<ProposalResponse>(
        'test',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(result.data.proposal).toBe('Medium');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should retry on 5xx server errors', async () => {
      const proposal = { proposal: 'High', reasoning: 'retry worked' };

      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'))
        .mockResolvedValueOnce(makeSuccessResponse(proposal));

      const result = await client.complete<ProposalResponse>(
        'test',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(result.data.proposal).toBe('High');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should retry on network errors', async () => {
      const proposal = { proposal: 'Low', reasoning: 'network recovered' };

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(makeSuccessResponse(proposal));

      const result = await client.complete<ProposalResponse>(
        'test',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(result.data.proposal).toBe('Low');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should throw after max retries exceeded', async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(500, 'Server Error'))
        .mockResolvedValueOnce(makeErrorResponse(500, 'Server Error'))
        .mockResolvedValueOnce(makeErrorResponse(500, 'Server Error'));

      await expect(
        client.complete<ProposalResponse>(
          'test',
          ProposalResponseJsonSchema,
          ProposalResponseSchema
        )
      ).rejects.toThrow('Failed after 3 attempts');

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test('should throw when response has no content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'test',
          choices: [
            {
              message: { role: 'assistant', content: '' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      await expect(
        client.complete<ProposalResponse>(
          'test',
          ProposalResponseJsonSchema,
          ProposalResponseSchema
        )
      ).rejects.toThrow();
    });
  });

  describe('stats tracking', () => {
    test('should track cumulative cost and request count', async () => {
      const proposal = { proposal: 'Medium', reasoning: 'test' };

      mockFetch
        .mockResolvedValueOnce(makeSuccessResponse(proposal))
        .mockResolvedValueOnce(makeSuccessResponse(proposal));

      await client.complete<ProposalResponse>(
        'test1',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );
      await client.complete<ProposalResponse>(
        'test2',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(client.getRequestCount()).toBe(2);
      expect(client.getTotalCost()).toBeGreaterThan(0);
    });

    test('should reset stats', async () => {
      const proposal = { proposal: 'Medium', reasoning: 'test' };
      mockFetch.mockResolvedValueOnce(makeSuccessResponse(proposal));

      await client.complete<ProposalResponse>(
        'test',
        ProposalResponseJsonSchema,
        ProposalResponseSchema
      );

      expect(client.getRequestCount()).toBe(1);
      client.resetStats();
      expect(client.getRequestCount()).toBe(0);
      expect(client.getTotalCost()).toBe(0);
    });
  });

  describe('model identity', () => {
    test('should return configured model', () => {
      expect(client.getModel()).toBe('google/gemini-2.5-flash-lite');
    });
  });
});

describe('Schema validation', () => {
  test('ProposalResponseSchema validates correct data', () => {
    const valid = {
      proposal: 'High',
      reasoning: 'Because safety matters',
      confidence: 0.9,
      belief_state: {
        own_safety_belief: 0.2,
        opponent_cooperation_belief: 0.7,
      },
    };
    expect(() => ProposalResponseSchema.parse(valid)).not.toThrow();
  });

  test('ProposalResponseSchema rejects invalid proposal value', () => {
    const invalid = { proposal: 'VeryHigh', reasoning: 'test' };
    expect(() => ProposalResponseSchema.parse(invalid)).toThrow();
  });

  test('ProposalResponseSchema rejects missing required fields', () => {
    const missing = { proposal: 'Low' };
    expect(() => ProposalResponseSchema.parse(missing)).toThrow();
  });

  test('ReviewResponseSchema validates correct data', () => {
    const valid = {
      decision: 'Modify',
      counter_proposal: 'Medium',
      reasoning: 'Compromise needed',
      trust_assessment: 0.6,
    };
    expect(() => ReviewResponseSchema.parse(valid)).not.toThrow();
  });

  test('ReviewResponseSchema allows null counter_proposal', () => {
    const valid = {
      decision: 'Accept',
      counter_proposal: null,
      reasoning: 'Looks good',
    };
    expect(() => ReviewResponseSchema.parse(valid)).not.toThrow();
  });

  test('ReviewResponseSchema rejects invalid decision', () => {
    const invalid = { decision: 'Maybe', reasoning: 'test' };
    expect(() => ReviewResponseSchema.parse(invalid)).toThrow();
  });

  test('ReviewResponseSchema rejects out-of-range trust_assessment', () => {
    const invalid = { decision: 'Accept', reasoning: 'test', trust_assessment: 1.5 };
    expect(() => ReviewResponseSchema.parse(invalid)).toThrow();
  });
});
