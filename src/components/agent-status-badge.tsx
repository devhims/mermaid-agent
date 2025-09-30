'use client';

import { Badge } from '@/components/ui/badge';

interface AgentStatusBadgeProps {
  status?: {
    label: string;
    tone: 'progress' | 'success' | 'error';
    detail?: string;
  } | null;
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  if (!status) return null;

  const currentStatus = status ?? {
    label: 'Analyzing Diagram',
    tone: 'progress' as const,
    detail: undefined,
  };

  const variant =
    currentStatus.tone === 'error'
      ? 'destructive'
      : currentStatus.tone === 'success'
      ? 'secondary'
      : 'default';

  const customClasses =
    currentStatus.tone === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700'
      : currentStatus.tone === 'progress'
      ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:text-blue-200 dark:border-blue-800'
      : ''; // error uses destructive variant

  return (
    <Badge
      variant={variant}
      className={`text-[11px] px-2 py-1 ${customClasses}`}
      title={
        currentStatus.detail && currentStatus.detail !== currentStatus.label
          ? currentStatus.detail
          : undefined
      }
    >
      <span
        className={`h-2 w-2 rounded-full ${
          currentStatus.tone === 'success'
            ? 'bg-emerald-500'
            : currentStatus.tone === 'error'
            ? 'bg-white'
            : 'bg-blue-500 animate-pulse'
        }`}
      />
      <span>{currentStatus.label}</span>
    </Badge>
  );
}
