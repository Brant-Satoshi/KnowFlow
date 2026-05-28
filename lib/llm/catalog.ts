export interface ChatModelOption {
  /** OpenRouter model id, sent verbatim as `model` in chat completions body. */
  id: string;
  /** Brand/proper-noun label; not translated. Descriptions come from i18n keyed by id. */
  label: string;
  free?: boolean;
}

export const CHAT_MODELS: ChatModelOption[] = [
  { id: 'openrouter/free', label: 'Auto' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B', free: true },
];

export const DEFAULT_CHAT_MODEL_ID = CHAT_MODELS[0].id;

export function getChatModel(id?: string | null): ChatModelOption {
  if (!id) return CHAT_MODELS[0];
  return CHAT_MODELS.find(m => m.id === id) ?? CHAT_MODELS[0];
}

export function isKnownChatModel(id: string): boolean {
  return CHAT_MODELS.some(m => m.id === id);
}
