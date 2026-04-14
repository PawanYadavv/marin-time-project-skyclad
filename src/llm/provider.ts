/**
 * LLM Provider abstraction layer.
 *
 * Each provider implements a single interface, allowing the service
 * to swap between Anthropic, Gemini, Groq, OpenAI, Mistral, or Ollama
 * via environment variables with zero code changes.
 */

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface LLMResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  readonly name: string;

  /**
   * Send a message with optional image to the LLM and get a text response.
   * Implementations must handle their own timeout logic.
   */
  sendMessage(
    prompt: string,
    options?: {
      imageBase64?: string;
      imageMimeType?: string;
      timeoutMs?: number;
    }
  ): Promise<LLMResponse>;

  /**
   * Simple text-only request (used for JSON repair, validation, etc.)
   */
  sendTextMessage(
    prompt: string,
    options?: {
      timeoutMs?: number;
    }
  ): Promise<LLMResponse>;

  /**
   * Health check — verifies the provider is reachable.
   */
  healthCheck(): Promise<boolean>;
}
