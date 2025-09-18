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
  function fitToView() {
    if (zoomPanRef.current) {
      const svg = getSvgElement();
      const container = containerRef.current;
      if (!svg || !container) return;
      const bbox = svg.getBBox();
      const pad = 16;
      const cw = container.clientWidth - pad * 2;
      const ch = container.clientHeight - pad * 2;
      const scale = Math.max(0.1, Math.min(cw / bbox.width, ch / bbox.height));
      zoomPanRef.current.setTransform(
        pad - bbox.x * scale,
        pad - bbox.y * scale,
        scale
      );
    }
  }

  async function handleFixWithAgent() {
    if (agentStreamingState.isStreaming) return;

    let runId: number | null = null;
    let steps: { action: string; details: string }[] = [];
    let message = '';
    let finalCode: string | undefined;
    let validated: boolean | undefined;
    let usage: AgentUsage | undefined;
    let status: AgentStatus | undefined;
    let explanation: string | undefined;
    let candidateFromTool: string | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let completed = false;

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

          let event: any;
          try {
            event = JSON.parse(raw);
          } catch (parseError) {
            console.error(
              'Error parsing streaming event:',
              parseError,
              'Line:',
              raw
            );
            continue;
          }

          if (isStale()) return;

          if (event.type === 'tool-call') {
            const detail = JSON.stringify(
              event.args ?? event.input ?? {},
              null,
              2
            );
            steps = [
              ...steps,
              {
                action: `Tool call — ${event.toolName}`,
                details: detail,
              },
            ];
            status = {
              label: `Running ${event.toolName}`,
              detail: 'Validating proposed fix…',
              tone: 'progress',
              toolName: event.toolName,
            };
            emitStreamUpdate();
          } else if (event.type === 'tool-result') {
            const result = event.result ?? event.output ?? {};
            const detail = JSON.stringify(result, null, 2);
            steps = [
              ...steps,
              {
                action: `Tool result — ${event.toolName}`,
                details: detail,
              },
            ];

            if (typeof result.fixedCode === 'string') {
              candidateFromTool = result.fixedCode;
            }
            if (typeof result.validated === 'boolean') {
              validated = result.validated;
            }

            const validationError = result.validationError as
              | string
              | undefined;
            status = result.validated
              ? {
                  label: 'Validation passed',
                  detail: `${event.toolName} confirmed the fix.`,
                  tone: 'success',
                  toolName: event.toolName,
                }
              : {
                  label: 'Validation failed',
                  detail:
                    validationError ?? `${event.toolName} reported an issue.`,
                  tone: 'error',
                  toolName: event.toolName,
                };
            emitStreamUpdate();
          } else if (event.type === 'text-delta') {
            if (typeof event.accumulatedText === 'string') {
              try {
                const parsed = JSON.parse(event.accumulatedText);
                if (typeof parsed.fixedCode === 'string') {
                  candidateFromTool = parsed.fixedCode;
                }
                if (typeof parsed.explanation === 'string') {
                  explanation = parsed.explanation;
                  message = parsed.explanation;
                }
              } catch {
                if (!message) {
                  message = 'Synthesizing fix…';
                }
              }
            }

            status = {
              label: 'Drafting fix…',
              detail: explanation,
              tone: 'progress',
            };
            emitStreamUpdate();
          } else if (event.type === 'finish') {
            usage = (event.usage ?? event.totalUsage) as AgentUsage | undefined;
            status = {
              label: 'Finalizing…',
              detail: event.finishReason
                ? `Finish reason: ${event.finishReason}`
                : undefined,
              tone: validated === false ? 'error' : 'progress',
            };
            emitStreamUpdate();
          } else if (event.type === 'error') {
            const detail =
              typeof event.error === 'string'
                ? event.error
                : 'Agent reported an error.';
            message = detail;
            status = {
              label: 'Agent error',
              detail,
              tone: 'error',
            };
            emitStreamUpdate();
          } else if (typeof event.success === 'boolean') {
            completed = true;

            finalCode = event.fixedCode ?? candidateFromTool;
            const isComplete = event.isComplete ?? false;
            validated =
              event.validated ??
              (typeof validated === 'boolean' ? validated : isComplete);
            usage = event.usage ?? usage;

            const finalMessage =
              (event.explanation as string | undefined) ??
              (event.message as string | undefined) ??
              explanation ??
              (message || 'Fix completed');

            message = finalMessage;
            explanation = finalMessage;

            status = event.success
              ? {
                  label: validated ? 'Diagram fixed' : 'Agent completed',
                  detail: finalMessage,
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
              success: Boolean(event.success),
              message: finalMessage,
              finalCode,
              stepsUsed: steps.length,
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
        throw new Error('Streaming ended before final result was received');
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
        stepsUsed: steps.length,
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
                  onExport={exportMmd}
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
                  onToggleCollapse={() => setEditorCollapsed(!editorCollapsed)}
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
              onFitToView={fitToView}
              zoomPanRef={zoomPanRef}
              selectedTheme={selectedMermaidTheme}
              onThemeChange={setSelectedMermaidTheme}
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
