import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMResponse } from '../provider';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async sendMessage(
    prompt: string,
    options?: { imageBase64?: string; imageMimeType?: string; timeoutMs?: number }
  ): Promise<LLMResponse> {
    const model = this.genAI.getGenerativeModel({ model: this.model });

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (options?.imageBase64 && options?.imageMimeType) {
      parts.push({
        inlineData: {
          mimeType: options.imageMimeType,
          data: options.imageBase64,
        },
      });
    }

    parts.push({ text: prompt });

    const result = await Promise.race([
      model.generateContent(parts),
      this.createTimeout(options?.timeoutMs || 30000),
    ]);

    const response = result.response;
    const text = response.text();

    return {
      text,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
      } : undefined,
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
      const model = this.genAI.getGenerativeModel({ model: this.model });
      await model.generateContent('ping');
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
