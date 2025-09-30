'use client';

import { AgentActivityStep } from './diagram-editor';

interface AgentActivityDetailsProps {
  steps: AgentActivityStep[];
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

export function AgentActivityDetails({
  steps,
  isOpen,
  onToggle,
}: AgentActivityDetailsProps) {
  return (
    <details
      className='text-xs'
      open={isOpen}
      onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}
    >
      <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
        Activity ({steps.length})
      </summary>
      <div className='mt-2 space-y-1'>
        {steps.map((step, index) => {
          const baseClasses =
            'p-2 bg-background/30 rounded border text-xs transition-colors';
          const failureClasses =
            'border-destructive/60 bg-destructive/10 text-destructive';
          const successClasses =
            'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-200';
          const className =
            step.type === 'tool-result' && step.validated === false
              ? `${baseClasses} ${failureClasses}`
              : step.type === 'tool-result' && step.validated === true
              ? `${baseClasses} ${successClasses}`
              : baseClasses;

          if (step.type === 'tool-call') {
            return (
              <div key={index} className={className}>
                <div className='font-semibold'>Tool Call</div>
                <div className='text-muted-foreground'>{step.toolName}</div>
              </div>
            );
          }

          if (step.type === 'tool-result') {
            const label =
              step.validated === true
                ? 'Success'
                : step.validated === false
                ? 'Failed'
                : 'Unknown';
            const labelTone =
              step.validated === true
                ? 'text-emerald-600 dark:text-emerald-200'
                : step.validated === false
                ? 'text-destructive'
                : 'text-muted-foreground';
            return (
              <div key={index} className={className}>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-semibold'>Tool Result</span>
                  <span className={`text-[11px] font-medium ${labelTone}`}>
                    {label}
                  </span>
                </div>
                <div className='text-muted-foreground'>{step.toolName}</div>
              </div>
            );
          }

          if (step.type === 'summary') {
            return (
              <div key={index} className={className}>
                <div className='font-semibold'>Summary</div>
                <div className='text-muted-foreground whitespace-pre-wrap'>
                  {step.message}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </details>
  );
}
