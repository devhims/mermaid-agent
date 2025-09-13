'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import panzoom from 'panzoom';
import { ThemeToggle } from '@/components/theme-toggle';
import { CodeEditor } from '@/components/code-editor';
import { DiagramPreview } from '@/components/diagram-preview';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';

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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{
    fixedCode: string;
    rationale?: string;
    changes?: string[];
  } | null>(null);
  const [editorCollapsed, setEditorCollapsed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panzoomRef = useRef<ReturnType<typeof panzoom> | null>(null);

  const debouncedCode = useDebounced(code, 250);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default', // Use default theme, let next-themes handle the dark mode
      securityLevel: 'loose',
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!containerRef.current) return;
      setError(null);
      containerRef.current.innerHTML = '';
      try {
        const prepared = sanitizeMermaid(debouncedCode);
        const { svg } = await renderWithFallback(prepared);
        if (cancelled) return;
        containerRef.current.innerHTML = svg;
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) {
          // Dispose any previous pan/zoom instance
          if (panzoomRef.current) {
            panzoomRef.current.dispose();
            panzoomRef.current = null;
          }
          const instance = panzoom(svgEl as SVGSVGElement, {
            maxZoom: 10,
            minZoom: 0.1,
            bounds: false,
            zoomDoubleClickSpeed: 1,
          });
          panzoomRef.current = instance;
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : 'Failed to render diagram.';
        // Provide a friendlier hint for a common error
        const hint = msg.includes('No diagram type detected')
          ? "Tip: Ensure your code starts with a diagram type, e.g., 'graph TD', 'flowchart LR', 'sequenceDiagram', etc. If you pasted Markdown fences, they are removed automatically."
          : undefined;
        setError(hint ? `${msg}\n${hint}` : msg);
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [debouncedCode]);

  async function handleFixWithAI() {
    try {
      setAiLoading(true);
      setAiSuggestion(null);
      const res = await fetch('/api/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'AI fix failed');
      }
      const data = (await res.json()) as {
        fixedCode: string;
        rationale?: string;
        changes?: string[];
      };
      setAiSuggestion(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI error';
      setAiSuggestion({ fixedCode: code, rationale: msg });
    } finally {
      setAiLoading(false);
    }
  }

  function acceptAISuggestion() {
    if (!aiSuggestion) return;
    setCode(aiSuggestion.fixedCode);
    setAiSuggestion(null);
  }

  function getSvgElement(): SVGSVGElement | null {
    const svg = containerRef.current?.querySelector('svg');
    return (svg as SVGSVGElement) || null;
  }

  function parseSvgSize(svg: SVGSVGElement): { width: number; height: number } {
    const wAttr = svg.getAttribute('width');
    const hAttr = svg.getAttribute('height');
    if (wAttr && hAttr) {
      const w = parseFloat(wAttr);
      const h = parseFloat(hAttr);
      if (!Number.isNaN(w) && !Number.isNaN(h)) return { width: w, height: h };
    }
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      if (parts.length === 4) {
        return { width: parts[2], height: parts[3] };
      }
    }
    // Fallback
    return { width: 800, height: 600 };
  }

  function downloadPng(bg: 'light' | 'dark') {
    const svg = getSvgElement();
    if (!svg) return;

    // Clone the SVG so we can safely adjust sizing without affecting the preview
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    // Remove any panzoom-applied transforms/styles on the root element
    cloned.removeAttribute('style');

    // Compute tight bounding box of the content and add a small padding
    const bbox = svg.getBBox();
    const padding = 16; // px
    const vbX = bbox.x - padding;
    const vbY = bbox.y - padding;
    const vbW = Math.max(1, bbox.width + padding * 2);
    const vbH = Math.max(1, bbox.height + padding * 2);

    // Force explicit viewBox/width/height so rasterization has exact dimensions
    cloned.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    cloned.setAttribute('width', String(vbW));
    cloned.setAttribute('height', String(vbH));
    if (!cloned.getAttribute('xmlns')) {
      cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(cloned);

    // Convert SVG to data URL to avoid CORS issues
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      source
    )}`;

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      // Use the computed export dimensions for proper scaling
      const exportW = vbW;
      const exportH = vbH;
      const scale = 2; // Higher DPI for better quality

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(exportW * scale));
      canvas.height = Math.max(1, Math.round(exportH * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Enable high DPI rendering
      ctx.scale(scale, scale);

      // Fill background
      ctx.fillStyle = bg === 'dark' ? '#0b0f1a' : '#ffffff';
      ctx.fillRect(0, 0, exportW, exportH);

      // Draw image with exact, unclipped dimensions
      ctx.drawImage(img, 0, 0, exportW, exportH);

      // Convert to blob and download
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `mermaid-diagram-${bg}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
        'image/png',
        1.0
      );
    };
    img.onerror = () => {
      console.error('Failed to load SVG image');
    };
    img.src = svgDataUrl;
  }

  function zoomIn() {
    const inst = panzoomRef.current;
    const svg = getSvgElement();
    if (!inst || !svg) return;
    const rect = svg.getBoundingClientRect();
    inst.smoothZoom(rect.width / 2, rect.height / 2, 1.2);
  }
  function zoomOut() {
    const inst = panzoomRef.current;
    const svg = getSvgElement();
    if (!inst || !svg) return;
    const rect = svg.getBoundingClientRect();
    inst.smoothZoom(rect.width / 2, rect.height / 2, 0.8);
  }
  function resetView() {
    const inst = panzoomRef.current;
    if (!inst) return;
    inst.moveTo(0, 0);
    inst.zoomAbs(0, 0, 1);
  }
  function fitToView() {
    const inst = panzoomRef.current;
    const svg = getSvgElement();
    const container = containerRef.current;
    if (!inst || !svg || !container) return;
    const svgRect = svg.getBBox();
    const pad = 16;
    const cw = container.clientWidth - pad * 2;
    const ch = container.clientHeight - pad * 2;
    const scale = Math.max(
      0.1,
      Math.min(cw / svgRect.width, ch / svgRect.height)
    );
    inst.moveTo(pad - svgRect.x * scale, pad - svgRect.y * scale);
    inst.zoomAbs(0, 0, scale);
  }

  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCode(text);
    };
    reader.readAsText(file);
  }
  function exportMmd() {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.mmd';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className='h-screen bg-background text-foreground flex flex-col'>
      {/* Header */}
      <header className='flex items-center justify-between px-6 py-4 border-b bg-card/50 backdrop-blur-sm'>
        <div className='flex items-baseline gap-4'>
          <h1 className='text-xl font-bold tracking-tight'>Mermaid Viewer</h1>
          <div className='text-xs text-muted-foreground bg-muted px-2 py-1 rounded'>
            Free Mermaid Editor
          </div>
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
                  aiSuggestion={aiSuggestion}
                  onAcceptSuggestion={acceptAISuggestion}
                  onDismissSuggestion={() => setAiSuggestion(null)}
                  aiLoading={aiLoading}
                  onFixWithAI={handleFixWithAI}
                  isCollapsed={editorCollapsed}
                  onToggleCollapse={() => setEditorCollapsed(!editorCollapsed)}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Preview Panel */}
          <ResizablePanel defaultSize={editorCollapsed ? 100 : 70} minSize={50}>
            <div className='h-full'>
              <DiagramPreview
                error={error}
                containerRef={containerRef}
                onDownloadLight={() => downloadPng('light')}
                onDownloadDark={() => downloadPng('dark')}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onResetView={resetView}
                onFitToView={fitToView}
              />
            </div>
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

function useDebounced<T>(value: T, delay = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

function sanitizeMermaid(input: string): string {
  // Normalize newlines and trim overall
  let text = input
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .trim();
  // Extract fenced code if present
  const fence = /```(?:\s*mermaid)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) text = fence[1];
  // Remove zero-width and bidi control characters globally
  const INVISIBLES =
    /[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
  text = text.replace(INVISIBLES, '');
  // Trim each line's leading/trailing spaces
  text = text
    .split('\n')
    .map((l) => l.replace(/^\s+|\s+$/g, ''))
    .join('\n')
    .trim();
  return text;
}

async function renderWithFallback(code: string): Promise<{ svg: string }> {
  // Primary attempt
  try {
    await mermaid.parse(code);
    return await mermaid.render('mermaid-preview', code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/No diagram type detected/i.test(msg)) throw err;

    // Fallback 1: switch between flowchart <-> graph
    const firstLine = code.split(/\n/).find((l) => l.trim().length > 0) || '';
    const [kw, dir, ...rest] = firstLine.trim().split(/\s+/);
    const body = code.split(/\n/).slice(1).join('\n');
    if (/^flowchart$/i.test(kw) && dir) {
      const alt = `graph ${dir}\n${body}`.trim();
      try {
        await mermaid.parse(alt);
        return await mermaid.render('mermaid-preview', alt);
      } catch {}
    } else if (/^graph$/i.test(kw) && dir) {
      const alt = `flowchart ${dir}\n${body}`.trim();
      try {
        await mermaid.parse(alt);
        return await mermaid.render('mermaid-preview', alt);
      } catch {}
    }

    // Fallback 2: If no recognizable header, try prefixing flowchart TD
    if (
      !/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|gantt|erDiagram|journey|pie|mindmap|timeline)\b/i.test(
        firstLine
      )
    ) {
      const alt = `flowchart TD\n${code}`;
      try {
        await mermaid.parse(alt);
        return await mermaid.render('mermaid-preview', alt);
      } catch {}
    }

    throw err;
  }
}
