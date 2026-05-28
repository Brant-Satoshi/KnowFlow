export interface ChatModelOption {
  /** OpenRouter model id, sent verbatim as `model` in chat completions body. */
  id: string;
  label: string;
  description?: string;
  free?: boolean;
}

export const CHAT_MODELS: ChatModelOption[] = [
  {
    id: 'openrouter/free',
    label: 'Auto',
    description: 'OpenRouter routes to a best-fit model per request',
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fast, low cost',
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Highest quality',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B',
    description: 'Free tier',
    free: true,
  },
];

export const DEFAULT_CHAT_MODEL_ID = CHAT_MODELS[0].id;

export function getChatModel(id?: string | null): ChatModelOption {
  if (!id) return CHAT_MODELS[0];
  return CHAT_MODELS.find(m => m.id === id) ?? CHAT_MODELS[0];
}

export function isKnownChatModel(id: string): boolean {
  return CHAT_MODELS.some(m => m.id === id);
}
