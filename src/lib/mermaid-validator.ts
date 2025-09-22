import mermaid from 'mermaid';
import { lintMermaid, type LintError } from './mermaid-lint';

export type { LintError } from './mermaid-lint';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      rawMessage?: string;
      line?: number; // 1-based
      column?: number; // 1-based for display
      errors: LintError[];
    };

type MermaidParserHashLoc = {
  first_line?: number;
  line?: number;
  first_column?: number;
  column?: number;
};
type MermaidParserHash = {
  loc?: MermaidParserHashLoc;
  line?: number;
  column?: number;
};
type MermaidParseErrorLike = { message?: string; hash?: MermaidParserHash };

export function initMermaidForValidation() {
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
    });
  } catch {}
}

export function validateMermaid(code: string): ValidationResult {
  try {
    const normalized = code.replace(/\r\n?/g, '\n');

    let parseLine: number | undefined;
    let parseColumn: number | undefined;
    let rawMessage: string | undefined;

    try {
      // Avoid surfacing thrown errors to the app overlay
      type MermaidLike = {
        parse: (code: string, opts?: { suppressErrors?: boolean }) => unknown;
      };
      const m = mermaid as unknown as MermaidLike;
      m.parse(normalized, { suppressErrors: true });
    } catch (err: unknown) {
      const e = (err as MermaidParseErrorLike) || undefined;
      rawMessage = String((e?.message as string | undefined) ?? err);
      const loc =
        e?.hash?.loc ??
        (e?.hash
          ? { first_line: e.hash.line, first_column: e.hash.column }
          : undefined);

      parseLine = loc?.first_line ?? loc?.line;
      parseColumn = loc?.first_column ?? loc?.column;
    }

    // Treat lints as non-blocking: if the parser didn't error, consider it valid
    if (!rawMessage) {
      return { ok: true };
    }

    // Only run lints when parser fails - they're supplementary hints
    const lintErrors = lintMermaid(normalized);

    // Build snippet for parser error if available
    const lines = normalized.split('\n');
    const lineIndex =
      typeof parseLine === 'number' && parseLine > 0 ? parseLine - 1 : -1;
    const snippet =
      lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : undefined;

    if (rawMessage) {
      lintErrors.unshift({
        ruleId: 'mermaid.parse',
        message: 'Mermaid parser reported a syntax error.',
        hint: 'Common culprits: parentheses in [] labels (quote them), adjacent nodes with no arrow, or unbalanced brackets.',
        line: parseLine,
        column: parseColumn ? parseColumn + 1 : undefined,
        snippet,
      });
    }

    return {
      ok: false,
      rawMessage,
      line: parseLine,
      column: parseColumn ? parseColumn + 1 : undefined,
      errors: lintErrors,
    };
  } catch (fatal: unknown) {
    const normalized = code.replace(/\r\n?/g, '\n');
    const lintErrors = lintMermaid(normalized);
    return {
      ok: false,
      rawMessage: String(
        (fatal as { message?: string } | undefined)?.message ??
          fatal ??
          'Unknown validation error'
      ),
      errors: lintErrors,
    };
  }
}
