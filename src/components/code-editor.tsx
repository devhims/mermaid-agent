'use client';

import { useState, useEffect } from 'react';
import { Code, Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';

interface AgentResult {
  success: boolean;
  message: string;
  finalCode?: string;
  stepsUsed?: number;
  steps?: { action: string; details: string }[];
}

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  onReset: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  agentResult?: AgentResult | null;
  agentStream?: {
    steps: { action: string; details: string }[];
    message?: string;
    finalCode?: string;
    validated?: boolean;
    usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  } | null;
  onAcceptAgentResult?: () => void;
  onDismissAgentResult?: () => void;
  onStopAgent?: () => void;
  agentLoading?: boolean;
  agentStreaming?: boolean;
  onFixWithAgent?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function CodeEditor({
  code,
  onCodeChange,
  onReset,
  onImport,
  onExport,
  agentResult,
  agentStream,
  onAcceptAgentResult,
  onDismissAgentResult,
  onStopAgent,
  agentLoading,
  agentStreaming,
  onFixWithAgent,
  isCollapsed = true,
  onToggleCollapse,
}: CodeEditorProps) {
  const [isOpen, setIsOpen] = useState(!isCollapsed);
  const [stepsOpen, setStepsOpen] = useState(true);

  // Sync internal state with external collapsed state
  useEffect(() => {
    setIsOpen(!isCollapsed);
  }, [isCollapsed]);

  // Auto-minimize steps when streaming completes
  useEffect(() => {
    if (agentStreaming) setStepsOpen(true);
    else setStepsOpen(false);
  }, [agentStreaming]);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    onToggleCollapse?.();
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className='relative'>
        <CollapsibleContent className='space-y-4'>
          <div className='rounded-lg border bg-card/50 backdrop-blur-sm shadow-sm p-4 space-y-4'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Code className='h-4 w-4 text-muted-foreground' />
                <span className='text-sm font-medium'>Mermaid Code</span>
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onReset}
                  className='h-8 px-2 text-xs cursor-pointer'
                >
                  <RotateCcw className='h-3 w-3' />
                </Button>

                {onFixWithAgent && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={onFixWithAgent}
                    disabled={agentLoading}
                    className='h-8 px-2 text-xs text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 shadow-sm cursor-pointer'
                  >
                    {agentLoading ? 'Thinking...' : '✨ Fix with AI'}
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            {/* Code Editor */}
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-muted-foreground uppercase tracking-wide'>
                  Editor
                </span>

                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => navigator.clipboard.writeText(code)}
                  className='text-xs cursor-pointer'
                >
                  <Copy className='h-3 w-3' />
                </Button>
              </div>

              <textarea
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                spellCheck={false}
                className='w-full h-64 resize-none rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed shadow-sm focus:ring-2 focus:ring-ring focus:border-transparent transition-colors'
                placeholder='Paste your Mermaid code here...'
              />
            </div>

            {/* AI Agent Result (streaming and final) */}
            {(agentStream || agentResult) && (
              <div
                className={`rounded-md border p-3 space-y-3 max-h-64 overflow-auto ${
                  agentStream?.validated || agentResult?.success
                    ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
                    : 'border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20'
                }`}
              >
                <div className='flex items-center justify-between'>
                  <span
                    className={`text-sm font-medium ${
                      agentStream?.validated || agentResult?.success
                        ? 'text-blue-800 dark:text-blue-200'
                        : 'text-yellow-800 dark:text-yellow-200'
                    }`}
                  >
                    🤖 Agent {agentStream ? '(Live)' : 'Result'}{' '}
                    {agentResult?.stepsUsed && `(${agentResult.stepsUsed} steps)`}
                  </span>
                  <div className='flex gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={onStopAgent}
                      disabled={!agentLoading}
                      className='h-7 px-2 text-xs'
                    >
                      Stop
                    </Button>
                    {((agentStream?.validated && agentStream?.finalCode) ||
                      (agentResult?.success && agentResult?.finalCode)) &&
                      onAcceptAgentResult && (
                        <Button
                          size='sm'
                          onClick={onAcceptAgentResult}
                          className='h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700'
                        >
                          Apply
                        </Button>
                      )}
                    {onDismissAgentResult && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={onDismissAgentResult}
                        className='h-7 px-2 text-xs'
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live streaming message */}
                {agentStream?.message && (
                  <p className='text-xs text-muted-foreground whitespace-pre-wrap'>
                    {agentStream.message}
                  </p>
                )}

                {/* Final summary message */}
                {agentResult?.message && !agentStream && (
                  <p className='text-xs text-muted-foreground'>
                    {agentResult.message}
                  </p>
                )}

                {/* Final code (live or final) */}
                {(agentStream?.finalCode || agentResult?.finalCode) && (
                  <pre className='text-xs bg-background/50 p-2 rounded border overflow-auto max-h-32'>
                    {agentStream?.finalCode || agentResult?.finalCode}
                  </pre>
                )}

                {/* Steps (live or final) */}
                {((agentStream && agentStream.steps?.length > 0) ||
                  (agentResult?.steps && agentResult.steps.length > 0)) && (
                  <details
                    className='text-xs'
                    open={stepsOpen}
                    onToggle={(e) => setStepsOpen((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
                      View Steps ({agentStream?.steps?.length || agentResult?.steps?.length})
                    </summary>
                    <div className='mt-2 space-y-1'>
                      {(agentStream?.steps || agentResult?.steps || []).map(
                        (step, index) => (
                          <div
                            key={index}
                            className='p-2 bg-background/30 rounded border text-xs'
                          >
                            <div className='font-medium'>{step.action}</div>
                            <div className='text-muted-foreground whitespace-pre-wrap'>
                              {step.details}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </details>
                )}

                {/* Usage footer */}
                {agentStream?.usage && (
                  <div className='pt-2 mt-2 border-t text-[10px] text-muted-foreground'>
                    Usage — input: {agentStream.usage.inputTokens ?? '-'}, output: {agentStream.usage.outputTokens ?? '-'}, total: {agentStream.usage.totalTokens ?? '-'}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>

        {/* Collapsed State Indicator */}
        {!isOpen && (
          <div className='absolute inset-y-0 right-0 flex items-center'>
            <div className='bg-card/80 backdrop-blur-sm border rounded-l-md px-2 py-1 shadow-sm'>
              <Code className='h-4 w-4 text-muted-foreground' />
            </div>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
