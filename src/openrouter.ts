import { z } from 'zod';
import pLimit from 'p-limit';
import { JsonSchema } from './schemas';

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  rateLimit?: number; // ms between requests, default 200
  maxRetries?: number; // default 3
  baseUrl?: string; // default https://openrouter.ai/api/v1
}

export interface StructuredResponse<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number };
  cost: number;
  latencyMs: number;
  model: string;
}

interface OpenRouterChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Model pricing per million tokens (input, output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'google/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'deepseek/deepseek-chat-v3.1': { input: 0.15, output: 0.75 },
  'moonshotai/kimi-k2-0905': { input: 0.39, output: 1.9 },
  'mistralai/mistral-small-3.1-24b-instruct': { input: 0.03, output: 0.11 },
};

export class OpenRouterClient {
  private config: Required<
    Pick<OpenRouterConfig, 'apiKey' | 'model' | 'rateLimit' | 'maxRetries'>
  > & { baseUrl: string };
  private limiter: ReturnType<typeof pLimit>;
  private lastCallTime = 0;
  private totalCost = 0;
  private requestCount = 0;

  constructor(config: OpenRouterConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model,
      rateLimit: config.rateLimit ?? 200,
      maxRetries: config.maxRetries ?? 3,
      baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    };
    this.limiter = pLimit(1);
  }

  async complete<T>(
    prompt: string,
    schema: JsonSchema,
    zodSchema: z.ZodType<T>,
    options?: { temperature?: number; systemPrompt?: string }
  ): Promise<StructuredResponse<T>> {
    return this.limiter(async () => {
      // Rate limit enforcement
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.config.rateLimit) {
        await sleep(this.config.rateLimit - elapsed);
      }
      this.lastCallTime = Date.now();

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        if (attempt > 0) {
          const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          const jitter = Math.random() * backoff * 0.1;
          await sleep(backoff + jitter);
        }

        try {
          const start = Date.now();
          const response = await this.makeRequest(prompt, schema, options);
          const latencyMs = Date.now() - start;

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No response content from OpenRouter');
          }

          const parsed = JSON.parse(content);
          const validated = zodSchema.parse(parsed);

          const usage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
          };

          const cost = this.calculateCost(
            response.model || this.config.model,
            usage.promptTokens,
            usage.completionTokens
          );
          this.totalCost += cost;
          this.requestCount++;

          return {
            data: validated,
            usage,
            cost,
            latencyMs,
            model: response.model || this.config.model,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Don't retry on validation errors (schema mismatch)
          if (error instanceof z.ZodError) {
            throw new OpenRouterError(
              `Schema validation failed: ${error.message}`,
              'VALIDATION_ERROR',
              error
            );
          }

          // Don't retry on 4xx errors (except 429)
          if (
            error instanceof OpenRouterError &&
            error.statusCode &&
            error.statusCode >= 400 &&
            error.statusCode < 500 &&
            error.statusCode !== 429
          ) {
            throw error;
          }

          if (attempt === this.config.maxRetries) {
            throw new OpenRouterError(
              `Failed after ${this.config.maxRetries + 1} attempts: ${lastError.message}`,
              'MAX_RETRIES_EXCEEDED',
              lastError
            );
          }
        }
      }

      // Should not reach here
      throw lastError || new Error('Unknown error');
    });
  }

  private async makeRequest(
    prompt: string,
    schema: JsonSchema,
    options?: { temperature?: number; systemPrompt?: string }
  ): Promise<OpenRouterChatResponse> {
    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'system',
          content:
            options?.systemPrompt ??
            'You are a strategic agent in a security negotiation game. Respond with valid JSON matching the required schema.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.7,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema,
        },
      },
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          'https://github.com/cyberCharl/mutli-agent-reputation-system-simulation',
        'X-Title': 'MSPN Simulation',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new OpenRouterError(
        `OpenRouter API error ${response.status}: ${errorBody}`,
        'API_ERROR',
        undefined,
        response.status
      );
    }

    return (await response.json()) as OpenRouterChatResponse;
  }

  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      return 0; // Unknown model pricing
    }
    return (
      (promptTokens / 1_000_000) * pricing.input +
      (completionTokens / 1_000_000) * pricing.output
    );
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getModel(): string {
    return this.config.model;
  }

  resetStats(): void {
    this.totalCost = 0;
    this.requestCount = 0;
  }
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: Error,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Supported models for comparison runs
export const SUPPORTED_MODELS = [
  'google/gemini-2.5-flash-lite',
  'deepseek/deepseek-chat-v3.1',
  'moonshotai/kimi-k2-0905',
  'mistralai/mistral-small-3.1-24b-instruct',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

// Short aliases for CLI convenience
export const MODEL_ALIASES: Record<string, SupportedModel> = {
  gemini: 'google/gemini-2.5-flash-lite',
  deepseek: 'deepseek/deepseek-chat-v3.1',
  kimi: 'moonshotai/kimi-k2-0905',
  mistral: 'mistralai/mistral-small-3.1-24b-instruct',
};
