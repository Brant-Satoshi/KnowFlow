'use client';

import { CHAT_MODELS, getChatModel } from '@/lib/llm/catalog';
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
  ariaLabel?: string;
  triggerClassName?: string;
}

export function ModelPicker({
  value,
  onChange,
  disabled,
  ariaLabel,
  triggerClassName,
}: ModelPickerProps) {
  const current = getChatModel(value);

  return (
    <Select value={current.id} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel ?? 'Chat model'}
        className={triggerClassName ?? 'h-9 w-45 cursor-pointer'}
      >
        <SelectValue placeholder={current.label} />
      </SelectTrigger>
      <SelectContent>
        {CHAT_MODELS.map(model => (
          <SelectItem key={model.id} value={model.id} className="cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="font-medium">{model.label}</span>
              {model.free ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  free
                </Badge>
              ) : null}
            </div>
            {model.description ? (
              <span className="block text-xs text-muted-foreground">
                {model.description}
              </span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
