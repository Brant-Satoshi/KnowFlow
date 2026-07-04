'use client';

import { ListFilter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileListItem, RetrievalFileType, RetrievalFilter } from '@/lib/types';

/**
 * Display strings for the control. Chat and eval pages map these from their
 * own translation sections (`chat` vs `eval`).
 */
export interface RetrievalFilterLabels {
  button: string;
  aria: string;
  filesLabel: string;
  noFiles: string;
  typesLabel: string;
  typePdf: string;
  typeMarkdown: string;
  typeWord: string;
  typeText: string;
  titleLabel: string;
  titlePlaceholder: string;
  clear: string;
}

interface RetrievalFilterControlProps {
  /** Files offered in the file dimension; callers pass indexed files only. */
  files: FileListItem[];
  value: RetrievalFilter;
  onChange: (next: RetrievalFilter) => void;
  disabled?: boolean;
  labels: RetrievalFilterLabels;
  triggerClassName?: string;
}

const FILE_TYPES: RetrievalFileType[] = ['pdf', 'markdown', 'word', 'text'];

function typeLabel(type: RetrievalFileType, labels: RetrievalFilterLabels): string {
  switch (type) {
    case 'pdf':
      return labels.typePdf;
    case 'markdown':
      return labels.typeMarkdown;
    case 'word':
      return labels.typeWord;
    case 'text':
      return labels.typeText;
  }
}

export function RetrievalFilterControl({
  files,
  value,
  onChange,
  disabled,
  labels,
  triggerClassName,
}: RetrievalFilterControlProps) {
  const activeCount =
    (value.fileIds?.length ? 1 : 0) +
    (value.fileTypes?.length ? 1 : 0) +
    (value.titleQuery ? 1 : 0);

  const toggleFileId = (fileId: string) => {
    const current = value.fileIds ?? [];
    const next = current.includes(fileId)
      ? current.filter(id => id !== fileId)
      : [...current, fileId];
    onChange({ ...value, fileIds: next.length ? next : undefined });
  };

  const toggleFileType = (type: RetrievalFileType) => {
    const current = value.fileTypes ?? [];
    const next = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type];
    onChange({ ...value, fileTypes: next.length ? next : undefined });
  };

  const setTitleQuery = (raw: string) => {
    onChange({ ...value, titleQuery: raw.trim() ? raw : undefined });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={labels.aria}
          className={triggerClassName ?? 'h-9 cursor-pointer gap-1.5'}
        >
          <ListFilter className="h-4 w-4" />
          <span>{labels.button}</span>
          {activeCount > 0 ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{labels.filesLabel}</DropdownMenuLabel>
        {files.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{labels.noFiles}</div>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            {files.map(file => (
              <DropdownMenuCheckboxItem
                key={file.id}
                checked={value.fileIds?.includes(file.id) ?? false}
                onSelect={e => e.preventDefault()}
                onCheckedChange={() => toggleFileId(file.id)}
                className="cursor-pointer"
              >
                <span className="truncate">{file.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{labels.typesLabel}</DropdownMenuLabel>
        {FILE_TYPES.map(type => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={value.fileTypes?.includes(type) ?? false}
            onSelect={e => e.preventDefault()}
            onCheckedChange={() => toggleFileType(type)}
            className="cursor-pointer"
          >
            {typeLabel(type, labels)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{labels.titleLabel}</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <Input
            value={value.titleQuery ?? ''}
            onChange={e => setTitleQuery(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder={labels.titlePlaceholder}
            className="h-8"
          />
        </div>
        <DropdownMenuSeparator />
        <div className="p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={activeCount === 0}
            onClick={() => onChange({})}
            className="w-full cursor-pointer justify-center"
          >
            {labels.clear}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
