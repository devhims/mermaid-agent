'use client';

import { useState, useEffect, useRef } from 'react';
import { Code, Copy, RotateCcw, CheckCheck } from 'lucide-react';
import { LuImport } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { AgentStatusBadge } from '@/components/agent-status-badge';
import { AgentActivityDetails } from '@/components/agent-activity-details';
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

interface DiagramEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  onReset: () => void;
  onImport: (file: File) => void;
  agentStream?: {
    steps: AgentActivityStep[];
    message?: string;
    finalCode?: string;
    validated?: boolean;
    stepsUsed?: number;
    toolCallCount?: number;
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
  onStopAgent?: () => void;
  agentStreaming?: boolean;
  onFixWithAgent?: () => void;
  diagramError?: string | null;
  isCollapsed?: boolean;
  onToggleCollapse?: (open: boolean) => void;
}

export function DiagramEditor({
  code,
  onCodeChange,
  onReset,
  onImport,
  agentStream,
  onAcceptAgentResult,
  onStopAgent,
  agentStreaming,
  onFixWithAgent,
  diagramError,
  isCollapsed = false,
  onToggleCollapse,
}: DiagramEditorProps) {
  const [stepsOpen, setStepsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorPanelRef = useRef<ImperativePanelHandle | null>(null);
  const agentPanelRef = useRef<ImperativePanelHandle | null>(null);
  const [showAgentPanel, setShowAgentPanel] = useState(false);

  // Auto-minimize steps when streaming completes
  useEffect(() => {
    if (agentStreaming) setStepsOpen(true);
    else setStepsOpen(false);
  }, [agentStreaming]);

  // Auto-show activity panel when agent is streaming
  useEffect(() => {
    if (agentStreaming) {
      setShowAgentPanel(true);
    }
  }, [agentStreaming]);

  const handleOpenChange = (open: boolean) => {
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
    setShowAgentPanel(true);
    try {
      agentPanelRef.current?.expand();
      agentPanelRef.current?.resize(50);
    } catch {}
    onFixWithAgent?.();
  };

  const handleAcceptAgentResult = () => {
    onAcceptAgentResult?.();
    setShowAgentPanel(false);
  };

  const handleDismissAgentResult = () => {
    setShowAgentPanel(false);
  };

  const handleStopAgent = () => {
    onStopAgent?.();
    setShowAgentPanel(false);
  };

  const showFixButton = !!diagramError && !agentStreaming;
  const activitySteps = agentStream?.steps ?? [];

  // Compute step and tool call counts for display
  const stepCount = agentStream?.stepsUsed ?? 0;
  const toolCallCount = agentStream?.toolCallCount ?? 0;

  return (
    <Collapsible
      open={!isCollapsed}
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
                    disabled={agentStreaming}
                    className='h-8 px-2 text-xs shadow-sm cursor-pointer bg-emerald-600 hover:bg-emerald-700'
                  >
                    ✨ Auto Fix
                  </Button>
                )}
                {!showFixButton && (
                  <AgentStatusBadge status={agentStream?.status} />
                )}
              </div>
            </div>

            <Separator />

            {/* Resizable vertical split for Editor and Agent Result */}
            <div className='flex-1 min-h-0'>
              <ResizablePanelGroup
                key={showAgentPanel ? 'with-activity' : 'no-activity'}
                direction='vertical'
                className='min-h-[360px] h-full'
              >
                <ResizablePanel
                  ref={editorPanelRef}
                  defaultSize={showAgentPanel ? 50 : 100}
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

                {showAgentPanel && (
                  <>
                    <ResizableHandle withHandle className='my-2' />

                    <ResizablePanel
                      ref={agentPanelRef}
                      defaultSize={50}
                      minSize={10}
                      collapsible
                      collapsedSize={0}
                    >
                      {agentStream ? (
                        <div
                          className={`rounded-md border p-3 space-y-3 h-full overflow-auto ${
                            agentStream?.validated
                              ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
                              : 'border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20'
                          }`}
                        >
                          <div className='flex items-center justify-between'>
                            <div className='flex flex-col gap-1'>
                              <span
                                className={`text-sm font-medium ${
                                  agentStream?.validated
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
                              {stepCount > 0 || toolCallCount > 0 ? (
                                <span className='text-xs text-muted-foreground'>
                                  {[
                                    stepCount > 0 &&
                                      `${stepCount} ${
                                        stepCount === 1 ? 'step' : 'steps'
                                      }`,
                                    toolCallCount > 0 &&
                                      `${toolCallCount} ${
                                        toolCallCount === 1
                                          ? 'tool call'
                                          : 'tool calls'
                                      }`,
                                  ]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </span>
                              ) : null}
                            </div>
                            <div className='flex gap-2'>
                              {agentStreaming && (
                                <div className='flex gap-2 '>
                                  <Button
                                    variant='destructive'
                                    size='sm'
                                    onClick={handleStopAgent}
                                    disabled={!agentStreaming}
                                    className='h-7 px-2 text-xs cursor-pointer'
                                  >
                                    Stop
                                  </Button>
                                </div>
                              )}
                              {!agentStreaming &&
                                agentStream?.validated &&
                                agentStream?.finalCode && (
                                  <Button
                                    size='sm'
                                    onClick={handleAcceptAgentResult}
                                    className='h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 cursor-pointer'
                                  >
                                    Apply
                                  </Button>
                                )}
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={handleDismissAgentResult}
                                className='h-7 px-2 text-xs cursor-pointer'
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>

                          {agentStream?.message && (
                            <p className='text-xs text-muted-foreground whitespace-pre-wrap'>
                              {agentStream.message}
                            </p>
                          )}

                          {agentStream?.finalCode &&
                            agentStream.finalCode.length > 0 && (
                              <pre className='text-xs bg-background/50 p-2 rounded border overflow-auto max-h-32'>
                                {agentStream.finalCode}
                              </pre>
                            )}

                          {activitySteps.length > 0 && (
                            <AgentActivityDetails
                              steps={activitySteps}
                              isOpen={stepsOpen}
                              onToggle={setStepsOpen}
                            />
                          )}

                          {agentStream?.usage && (
                            <div className='pt-2 border-t text-[10px] text-muted-foreground'>
                              Input: {agentStream.usage.inputTokens ?? '-'} |
                              Output: {agentStream.usage.outputTokens ?? '-'} |
                              Total: {agentStream.usage.totalTokens ?? '-'}
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
      </div>
    </Collapsible>
  );
}
