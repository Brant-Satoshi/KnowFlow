'use client';

import { CHAT_MODELS, getChatModel } from '@/lib/llm/catalog';
import type { TranslationKeys } from '@/lib/i18n/translations';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  t: TranslationKeys;
  triggerClassName?: string;
}

const modelLogos: Record<string, string> = {
  'openrouter/free': 'https://models.dev/logos/openrouter.svg',
  'anthropic/claude-haiku-4-5': 'https://models.dev/logos/anthropic.svg',
  'deepseek/deepseek-chat-v3.1': 'https://models.dev/logos/deepseek.svg',
  'meta-llama/llama-3.3-70b-instruct:free': 'https://models.dev/logos/meta.svg',
};

function ModelLogo({ modelId }: { modelId: string }) {
  const logo = modelLogos[modelId] ?? 'https://models.dev/logos/openrouter.svg';

  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background/80 ring-1 ring-border/70">
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className="h-3.5 w-3.5 object-contain"
      />
    </span>
  );
}

export function ModelPicker({
  value,
  onChange,
  disabled,
  t,
  triggerClassName,
}: ModelPickerProps) {
  const current = getChatModel(value);

  return (
    <Select value={current.id} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={t.modelPicker}
        className={triggerClassName ?? 'h-9 w-45 cursor-pointer'}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ModelLogo modelId={current.id} />
          <span className="truncate whitespace-nowrap">{current.label}</span>
        </div>
      </SelectTrigger>
      <SelectContent>
        {CHAT_MODELS.map(model => {
          const description = t.modelDescriptions[model.id];
          return (
            <SelectItem key={model.id} value={model.id} className="cursor-pointer">
              <div className="flex items-start gap-2">
                <ModelLogo modelId={model.id} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{model.label}</span>
                    {model.free ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t.modelFreeBadge}
                      </Badge>
                    ) : null}
                  </div>
                  {description ? (
                    <span className="block text-xs text-muted-foreground">
                      {description}
                    </span>
                  ) : null}
                </div>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
