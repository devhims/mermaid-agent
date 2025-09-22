import mermaid from 'mermaid/dist/mermaid.core.mjs';
import { lintMermaid, formatLintErrors } from '@/lib/mermaid-lint';

const MERMAID_KEYWORD_REGEX =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|gantt|erDiagram|journey|pie|mindmap|timeline|gitGraph|quadrantChart|xychart-beta|sankeyDiagram|requirementDiagram|c4context|c4component|c4container|c4deployment|blockDiagram|entityRelationshipDiagram|userJourney)\b/i;

const MERMAID_BODY_HINTS = [
  /-->/,
  /-\.->/,
  /===/,
  /:::/,
  /\bsubgraph\b/i,
  /\bparticipant\s+[A-Za-z0-9_]/i,
  /\bstate\s*(?:\{|\w)/i,
  /\bsection\s+[A-Za-z0-9_]/i,
  /\bloop\b/i,
  /\bclick\s+[A-Za-z0-9_]/i,
];

function detectMermaidIntent(code: string) {
  const lines = code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let diagramTypeHint: string | undefined;

  for (const line of lines) {
    if (line.startsWith('%%')) continue; // skip config/comments
    if (line === '---' || line === '...') continue; // skip potential front matter delimiters

    const keywordMatch = line.match(MERMAID_KEYWORD_REGEX);
    if (keywordMatch) {
      diagramTypeHint = keywordMatch[0];
      return { isLikelyMermaid: true, diagramTypeHint };
    }
    break; // stop at first meaningful line if no keyword match
  }

  const hasBodyHints = MERMAID_BODY_HINTS.some((regex) => regex.test(code));
  const hasInitDirective = code.includes('%%{') && code.includes('}%%');

  return {
    isLikelyMermaid: hasBodyHints || hasInitDirective,
    diagramTypeHint,
  };
}

// Initialize mermaid for Node.js
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose', // For backend validation
});

// Validate Mermaid code using Mermaid core only
export async function validateMermaidCode(code: string): Promise<{
  isValid: boolean;
  error?: string;
  diagramType?: string;
  isLikelyMermaid: boolean;
  hints?: string; // formatted hints for AI and UI
}> {
  // Sanitize the code (same logic as frontend)
  let sanitized = code
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .trim();

  // Extract fenced code if present
  const fence = /```(?:\s*mermaid)?\s*([\s\S]*?)```/i.exec(sanitized);
  if (fence && fence[1]) sanitized = fence[1];

  // Remove zero-width and bidi control characters
  const INVISIBLES =
    /[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
  sanitized = sanitized.replace(INVISIBLES, '');

  // Trim each line's leading/trailing spaces
  sanitized = sanitized
    .split('\n')
    .map((l) => l.replace(/^\s+|\s+$/g, ''))
    .join('\n')
    .trim();

  if (!sanitized) {
    return {
      isValid: false,
      error: 'Diagram code is empty',
      isLikelyMermaid: false,
    };
  }

  const { isLikelyMermaid, diagramTypeHint } = detectMermaidIntent(sanitized);

  try {
    // Use mermaid core parser for validation
    const result = await mermaid.parse(sanitized, { suppressErrors: false });
    const diagramType =
      result && typeof result === 'object' && 'diagramType' in result
        ? String((result as { diagramType: unknown }).diagramType)
        : diagramTypeHint;
    console.log('✅ Mermaid validation passed:', result);
    // Validation successful - no need for lint hints
    return { isValid: true, isLikelyMermaid: true, diagramType };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error ?? 'Unknown parse error');
    console.log('❌ Mermaid validation failed:', errorMessage);
    const lint = lintMermaid(sanitized);
    const hints = lint.length ? formatLintErrors(lint, { max: 8 }) : undefined;
    return {
      isValid: false,
      error: hints ? `${errorMessage}\n${hints}` : errorMessage,
      diagramType: diagramTypeHint,
      isLikelyMermaid,
      hints,
    };
  }
}
