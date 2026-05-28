'use client';

import { CHAT_MODELS, getChatModel } from '@/lib/llm/catalog';
import type { TranslationKeys } from '@/lib/i18n/translations';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  t: TranslationKeys;
  triggerClassName?: string;
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
        <SelectValue placeholder={current.label} />
      </SelectTrigger>
      <SelectContent>
        {CHAT_MODELS.map(model => {
          const description = t.modelDescriptions[model.id];
          return (
            <SelectItem key={model.id} value={model.id} className="cursor-pointer">
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
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
