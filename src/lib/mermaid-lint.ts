// Shared, DOM-free Mermaid lint rules for producing friendly, actionable hints.

export type Fix = { range?: [number, number]; text?: string };

export type LintError = {
  ruleId: string;
  message: string;
  hint?: string;
  line?: number; // 1-based
  column?: number; // 1-based for display
  snippet?: string; // offending line content
  fix?: Fix; // optional autofix suggestion
};

/** Convert string offset to 1-based line/column */
function offsetToLineCol(
  s: string,
  offset: number
): { line: number; col: number } {
  const pre = s.slice(0, offset);
  const line = pre.split('\n').length;
  const col = pre.length - pre.lastIndexOf('\n');
  return { line, col };
}

/**
 * Lint rules to turn vague parser tokens into concrete, dev-friendly hints.
 * Pure string/regex heuristics; safe to run on server and client.
 */
export function lintMermaid(code: string): LintError[] {
  const errors: LintError[] = [];
  const normalized = code.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  // ---- Rule: Parentheses inside [] label without quoting → must quote label ["..."]
  // Docs suggest quoting labels that include reserved chars/words.
  const rxUnquotedParensInLabel = /\[[^"\]\n]*\([^"\]\n]*\)[^"\]\n]*\]/g;
  let m: RegExpExecArray | null;
  while ((m = rxUnquotedParensInLabel.exec(normalized))) {
    const { line, col } = offsetToLineCol(normalized, m.index);
    const snippet = lines[line - 1];
    errors.push({
      ruleId: 'label.parentheses-unquoted',
      message: 'Parentheses found inside a [] node label without quotes.',
      hint: 'Wrap the label in quotes: C["handleFixWithAgent()"].',
      line,
      column: col,
      snippet,
      fix: {
        range: [m.index, m.index + m[0].length],
        text: m[0].replace(/^\[/, '["').replace(/\]$/, '"]'),
      },
    });
  }

  // ---- Rule: Two nodes stuck together on one line (missing arrow or separator)
  lines.forEach((ln, i) => {
    const hasArrow = /-{1,3}?>|==+>/.test(ln);
    const nodeStarts = (
      ln.match(/\b[A-Za-z][\w-]*\s*(?:\[[^\]]*\]|\([^\)]+\)|\{[^}]+\})/g) || []
    ).length;
    if (!hasArrow && nodeStarts >= 2) {
      errors.push({
        ruleId: 'layout.nodes-adjacent',
        message:
          'Two nodes appear on the same line without an arrow between them.',
        hint: 'Insert an edge (e.g., `-->`) or split into separate lines.',
        line: i + 1,
        column: 1,
        snippet: ln,
      });
    }

    if (/\][A-Za-z]/.test(ln)) {
      errors.push({
        ruleId: 'layout.node-concatenation',
        message:
          'A node is immediately followed by an identifier; likely two statements merged.',
        hint: 'Add a newline or semicolon between statements.',
        line: i + 1,
        column: ln.indexOf(']') + 2,
        snippet: ln,
      });
    }
  });

  // ---- Rule: Unbalanced brackets ([], {}, ())
  const balance = (open: string, close: string, name: string) => {
    const openCount = (normalized.match(new RegExp('\\' + open, 'g')) || [])
      .length;
    const closeCount = (normalized.match(new RegExp('\\' + close, 'g')) || [])
      .length;
    if (openCount !== closeCount) {
      errors.push({
        ruleId: `brackets.unbalanced.${name}`,
        message: `Unbalanced ${name} detected.`,
        hint: `Check for a missing '${close}' or extra '${open}'.`,
      });
    }
  };
  balance('[', ']', 'square');
  balance('{', '}', 'curly');
  balance('(', ')', 'parentheses');

  // ---- Rule: IDs must be simple (no spaces/emoji). Keep emoji in label only.
  lines.forEach((ln, i) => {
    const idMatches = ln.matchAll(/\b([^\s\[\(]+)\s*\[/g);
    for (const match of idMatches) {
      const id = match[1];
      if (!/^[A-Za-z][\w-]*$/.test(id)) {
        errors.push({
          ruleId: 'id.invalid',
          message: `Invalid node id "${id}".`,
          hint: 'Use an ASCII id like A, step_1, postRequest. Put emojis/spaces inside the label: A["🤖 Agent"].',
          line: i + 1,
          column: (match.index || 0) + 1,
          snippet: ln,
        });
      }
    }
  });

  // ---- Rule: Suggest quoting for labels that contain pipes or angle/brace combos
  lines.forEach((ln, i) => {
    const labelMatches = ln.matchAll(/\[[^\]]+\]/g);
    for (const match of labelMatches) {
      const label = match[0];
      const needsQuote = /[|<>]/.test(label);
      const isQuoted = label.startsWith('["') && label.endsWith('"]');
      if (needsQuote && !isQuoted) {
        errors.push({
          ruleId: 'label.special-chars',
          message:
            'Label contains special characters that can confuse the parser.',
          hint: 'Wrap the label in quotes, e.g., A["x | y"].',
          line: i + 1,
          column: (match.index || 0) + 1,
          snippet: ln,
        });
      }
    }
  });

  return errors;
}

/** Create a compact, human-readable message from lint errors */
export function formatLintErrors(
  errors: LintError[],
  opts?: { max?: number }
): string {
  const max = opts?.max ?? errors.length;
  const lines: string[] = [];
  for (const err of errors.slice(0, max)) {
    const loc = err.line
      ? ` @${err.line}${err.column ? ':' + err.column : ''}`
      : '';
    const hint = err.hint ? ` — ${err.hint}` : '';
    lines.push(`• [${err.ruleId}] ${err.message}${loc}${hint}`);
  }
  if (errors.length > max) {
    lines.push(`…and ${errors.length - max} more hint(s).`);
  }
  return lines.join('\n');
}
