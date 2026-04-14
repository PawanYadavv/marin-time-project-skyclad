import { config } from '../config';
import { LLMProvider } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

let providerInstance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (providerInstance) return providerInstance;

  const { provider, model, apiKey, ollamaBaseUrl } = config.llm;

  switch (provider) {
    case 'anthropic':
      providerInstance = new AnthropicProvider(apiKey, model);
      break;

    case 'gemini':
      providerInstance = new GeminiProvider(apiKey, model);
      break;

    case 'openai':
      providerInstance = new OpenAICompatibleProvider('openai', apiKey, model);
      break;

    case 'groq':
      providerInstance = new OpenAICompatibleProvider(
        'groq',
        apiKey,
        model,
        'https://api.groq.com/openai/v1'
      );
      break;

    case 'mistral':
      providerInstance = new OpenAICompatibleProvider(
        'mistral',
        apiKey,
        model,
        'https://api.mistral.ai/v1'
      );
      break;

    case 'ollama':
      providerInstance = new OpenAICompatibleProvider(
        'ollama',
        'ollama',
        model,
        `${ollamaBaseUrl}/v1`
      );
      break;

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return providerInstance;
}

/** Reset provider (useful for testing). */
export function resetLLMProvider(): void {
  providerInstance = null;
}
