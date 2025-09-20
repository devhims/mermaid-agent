'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useTheme } from 'next-themes';
import { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ThemeToggle } from '@/components/theme-toggle';
import { CodeEditor } from '@/components/code-editor';
import { DiagramPreview } from '@/components/diagram-preview';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Badge } from '@/components/ui/badge';
import { useDebounced } from '@/hooks/useDebounced';
import {
  sanitizeMermaid,
  renderWithFallback,
  MERMAID_BASE_CONFIG,
  getMermaidConfig,
  getDefaultThemeForMode,
  type MermaidTheme,
} from '@/lib/mermaid-utils';
import { exportSvgAsPng } from '@/lib/canvas-utils';
import { importTextFile, exportTextFile } from '@/lib/file-utils';

type AgentUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
};

type AgentStatus = {
  label: string;
  detail?: string;
  tone: 'progress' | 'success' | 'error';
  toolName?: string;
};

type ToolCallStreamEvent = Record<string, unknown> & {
  type: 'tool-call';
  toolName?: string;
  args?: unknown;
  input?: unknown;
};

type ToolResultStreamEvent = Record<string, unknown> & {
  type: 'tool-result';
  toolName?: string;
  result?: unknown;
  output?: unknown;
};

type TextDeltaStreamEvent = Record<string, unknown> & {
  type: 'text-delta';
  accumulatedText?: unknown;
};

type FinishStreamEvent = Record<string, unknown> & {
  type: 'finish';
  usage?: unknown;
  totalUsage?: unknown;
  finishReason?: unknown;
};

type ErrorStreamEvent = Record<string, unknown> & {
  type: 'error';
  error?: unknown;
};

type GenericStreamEvent = Record<string, unknown> & {
  type: string;
};

type StreamingEvent =
  | ToolCallStreamEvent
  | ToolResultStreamEvent
  | TextDeltaStreamEvent
  | FinishStreamEvent
  | ErrorStreamEvent
  | GenericStreamEvent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type AgentStreamState = {
  steps: { action: string; details: string }[];
  message?: string;
  finalCode?: string;
  validated?: boolean;
  usage?: AgentUsage;
  status?: AgentStatus;
};

type AgentResultState = {
  success: boolean;
  message: string;
  finalCode?: string;
  stepsUsed?: number;
  toolCallCount?: number;
  steps?: { action: string; details: string }[];
};

const DEFAULT_CODE = `%% Mermaid Viewer — sample
graph TD
  A[Start] --> B{Condition?}
  B -- Yes --> C[Do thing]
  B -- No  --> D[Skip]
  C --> E[Finish]
  D --> E
`;

const normalizeExplanationValue = (
  value: unknown
): string | string[] | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  return undefined;
};

const explanationToDisplay = (
  value: string | string[] | undefined
): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value.map((line) => `• ${line}`).join('\n');
  }
  return undefined;
};

export default function Home() {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<AgentResultState | null>(null);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [hideAgentPanel, setHideAgentPanel] = useState(false);
  const { resolvedTheme } = useTheme();
  const [selectedMermaidTheme, setSelectedMermaidTheme] =
    useState<MermaidTheme>('default');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomPanRef = useRef<ReactZoomPanPinchRef | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number; has: boolean }>({
    x: 0,
    y: 0,
    has: false,
  });
  const runIdCounterRef = useRef(0);
  const activeRunIdRef = useRef<number | null>(null);

  const debouncedCode = useDebounced(code, 100);

  // Custom streaming implementation using JSON mode API
  const [agentStreamingState, setAgentStreamingState] = useState<{
    isLoading: boolean;
    isStreaming: boolean;
    abortController: AbortController | null;
    runId: number | null;
  }>({
    isLoading: false,
    isStreaming: false,
    abortController: null,
    runId: null,
  });

  const [agentStream, setAgentStream] = useState<AgentStreamState | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  const agentLoading = agentStreamingState.isLoading;
  const isStreaming = agentStreamingState.isStreaming;

  const stopAgentStreaming = () => {
    if (agentStreamingState.abortController) {
      agentStreamingState.abortController.abort();
    }

    activeRunIdRef.current = null;

    const stoppedStatus: AgentStatus = {
      label: 'Agent stopped',
      detail: 'Request cancelled',
      tone: 'error',
    };

    setAgentStreamingState((prev) => ({
      ...prev,
      isLoading: false,
      isStreaming: false,
      abortController: null,
      runId: null,
    }));

    setAgentStatus(stoppedStatus);
    setAgentStream((prev) => {
      const base = prev ?? { steps: [] };
      return {
        ...base,
        status: stoppedStatus,
      };
    });
  };

  // Clear error state when code changes to ensure diagram updates
  useEffect(() => {
    setError(null);
  }, [code]);

  useEffect(() => {
    mermaid.initialize({
      ...MERMAID_BASE_CONFIG,
      theme: 'default', // Will be overridden per render based on UI theme
    });
  }, []);

  useEffect(() => {
    setSelectedMermaidTheme(
      getDefaultThemeForMode(
        resolvedTheme as 'dark' | 'light' | 'system' | undefined
      )
    );
  }, [resolvedTheme]);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    function onMove(e: MouseEvent) {
      lastPointerRef.current = { x: e.clientX, y: e.clientY, has: true };
    }
    if (el) el.addEventListener('mousemove', onMove, { passive: true });

    async function render() {
      // Wait for the preview container to mount (first load race)
      if (!containerRef.current) {
        for (let i = 0; i < 10 && !containerRef.current; i++) {
          // wait up to ~10 frames (~160ms) for mount

          await new Promise((resolve) =>
            requestAnimationFrame(() => resolve(undefined))
          );
        }
        if (!containerRef.current) return; // still not ready
      }

      setIsRendering(true);

      // Clear container content to prepare for new render
      containerRef.current.innerHTML = '';

      try {
        // Re-initialize Mermaid with selected theme and consistent spacing
        await mermaid.initialize(getMermaidConfig(selectedMermaidTheme));

        // Ensure fonts are loaded so Mermaid measures text correctly
        const fonts = (
          document as Document & { fonts?: { ready?: Promise<unknown> } }
        ).fonts;
        if (fonts?.ready) {
          try {
            await fonts.ready;
          } catch {}
        }

        const prepared = sanitizeMermaid(debouncedCode);
        const { svg } = await renderWithFallback(prepared);

        if (cancelled) return;

        // First insert
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }

        // Immediately perform a second render on the next frame to
        // normalize layout with finalized CSS/metrics.
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(undefined))
        );
        if (!cancelled) {
          const { svg: svg2 } = await renderWithFallback(prepared);
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg2;
          }
        }

        // Clear any previous error on successful render
        setError(null);
        setIsRendering(false);
      } catch (e: unknown) {
        if (cancelled) return;

        setIsRendering(false);
        const msg =
          e instanceof Error ? e.message : 'Failed to render diagram.';

        // Provide a friendlier hint for a common error
        const hint = msg.includes('No diagram type detected')
          ? "Tip: Ensure your code starts with a diagram type, e.g., 'graph TD', 'flowchart LR', 'sequenceDiagram', etc. If you pasted Markdown fences, they are removed automatically."
          : undefined;

        setError(hint ? `${msg}\n${hint}` : msg);

        // Clear container content on error to prevent stale content
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
      }
    }
    render();
    return () => {
      cancelled = true;
      if (el) el.removeEventListener('mousemove', onMove as EventListener);
    };
  }, [debouncedCode, selectedMermaidTheme, resolvedTheme]);

  function zoomIn() {
    if (zoomPanRef.current) {
      // Use a smaller step with animation for smoother zoom
      zoomPanRef.current.zoomIn(0.3, 260, 'easeOut');
    }
  }
  function zoomOut() {
    if (zoomPanRef.current) {
      // Match zoom-in smoothness for consistency
      zoomPanRef.current.zoomOut(0.3, 260, 'easeOut');
    }
  }
  function resetView() {
    if (zoomPanRef.current) {
      zoomPanRef.current.resetTransform();
    }
  }

  async function handleFixWithAgent() {
    if (agentStreamingState.isStreaming) return;

    let runId: number | null = null;
    let steps: { action: string; details: string }[] = [];
    let remoteToolCallCount: number | undefined;
    let remoteStepCount: number | undefined;
    let message = '';
    let finalCode: string | undefined;
    let validated: boolean | undefined;
    let usage: AgentUsage | undefined;
    let status: AgentStatus | undefined;
    let explanation: string | string[] | undefined;
    let candidateFromTool: string | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let completed = false;

    const applyExplanation = (value: unknown) => {
      const normalized = normalizeExplanationValue(value);
      if (!normalized) return;
      explanation = normalized;
      const display = explanationToDisplay(normalized);
      if (display) {
        message = display;
      }
    };

    try {
      setAgentResult(null);
      setHideAgentPanel(false);
      setAgentStream(null);

      const parserError = error ?? 'Unknown validation error';
      const abortController = new AbortController();

      runId = runIdCounterRef.current + 1;
      runIdCounterRef.current = runId;
      activeRunIdRef.current = runId;

      status = {
        label: 'Analyzing diagram…',
        detail: parserError,
        tone: 'progress',
      };

      setAgentStreamingState({
        isLoading: true,
        isStreaming: true,
        abortController,
        runId,
      });

      const emitStreamUpdate = () => {
        if (runId === null) return;
        if (activeRunIdRef.current !== runId) return;
        setAgentStream({
          steps,
          message,
          finalCode,
          validated,
          usage,
          status,
        });
        if (status) {
          setAgentStatus(status);
        }
      };

      emitStreamUpdate();

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          error: parserError,
          step: 1,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      reader = response.body?.getReader() ?? null;
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const isStale = () => runId === null || activeRunIdRef.current !== runId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isStale()) return;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          if (!raw.trim()) continue;

          let parsedEvent: unknown;
          try {
            parsedEvent = JSON.parse(raw);
          } catch (parseError) {
            console.error(
              'Error parsing streaming event:',
              parseError,
              'Line:',
              raw
            );
            continue;
          }

          if (!isRecord(parsedEvent)) {
            console.warn('Skipping non-object streaming payload:', parsedEvent);
            continue;
          }

          const event = parsedEvent as StreamingEvent;

          if (isStale()) return;

          if (event.type === 'tool-call') {
            const toolCallEvent = event as ToolCallStreamEvent;
            const toolName =
              typeof toolCallEvent.toolName === 'string'
                ? toolCallEvent.toolName
                : 'Unknown tool';

            const detail = JSON.stringify(
              toolCallEvent.args ?? toolCallEvent.input ?? {},
              null,
              2
            );
            steps = [
              ...steps,
              {
                action: `Tool call — ${toolName}`,
                details: detail,
              },
            ];
            status = {
              label: `Running ${toolName}`,
              detail: 'Validating proposed fix…',
              tone: 'progress',
              toolName,
            };
            emitStreamUpdate();
          } else if (event.type === 'tool-result') {
            const toolResultEvent = event as ToolResultStreamEvent;
            const toolName =
              typeof toolResultEvent.toolName === 'string'
                ? toolResultEvent.toolName
                : 'Unknown tool';

            const resultData =
              toolResultEvent.result ?? toolResultEvent.output ?? {};
            const resultRecord = isRecord(resultData) ? resultData : {};
            const detail = JSON.stringify(resultRecord, null, 2);
            steps = [
              ...steps,
              {
                action: `Tool result — ${toolName}`,
                details: detail,
              },
            ];

            const fixedCode = resultRecord['fixedCode'];
            if (typeof fixedCode === 'string') {
              candidateFromTool = fixedCode;
            }

            const validatedValue = resultRecord['validated'];
            if (typeof validatedValue === 'boolean') {
              validated = validatedValue;
            }

            const validationErrorValue = resultRecord['validationError'];
            const validationError =
              typeof validationErrorValue === 'string'
                ? validationErrorValue
                : undefined;

            const isValidated =
              typeof validatedValue === 'boolean' ? validatedValue : false;

            status = isValidated
              ? {
                  label: 'Validation passed',
                  detail: `${toolName} confirmed the fix.`,
                  tone: 'progress',
                  toolName,
                }
              : {
                  label: 'Validation failed',
                  detail: validationError ?? `${toolName} reported an issue.`,
                  tone: 'error',
                  toolName,
                };
            emitStreamUpdate();
          } else if (event.type === 'structured-output') {
            const structuredEvent = event as GenericStreamEvent & {
              output?: unknown;
            };
            if (structuredEvent.output && isRecord(structuredEvent.output)) {
              const structuredOutput = structuredEvent.output;
              const fixed = structuredOutput['fixedCode'];
              const explanationValue = structuredOutput['explanation'];

              if (typeof fixed === 'string' && fixed.length > 0) {
                candidateFromTool = fixed;
                finalCode = fixed;
              }

              applyExplanation(explanationValue);

              status = {
                label: 'Synthesizing fix…',
                detail: explanationToDisplay(explanation),
                tone: 'progress',
              };
              emitStreamUpdate();
            }
          } else if (event.type === 'text-delta') {
            if (typeof event.accumulatedText === 'string') {
              try {
                const parsed = JSON.parse(event.accumulatedText);
                if (isRecord(parsed)) {
                  const parsedFixed = parsed['fixedCode'];
                  if (
                    typeof parsedFixed === 'string' &&
                    !agentStream?.finalCode
                  ) {
                    candidateFromTool = parsedFixed;
                    finalCode = parsedFixed;
                  }
                  if ('explanation' in parsed) {
                    applyExplanation(parsed['explanation']);
                  }
                }
              } catch {
                if (!message) {
                  message = 'Synthesizing fix…';
                }
              }
            }

            status = {
              label: 'Drafting fix…',
              detail: explanationToDisplay(explanation),
              tone: 'progress',
            };
            emitStreamUpdate();
          } else if (event.type === 'finish') {
            const finishEvent = event as FinishStreamEvent;
            const usageCandidate = finishEvent.usage ?? finishEvent.totalUsage;
            usage = isRecord(usageCandidate)
              ? (usageCandidate as AgentUsage)
              : usage;
            status = {
              label: 'Finalizing…',
              detail:
                typeof finishEvent.finishReason === 'string'
                  ? `Finish reason: ${finishEvent.finishReason}`
                  : undefined,
              tone: validated === false ? 'error' : 'progress',
            };
            emitStreamUpdate();
          } else if (event.type === 'error') {
            const errorEvent = event as ErrorStreamEvent;
            const detail =
              typeof errorEvent.error === 'string'
                ? errorEvent.error
                : 'Agent reported an error.';
            message = detail;
            status = {
              label: 'Agent error',
              detail,
              tone: 'error',
            };
            emitStreamUpdate();
          } else if (typeof event.success === 'boolean') {
            const successEvent = event as GenericStreamEvent & {
              success: boolean;
              fixedCode?: unknown;
              isComplete?: unknown;
              validated?: unknown;
              usage?: unknown;
              explanation?: unknown;
              message?: unknown;
              toolCallCount?: unknown;
            };

            completed = true;

            const fixedCodeValue = successEvent.fixedCode;
            finalCode =
              typeof fixedCodeValue === 'string'
                ? fixedCodeValue
                : candidateFromTool;

            const isComplete =
              typeof successEvent.isComplete === 'boolean'
                ? successEvent.isComplete
                : false;

            const validatedValue = successEvent.validated;
            validated =
              typeof validatedValue === 'boolean'
                ? validatedValue
                : typeof validated === 'boolean'
                ? validated
                : isComplete;

            usage = isRecord(successEvent.usage)
              ? (successEvent.usage as AgentUsage)
              : usage;

            if (typeof successEvent.toolCallCount === 'number') {
              remoteToolCallCount = successEvent.toolCallCount;
            }

            const rawStepCount = successEvent['stepCount'];
            const rawStepsCount = successEvent['stepsCount'];
            const stepCountValue =
              typeof rawStepCount === 'number'
                ? rawStepCount
                : typeof rawStepsCount === 'number'
                  ? rawStepsCount
                  : undefined;

            if (stepCountValue !== undefined) {
              remoteStepCount = stepCountValue;
            }

            const explanationValue = successEvent.explanation;
            const normalizedSuccessExplanation =
              normalizeExplanationValue(explanationValue);
            if (normalizedSuccessExplanation) {
              explanation = normalizedSuccessExplanation;
            }
            const messageValue = successEvent.message;
            const finalMessage =
              explanationToDisplay(explanation) ??
              (typeof messageValue === 'string' ? messageValue : undefined) ??
              (message || 'Fix completed');

            message = finalMessage;
            if (!explanation && finalMessage) {
              explanation = finalMessage;
            }

            status = successEvent.success
              ? {
                  label: validated ? 'Diagram fixed' : 'Agent completed',
                  detail:
                    explanationToDisplay(explanation) ?? finalMessage,
                  tone: validated ? 'success' : 'progress',
                }
              : {
                  label: 'Agent failed',
                  detail: finalMessage,
                  tone: 'error',
                };

            const summaryStep = {
              action: 'Summary',
              details: finalMessage,
            };
            steps = [...steps, summaryStep];

            setAgentResult({
              success: successEvent.success,
              message: finalMessage,
              finalCode,
              stepsUsed: remoteStepCount,
              toolCallCount: remoteToolCallCount,
              steps,
            });

            emitStreamUpdate();
            setAgentStreamingState((prev) => ({
              ...prev,
              isLoading: false,
              isStreaming: false,
              abortController: null,
              runId: null,
            }));
            activeRunIdRef.current = null;
            return;
          }
        }
      }

      if (isStale()) return;
      if (!completed) {
        const fallbackMessage =
          explanationToDisplay(explanation) ||
          message ||
          'Agent finished without providing a structured summary. Review the transcript above for details.';

        finalCode = finalCode ?? candidateFromTool;

        status = {
          label: finalCode ? 'Diagram fixed (fallback)' : 'Agent completed',
          detail: fallbackMessage,
          tone: finalCode ? 'progress' : 'error',
        };

        const summaryStep = {
          action: 'Summary',
          details: fallbackMessage,
        };
        steps = [...steps, summaryStep];

        setAgentResult({
          success: Boolean(finalCode),
          message: fallbackMessage,
          finalCode,
          stepsUsed: remoteStepCount,
          toolCallCount: remoteToolCallCount,
          steps,
        });

        setAgentStream({
          steps,
          message: fallbackMessage,
          finalCode,
          validated,
          usage,
          status,
        });

        setAgentStreamingState((prev) => ({
          ...prev,
          isLoading: false,
          isStreaming: false,
          abortController: null,
          runId: null,
        }));
        activeRunIdRef.current = null;
        setAgentStatus(status);
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }

      const msg = e instanceof Error ? e.message : 'Agent error';
      status = {
        label: 'Agent error',
        detail: msg,
        tone: 'error',
      };
      message = msg;
      setAgentStatus(status);
      setAgentStream({
        steps,
        message,
        finalCode,
        validated,
        usage,
        status,
      });
      setAgentResult({
        success: false,
        message: msg,
        toolCallCount: remoteToolCallCount,
        stepsUsed: remoteStepCount,
        steps,
      });
      setAgentStreamingState((prev) => ({
        ...prev,
        isLoading: false,
        isStreaming: false,
        abortController: null,
        runId: null,
      }));
      activeRunIdRef.current = null;
    } finally {
      if (reader) {
        try {
          reader.releaseLock();
        } catch {}
      }
    }
  }

  function acceptAgentResult() {
    const final = agentResult?.finalCode || agentStream?.finalCode;
    if (!final) return;
    setCode(final);
    setAgentResult(null);
    setHideAgentPanel(true);
  }

  function getSvgElement(): SVGSVGElement | null {
    const svg = containerRef.current?.querySelector('svg');
    return (svg as SVGSVGElement) || null;
  }

  function downloadPng(bg: 'light' | 'dark' | 'transparent') {
    const svg = getSvgElement();
    if (!svg) return;
    exportSvgAsPng(svg, bg);
  }

  function onImportFile(file: File) {
    importTextFile(file, setCode);
  }
  function exportMmd() {
    exportTextFile(code, 'diagram.mmd');
  }

  return (
    <div className='h-screen bg-background text-foreground flex flex-col'>
      {/* Header */}
      <header className='flex items-center justify-between px-4 py-4 border-b bg-card/50 backdrop-blur-sm'>
        <div className='flex items-center gap-4'>
          <h1 className='text-xl font-bold tracking-tight'>Mermaid Agent</h1>
          <Badge variant='outline' className='text-xs px-2 py-1 rounded-md'>
            AI Powered Viewer
          </Badge>
        </div>

        <ThemeToggle />
      </header>

      {/* Main Content */}
      <div className='flex-1 overflow-hidden'>
        <ResizablePanelGroup direction='horizontal' className='h-full'>
          {/* Code Editor Panel */}
          <ResizablePanel
            defaultSize={editorCollapsed ? 0 : 35}
            minSize={0}
            maxSize={50}
            className='min-w-0'
            collapsible
            collapsedSize={0}
          >
            <div className='h-full border-r bg-card/30'>
              <div className='h-full p-4'>
                <CodeEditor
                  code={code}
                  onCodeChange={setCode}
                  onReset={() => setCode(DEFAULT_CODE)}
                  onImport={onImportFile}
                  agentResult={agentResult}
                  agentStream={!hideAgentPanel ? agentStream : null}
                  onAcceptAgentResult={acceptAgentResult}
                  onDismissAgentResult={() => {
                    setAgentResult(null);
                    setHideAgentPanel(true);
                  }}
                  onStopAgent={stopAgentStreaming}
                  agentLoading={agentLoading}
                  agentStreaming={isStreaming}
                  onFixWithAgent={handleFixWithAgent}
                  agentStatus={agentStatus}
                  diagramError={error}
                  isCollapsed={editorCollapsed}
                  onToggleCollapse={(open) => setEditorCollapsed(!open)}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Preview Panel */}
          <ResizablePanel defaultSize={editorCollapsed ? 100 : 70} minSize={50}>
            <DiagramPreview
              error={error}
              containerRef={containerRef}
              isRendering={isRendering}
              onDownloadLight={() => downloadPng('light')}
              onDownloadDark={() => downloadPng('dark')}
              onDownloadTransparent={() => downloadPng('transparent')}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetView={resetView}
              zoomPanRef={zoomPanRef}
              selectedTheme={selectedMermaidTheme}
              onThemeChange={setSelectedMermaidTheme}
              onExportCode={exportMmd}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Footer */}
      <footer className='px-6 py-3 border-t bg-card/30 backdrop-blur-sm'>
        <div className='flex items-center justify-between text-xs text-muted-foreground'>
          <span>Built with Next.js, Mermaid, and GPT-4o</span>
          <div className='flex items-center gap-4'>
            <span>v1.0.0</span>
            <a
              href='https://github.com/mermaid-js/mermaid'
              target='_blank'
              rel='noopener noreferrer'
              className='hover:text-foreground transition-colors'
            >
              Powered by Mermaid
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
