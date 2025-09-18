import mermaid from 'mermaid';

/**
 * Sanitizes Mermaid diagram code by removing unwanted characters and formatting.
 * Handles fenced code blocks, invisible characters, and whitespace normalization.
 *
 * @param input - Raw Mermaid diagram code
 * @returns Cleaned and normalized diagram code
 */
export function sanitizeMermaid(input: string): string {
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

/**
 * Renders Mermaid diagram with automatic fallbacks for common syntax issues.
 * Attempts multiple rendering strategies if the primary attempt fails.
 *
 * @param code - Sanitized Mermaid diagram code
 * @returns Promise resolving to the rendered SVG
 */
export async function renderWithFallback(
  code: string
): Promise<{ svg: string }> {
  // Primary attempt
  try {
    await mermaid.parse(code);
    return await mermaid.render('mermaid-preview', code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/No diagram type detected/i.test(msg)) throw err;

    // Fallback 1: switch between flowchart <-> graph
    const firstLine = code.split(/\n/).find((l) => l.trim().length > 0) || '';
    const [kw, dir] = firstLine.trim().split(/\s+/);
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

/**
 * Default Mermaid configuration for consistent styling across the app.
 */
export const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose' as const,
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
};

/**
 * All supported Mermaid themes
 */
export const MERMAID_THEMES = [
  'default',
  'base',
  'dark',
  'forest',
  'neutral',
] as const;

export type MermaidTheme = (typeof MERMAID_THEMES)[number];

/**
 * Theme display labels for UI
 */
export const MERMAID_THEME_LABELS: Record<MermaidTheme, string> = {
  default: 'Default',
  base: 'Base',
  dark: 'Dark',
  forest: 'Forest',
  neutral: 'Neutral',
};

/**
 * Get the default theme based on UI mode (dark/light)
 *
 * @param uiMode - The current UI theme mode
 * @returns Appropriate Mermaid theme
 */
export function getDefaultThemeForMode(
  uiMode: 'dark' | 'light' | 'system' | undefined
): MermaidTheme {
  if (uiMode === 'dark') {
    return 'dark';
  } else if (uiMode === 'light') {
    return 'base';
  }
  // For system or undefined, default to 'default' theme
  return 'default';
}

/**
 * Theme-specific Mermaid configuration.
 *
 * @param theme - Mermaid theme name
 * @returns Mermaid configuration object
 */
export function getMermaidConfig(theme: MermaidTheme) {
  return {
    ...MERMAID_BASE_CONFIG,
    theme: theme as MermaidTheme,
    flowchart: {
      htmlLabels: true,
      nodeSpacing: 50,
      rankSpacing: 50,
      padding: 12,
      useMaxWidth: false,
    },
    themeVariables: {
      fontSize: '16px',
      lineHeight: '24px',
      padding: 12,
    },
    themeCSS: `
      .nodeLabel, .edgeLabel, .label { line-height: 1.4; }
      foreignObject div, foreignObject span { line-height: 1.4; }
    `,
  };
}
