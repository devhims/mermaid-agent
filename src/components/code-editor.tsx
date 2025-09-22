'use client';

import { useState, useEffect, useRef } from 'react';
import { Code, Copy, RotateCcw, CheckCheck } from 'lucide-react';
import { LuImport } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

export type AgentActivityStep =
  | { type: 'tool-call'; toolName: string }
  | { type: 'tool-result'; toolName: string; validated: boolean | null }
  | { type: 'summary'; message: string };

interface AgentResult {
  success: boolean;
  message: string;
  finalCode?: string;
  stepsUsed?: number;
  toolCallCount?: number;
  steps?: AgentActivityStep[];
}

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  onReset: () => void;
  onImport: (file: File) => void;
  agentResult?: AgentResult | null;
  agentStream?: {
    steps: AgentActivityStep[];
    message?: string;
    finalCode?: string;
    validated?: boolean;
    usage?: {
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    status?: {
      label: string;
      tone: 'progress' | 'success' | 'error';
      detail?: string;
      toolName?: string;
    };
  } | null;
  onAcceptAgentResult?: () => void;
  onDismissAgentResult?: () => void;
  onStopAgent?: () => void;
  agentLoading?: boolean;
  agentStreaming?: boolean;
  onFixWithAgent?: () => void;
  agentStatus?: {
    label: string;
    detail?: string;
    tone: 'progress' | 'success' | 'error';
  } | null;
  diagramError?: string | null;
  isCollapsed?: boolean;
  onToggleCollapse?: (open: boolean) => void;
}

export function CodeEditor({
  code,
  onCodeChange,
  onReset,
  onImport,
  agentResult,
  agentStream,
  onAcceptAgentResult,
  onDismissAgentResult,
  onStopAgent,
  agentLoading,
  agentStreaming,
  onFixWithAgent,
  agentStatus,
  diagramError,
  isCollapsed = true,
  onToggleCollapse,
}: CodeEditorProps) {
  const [isOpen, setIsOpen] = useState(!isCollapsed);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorPanelRef = useRef<ImperativePanelHandle | null>(null);
  const resultsPanelRef = useRef<ImperativePanelHandle | null>(null);
  const [showActivityPanel, setShowActivityPanel] = useState(false);

  // Sync internal state with external collapsed state
  useEffect(() => {
    setIsOpen(!isCollapsed);
  }, [isCollapsed]);

  // Auto-minimize steps when streaming completes
  useEffect(() => {
    if (agentStreaming) setStepsOpen(true);
    else setStepsOpen(false);
  }, [agentStreaming]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onToggleCollapse?.(open);
  };

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelection: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      onImport(file);
    }
    event.target.value = '';
  };

  const handleAutoFixClick = () => {
    setShowActivityPanel(true);
    try {
      resultsPanelRef.current?.expand();
      resultsPanelRef.current?.resize(50);
    } catch {}
    onFixWithAgent?.();
  };

  const handleAcceptAgentResultClick = () => {
    onAcceptAgentResult?.();
    setShowActivityPanel(false);
  };

  const handleDismissAgentResultClick = () => {
    onDismissAgentResult?.();
    setShowActivityPanel(false);
  };

  const successfulValidation =
    (agentStream?.validated ?? false) || (agentResult?.success ?? false);
  const showFixButton =
    !!diagramError && !agentStreaming && !agentLoading && !successfulValidation;
  const activitySteps = agentStream?.steps ?? agentResult?.steps ?? [];

  const renderAgentStatus = () => {
    if (!agentStatus && !agentStreaming && !agentLoading) return null;
    const status = agentStatus ?? {
      label: 'Analyzing diagram…',
      tone: 'progress' as const,
      detail: undefined,
    };
    const toneClasses =
      status.tone === 'success'
        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700'
        : status.tone === 'error'
        ? 'bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800'
        : 'bg-blue-50/80 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:text-blue-200 dark:border-blue-800';

    return (
      <div
        className={`text-[11px] px-2.5 py-1 rounded-md border font-medium shadow-sm flex items-center gap-2 ${toneClasses}`}
        title={
          status.detail && status.detail !== status.label
            ? status.detail
            : undefined
        }
      >
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            status.tone === 'success'
              ? 'bg-emerald-500'
              : status.tone === 'error'
              ? 'bg-amber-500'
              : 'bg-blue-500 animate-pulse'
          }`}
        />
        <span>{status.label}</span>
      </div>
    );
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className='h-full'
    >
      <div className='relative h-full'>
        <input
          ref={fileInputRef}
          type='file'
          accept='.mmd,.md,.txt,.mermaid,.json'
          className='hidden'
          onChange={handleFileSelection}
        />
        <CollapsibleContent className='space-y-4 h-full'>
          <div className='rounded-lg bg-card/50 backdrop-blur-sm shadow-sm p-4 space-y-2 h-full flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Code className='h-4 w-4 text-muted-foreground' />
                <span className='text-sm font-medium'>Mermaid Code</span>
              </div>

              <div className='h-8'>
                {onFixWithAgent && showFixButton && (
                  <Button
                    variant='default'
                    size='sm'
                    onClick={handleAutoFixClick}
                    disabled={agentLoading}
                    className='h-8 px-2 text-xs shadow-sm cursor-pointer bg-emerald-600 hover:bg-emerald-700'
                  >
                    ✨ Auto Fix
                  </Button>
                )}
                {!showFixButton && renderAgentStatus()}
              </div>
            </div>

            <Separator />

            {/* Resizable vertical split for Editor and Agent Result */}
            <div className='flex-1 min-h-0'>
              <ResizablePanelGroup
                key={showActivityPanel ? 'with-activity' : 'no-activity'}
                direction='vertical'
                className='min-h-[360px] h-full'
              >
                <ResizablePanel
                  ref={editorPanelRef}
                  defaultSize={showActivityPanel ? 50 : 100}
                  minSize={30}
                  maxSize={90}
                  collapsible
                  collapsedSize={0}
                >
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-xs text-muted-foreground uppercase tracking-wide'>
                        Editor
                      </span>

                      <div className='flex items-center gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={handleImportClick}
                          className='h-8 px-2 text-xs cursor-pointer'
                        >
                          <LuImport className='h-3 w-3 mr-1' />
                          Import
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={onReset}
                          className='h-8 px-2 text-xs cursor-pointer'
                        >
                          <RotateCcw className='h-3 w-3' />
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={handleCopyClick}
                          className='text-xs cursor-pointer'
                        >
                          {copied ? (
                            <CheckCheck className='h-3 w-3 text-white' />
                          ) : (
                            <Copy className='h-3 w-3' />
                          )}
                        </Button>
                      </div>
                    </div>

                    <textarea
                      value={code}
                      onChange={(e) => onCodeChange(e.target.value)}
                      spellCheck={false}
                      className='w-full h-64 resize-none rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed shadow-sm focus:ring-2 focus:ring-ring focus:border-transparent transition-colors'
                      placeholder='Paste your Mermaid code here...'
                    />
                  </div>
                </ResizablePanel>

                {showActivityPanel && (
                  <>
                    <ResizableHandle withHandle className='my-2' />

                    <ResizablePanel
                      ref={resultsPanelRef}
                      defaultSize={50}
                      minSize={10}
                      collapsible
                      collapsedSize={0}
                    >
                      {agentStream || agentResult ? (
                        <div
                          className={`rounded-md border p-3 space-y-3 h-full overflow-auto ${
                            agentStream?.validated || agentResult?.success
                              ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
                              : 'border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20'
                          }`}
                        >
                          <div className='flex items-center justify-between'>
                            <div className='flex flex-col gap-1'>
                              <span
                                className={`text-sm font-medium ${
                                  agentStream?.validated || agentResult?.success
                                    ? 'text-slate-700 dark:text-blue-200'
                                    : 'text-amber-700 dark:text-yellow-200'
                                }`}
                              >
                                🤖 Agent {agentStreaming ? '(Live)' : 'Result'}
                                {agentStreaming && (
                                  <span className='inline-flex ml-1'>
                                    <span className='inline-block h-2 w-2 bg-current rounded-full animate-pulse'></span>
                                  </span>
                                )}
                              </span>
                              {(() => {
                                const stepCount =
                                  typeof agentResult?.stepsUsed === 'number'
                                    ? agentResult.stepsUsed
                                    : undefined;
                                const toolCallCount =
                                  typeof agentResult?.toolCallCount === 'number'
                                    ? agentResult.toolCallCount
                                    : undefined;

                                if (
                                  stepCount == null &&
                                  toolCallCount == null
                                ) {
                                  return null;
                                }

                                const parts: string[] = [];
                                if (stepCount != null) {
                                  parts.push(
                                    `${stepCount} ${
                                      stepCount === 1 ? 'step' : 'steps'
                                    }`
                                  );
                                }
                                if (toolCallCount != null) {
                                  parts.push(
                                    `${toolCallCount} ${
                                      toolCallCount === 1
                                        ? 'tool call'
                                        : 'tool calls'
                                    }`
                                  );
                                }

                                return (
                                  <span className='text-xs text-muted-foreground'>
                                    {parts.join(' • ')}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className='flex gap-2'>
                              {agentStreaming && (
                                <div className='flex gap-2 '>
                                  <Button
                                    variant='destructive'
                                    size='sm'
                                    onClick={onStopAgent}
                                    disabled={!agentLoading}
                                    className='h-7 px-2 text-xs cursor-pointer'
                                  >
                                    Stop
                                  </Button>
                                </div>
                              )}
                              {!agentStreaming &&
                                ((agentStream?.validated &&
                                  agentStream?.finalCode) ||
                                  (!agentStream &&
                                    agentResult?.success &&
                                    agentResult?.finalCode)) && (
                                  <Button
                                    size='sm'
                                    onClick={handleAcceptAgentResultClick}
                                    className='h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 cursor-pointer'
                                  >
                                    Apply
                                  </Button>
                                )}
                              {onDismissAgentResult && (
                                <Button
                                  variant='outline'
                                  size='sm'
                                  onClick={handleDismissAgentResultClick}
                                  className='h-7 px-2 text-xs cursor-pointer'
                                >
                                  Dismiss
                                </Button>
                              )}
                            </div>
                          </div>

                          {agentStream?.message && (
                            <p className='text-xs text-muted-foreground whitespace-pre-wrap'>
                              {agentStream.message}
                            </p>
                          )}

                          {agentResult?.message && !agentStream && (
                            <p className='text-xs text-muted-foreground'>
                              {agentResult.message}
                            </p>
                          )}

                          {(agentStream?.finalCode &&
                            agentStream.finalCode.length > 0) ||
                          agentResult?.finalCode ? (
                            <pre className='text-xs bg-background/50 p-2 rounded border overflow-auto max-h-32'>
                              {agentStream?.finalCode || agentResult?.finalCode}
                            </pre>
                          ) : null}

                          {activitySteps.length > 0 && (
                            <details
                              className='text-xs'
                              open={stepsOpen}
                              onToggle={(e) =>
                                setStepsOpen(
                                  (e.target as HTMLDetailsElement).open
                                )
                              }
                            >
                              <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
                                View Activity ({activitySteps.length})
                              </summary>
                              <div className='mt-2 space-y-1'>
                                {activitySteps.map((step, index) => {
                                  const baseClasses =
                                    'p-2 bg-background/30 rounded border text-xs transition-colors';
                                  const failureClasses =
                                    'border-destructive/60 bg-destructive/10 text-destructive';
                                  const successClasses =
                                    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-200';
                                  const className =
                                    step.type === 'tool-result' &&
                                    step.validated === false
                                      ? `${baseClasses} ${failureClasses}`
                                      : step.type === 'tool-result' &&
                                        step.validated === true
                                      ? `${baseClasses} ${successClasses}`
                                      : baseClasses;

                                  if (step.type === 'tool-call') {
                                    return (
                                      <div key={index} className={className}>
                                        <div className='font-semibold'>
                                          Tool Called
                                        </div>
                                        <div className='text-muted-foreground'>
                                          {step.toolName}
                                        </div>
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
                                          <span className='font-semibold'>
                                            Tool Result
                                          </span>
                                          <span
                                            className={`text-[11px] font-medium ${labelTone}`}
                                          >
                                            {label}
                                          </span>
                                        </div>
                                        <div className='text-muted-foreground'>
                                          {step.toolName}
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (step.type === 'summary') {
                                    return (
                                      <div key={index} className={className}>
                                        <div className='font-semibold'>
                                          Summary
                                        </div>
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
                          )}

                          {agentStream?.usage && (
                            <div className='pt-2 mt-2 border-t text-[10px] text-muted-foreground'>
                              Usage — input:{' '}
                              {agentStream.usage.inputTokens ?? '-'}, output:{' '}
                              {agentStream.usage.outputTokens ?? '-'}, total:{' '}
                              {agentStream.usage.totalTokens ?? '-'}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </div>
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
