import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMResponse } from '../provider';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async sendMessage(
    prompt: string,
    options?: { imageBase64?: string; imageMimeType?: string; timeoutMs?: number }
  ): Promise<LLMResponse> {
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    if (options?.imageBase64 && options?.imageMimeType) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: options.imageMimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: options.imageBase64,
        },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await Promise.race([
      this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content }],
      }),
      this.createTimeout(options?.timeoutMs || 30000),
    ]);

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return {
      text: textBlock && 'text' in textBlock ? textBlock.text : '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async sendTextMessage(
    prompt: string,
    options?: { timeoutMs?: number }
  ): Promise<LLMResponse> {
    return this.sendMessage(prompt, { timeoutMs: options?.timeoutMs });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
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
