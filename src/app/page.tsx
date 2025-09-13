"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import panzoom from "panzoom";

const DEFAULT_CODE = `%% Mermaid Viewer — sample
graph TD
  A[Start] --> B{Condition?}
  B -- Yes --> C[Do thing]
  B -- No  --> D[Skip]
  C --> E[Finish]
  D --> E
`;

type Theme = "default" | "dark";

export default function Home() {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<Theme>("default");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<
    | { fixedCode: string; rationale?: string; changes?: string[] }
    | null
  >(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panzoomRef = useRef<ReturnType<typeof panzoom> | null>(null);

  const debouncedCode = useDebounced(code, 250);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: previewTheme,
      securityLevel: "loose",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
    });
  }, [previewTheme]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!containerRef.current) return;
      setError(null);
      containerRef.current.innerHTML = "";
      try {
        const prepared = sanitizeMermaid(debouncedCode);
        const { svg } = await renderWithFallback(prepared);
        if (cancelled) return;
        containerRef.current.innerHTML = svg;
        const svgEl = containerRef.current.querySelector("svg");
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
        const msg = e instanceof Error ? e.message : "Failed to render diagram.";
        // Provide a friendlier hint for a common error
        const hint = msg.includes("No diagram type detected")
          ? "Tip: Ensure your code starts with a diagram type, e.g., 'graph TD', 'flowchart LR', 'sequenceDiagram', etc. If you pasted Markdown fences, they are removed automatically."
          : undefined;
        setError(hint ? `${msg}\n${hint}` : msg);
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [debouncedCode, previewTheme]);

  async function handleFixWithAI() {
    try {
      setAiLoading(true);
      setAiSuggestion(null);
      const res = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "AI fix failed");
      }
      const data = (await res.json()) as {
        fixedCode: string;
        rationale?: string;
        changes?: string[];
      };
      setAiSuggestion(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "AI error";
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
    const svg = containerRef.current?.querySelector("svg");
    return (svg as SVGSVGElement) || null;
  }

  function parseSvgSize(svg: SVGSVGElement): { width: number; height: number } {
    const wAttr = svg.getAttribute("width");
    const hAttr = svg.getAttribute("height");
    if (wAttr && hAttr) {
      const w = parseFloat(wAttr);
      const h = parseFloat(hAttr);
      if (!Number.isNaN(w) && !Number.isNaN(h)) return { width: w, height: h };
    }
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/\s+/).map(Number);
      if (parts.length === 4) {
        return { width: parts[2], height: parts[3] };
      }
    }
    // Fallback
    return { width: 800, height: 600 };
  }

  function downloadPng(bg: "light" | "dark") {
    const svg = getSvgElement();
    if (!svg) return;

    const { width, height } = parseSvgSize(svg);
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width);
      canvas.height = Math.ceil(height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = bg === "dark" ? "#0b0f1a" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `mermaid-diagram-${bg}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        },
        "image/png"
      );
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
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
    const scale = Math.max(0.1, Math.min(cw / svgRect.width, ch / svgRect.height));
    inst.moveTo(pad - svgRect.x * scale, pad - svgRect.y * scale);
    inst.zoomAbs(0, 0, scale);
  }

  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCode(text);
    };
    reader.readAsText(file);
  }
  function exportMmd() {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.mmd";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const bgGradient = useMemo(
    () =>
      previewTheme === "dark"
        ? "bg-[radial-gradient(1200px_circle_at_10%_10%,#0b1220_10%,#0a0a0a_60%)]"
        : "bg-[radial-gradient(1200px_circle_at_10%_10%,#f0f7ff_10%,#ffffff_60%)]",
    [previewTheme]
  );

  return (
    <div className={`min-h-screen ${bgGradient} text-[var(--foreground)]`}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Mermaid Viewer
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewTheme((t) => (t === "dark" ? "default" : "dark"))}
              className="rounded-md border border-black/10 dark:border-white/15 px-3 py-1.5 text-sm bg-white/60 dark:bg-white/5 backdrop-blur hover:bg-white/80 dark:hover:bg-white/10 transition"
            >
              Theme: {previewTheme === "dark" ? "Dark" : "Light"}
            </button>
            <button
              onClick={handleFixWithAI}
              disabled={aiLoading}
              className="rounded-md bg-gradient-to-r from-indigo-500 to-violet-500 text-white px-3 py-1.5 text-sm shadow hover:opacity-95 disabled:opacity-60"
            >
              {aiLoading ? "Fixing with AI…" : "Fix with AI"}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Editor */}
          <div className="rounded-xl border border-black/10 dark:border-white/15 bg-white/70 dark:bg-white/[0.03] backdrop-blur p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">Mermaid Code</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCode(DEFAULT_CODE)}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Reset sample
                </button>
                <label className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                  Import .mmd
                  <input
                    type="file"
                    accept=".mmd,.mermaid,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onImportFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={exportMmd}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Export .mmd
                </button>
              </div>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="w-full h-[360px] sm:h-[460px] resize-y rounded-lg bg-white dark:bg-[#0b0f1a] text-sm p-3 border border-black/10 dark:border-white/15 font-mono leading-6 shadow-inner"
              placeholder="Paste Mermaid code here…"
            />

            {aiSuggestion && (
              <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-50/70 dark:bg-emerald-900/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">AI Suggestion</div>
                  <div className="flex gap-2">
                    <button
                      onClick={acceptAISuggestion}
                      className="text-xs rounded bg-emerald-600 text-white px-2 py-1 hover:bg-emerald-700"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => setAiSuggestion(null)}
                      className="text-xs rounded border border-black/10 dark:border-white/20 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                {aiSuggestion.rationale && (
                  <p className="text-xs text-black/70 dark:text-white/70 mb-2">{aiSuggestion.rationale}</p>
                )}
                <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto p-2 rounded bg-white/60 dark:bg-white/5 border border-black/10 dark:border-white/10">{aiSuggestion.fixedCode}</pre>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-black/10 dark:border-white/15 bg-white/60 dark:bg-white/[0.03] backdrop-blur p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">Preview</span>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadPng("light")}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Download PNG (Light)
                </button>
                <button
                  onClick={() => downloadPng("dark")}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Download PNG (Dark)
                </button>
                <div className="w-px h-5 bg-black/10 dark:bg-white/15" />
                <button
                  onClick={zoomOut}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  −
                </button>
                <button
                  onClick={zoomIn}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  +
                </button>
                <button
                  onClick={resetView}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Reset
                </button>
                <button
                  onClick={fitToView}
                  className="text-xs rounded border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Fit
                </button>
              </div>
            </div>
            <div className="relative rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#0b0f1a] min-h-[360px] sm:min-h-[460px] overflow-hidden p-3">
              {error ? (
                <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
              ) : (
                <div ref={containerRef} className="h-full w-full overflow-auto [&_svg]:w-full [&_svg]:h-auto touch-pan-y" />
              )}
            </div>
          </div>
        </div>

        <footer className="mt-8 text-center text-xs text-black/50 dark:text-white/50">
          Built with Next.js, Mermaid, and GPT‑4o.
        </footer>
      </div>
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
  let text = input.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").trim();
  // Extract fenced code if present
  const fence = /```(?:\s*mermaid)?\s*([\s\S]*?)```/i.exec(text);
  if (fence && fence[1]) text = fence[1];
  // Remove zero-width and bidi control characters globally
  const INVISIBLES = /[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
  text = text.replace(INVISIBLES, "");
  // Trim each line's leading/trailing spaces
  text = text
    .split("\n")
    .map((l) => l.replace(/^\s+|\s+$/g, ""))
    .join("\n")
    .trim();
  return text;
}

async function renderWithFallback(code: string): Promise<{ svg: string }> {
  // Primary attempt
  try {
    await mermaid.parse(code);
    return await mermaid.render("mermaid-preview", code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/No diagram type detected/i.test(msg)) throw err;

    // Fallback 1: switch between flowchart <-> graph
    const firstLine = code.split(/\n/).find((l) => l.trim().length > 0) || "";
    const [kw, dir, ...rest] = firstLine.trim().split(/\s+/);
    const body = code.split(/\n/).slice(1).join("\n");
    if (/^flowchart$/i.test(kw) && dir) {
      const alt = `graph ${dir}\n${body}`.trim();
      try {
        await mermaid.parse(alt);
        return await mermaid.render("mermaid-preview", alt);
      } catch {}
    } else if (/^graph$/i.test(kw) && dir) {
      const alt = `flowchart ${dir}\n${body}`.trim();
      try {
        await mermaid.parse(alt);
        return await mermaid.render("mermaid-preview", alt);
      } catch {}
    }

    // Fallback 2: If no recognizable header, try prefixing flowchart TD
    if (!/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|gantt|erDiagram|journey|pie|mindmap|timeline)\b/i.test(firstLine)) {
      const alt = `flowchart TD\n${code}`;
      try {
        await mermaid.parse(alt);
        return await mermaid.render("mermaid-preview", alt);
      } catch {}
    }

    throw err;
  }
}
