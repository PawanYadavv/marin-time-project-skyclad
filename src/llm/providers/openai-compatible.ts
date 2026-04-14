import OpenAI from 'openai';
import { LLMProvider, LLMResponse } from '../provider';

/**
 * OpenAI-compatible provider — works for OpenAI, Groq, Mistral, and Ollama
 * since they all expose an OpenAI-compatible API.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor(
    name: string,
    apiKey: string,
    model: string,
    baseURL?: string
  ) {
    this.name = name;
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    this.model = model;
  }

  async sendMessage(
    prompt: string,
    options?: { imageBase64?: string; imageMimeType?: string; timeoutMs?: number }
  ): Promise<LLMResponse> {
    const content: OpenAI.ChatCompletionContentPart[] = [];

    if (options?.imageBase64 && options?.imageMimeType) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${options.imageMimeType};base64,${options.imageBase64}`,
        },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await Promise.race([
      this.client.chat.completions.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content }],
      }),
      this.createTimeout(options?.timeoutMs || 30000),
    ]);

    const text = response.choices[0]?.message?.content || '';

    return {
      text,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens ?? 0,
        outputTokens: response.usage.completion_tokens ?? 0,
      } : undefined,
    };
  }

  async sendTextMessage(
    prompt: string,
    options?: { timeoutMs?: number }
  ): Promise<LLMResponse> {
    const response = await Promise.race([
      this.client.chat.completions.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
      this.createTimeout(options?.timeoutMs || 30000),
    ]);

    return {
      text: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens ?? 0,
        outputTokens: response.usage.completion_tokens ?? 0,
      } : undefined,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM_TIMEOUT')), ms)
    );
  }
}
