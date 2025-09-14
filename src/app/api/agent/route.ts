import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import mermaid from 'mermaid/dist/mermaid.core.mjs';

// Initialize mermaid for Node.js
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose', // For backend validation
});

// Validate Mermaid code using Mermaid core only
async function validateMermaidCode(
  code: string
): Promise<{ isValid: boolean; error?: string }> {
  try {
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
    // Use mermaid core parser for validation
    const result = await mermaid.parse(sanitized, { suppressErrors: false });
    console.log('✅ Mermaid validation passed:', result);
    return { isValid: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? 'Unknown parse error');
    console.log('❌ Mermaid validation failed:', errorMessage);
    return { isValid: false, error: errorMessage };
  }
}

// Request schema
const RequestSchema = z.object({
  code: z.string(),
  error: z.string().nullable(),
  step: z.number().default(1),
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Missing OPENAI_API_KEY environment variable',
        }),
        { status: 500 }
      );
    }

    const json = await req.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }

    const { code, error, step } = parsed.data;

    console.log(`🤖 Agent Step ${step}:`, {
      codeLength: code.length,
      hasError: !!error,
      errorPreview: error?.substring(0, 100) || 'No error',
    });

    // Validate with real Mermaid parser
    const validation = await validateMermaidCode(code);

    // If validation passes, we're done
    if (validation.isValid) {
      return new Response(
        JSON.stringify({
          success: true,
          isComplete: true,
          fixedCode: code,
          message: `✅ Code is valid! Real Mermaid validation passed.`,
          step: step,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Use real validation error if available, otherwise use frontend error
    const actualError = validation.error || error || 'Unknown validation error';

    // Create tool for making fixes; executes validation and returns result
    const fixMermaidCode = tool({
      description:
        'Submit a corrected Mermaid code snippet. The tool validates it and returns whether it is valid along with any parse error.',
      inputSchema: z.object({
        fixedCode: z.string().describe('The corrected Mermaid code'),
        explanation: z
          .string()
          .describe('Explanation of what was fixed and why'),
      }),
      execute: async ({ fixedCode, explanation }) => {
        const validation = await validateMermaidCode(fixedCode);
        return {
          fixedCode,
          explanation,
          validated: validation.isValid,
          validationError: validation.error,
        };
      },
    });

    // Fast path: single-line replacement suggestion using the exact parser error line
    const lineMatch = /line\s+(\d+)/i.exec(actualError);
    if (lineMatch) {
      const lineNumber = Math.max(1, parseInt(lineMatch[1], 10));
      const lines = code
        .replace(/\r\n?/g, '\n')
        .replace(/^\uFEFF/, '')
        .split('\n');
      const idx = Math.min(lines.length - 1, lineNumber - 1);
      const targetLine = lines[idx];
      const prev = lines[idx - 1] ?? '';
      const next = lines[idx + 1] ?? '';

      const suggestLineFix = tool({
        description:
          'Suggest a replacement for the single problematic Mermaid line shown. You may include newlines to split content if needed.',
        inputSchema: z.object({
          replacement: z
            .string()
            .describe(
              'Replacement text for the problematic line. Newlines allowed.'
            ),
          explanation: z
            .string()
            .describe(
              'Brief explanation of the change and why it fixes the error.'
            ),
        }),
      });

      try {
        const { toolCalls } = await generateText({
          model: openai('gpt-4o-mini'),
          tools: { suggestLineFix },
          toolChoice: 'required',
          system:
            'You are a precise Mermaid linter. Propose the minimal replacement for the highlighted line only, keeping context consistent.',
          prompt: `Mermaid parse failed on line ${lineNumber}. Provide a replacement for that line only.\n\nContext lines:\n${
            lineNumber - 1
          }: ${prev}\n> ${lineNumber}: ${targetLine}\n${
            lineNumber + 1
          }: ${next}\n\nParser error:\n${actualError}\n\nReturn via suggestLineFix tool.`,
        });

        const fix = toolCalls?.[0];
        if (fix && 'input' in fix) {
          const { replacement, explanation } = fix.input as {
            replacement: string;
            explanation: string;
          };

          const replLines = replacement.replace(/\r\n?/g, '\n').split('\n');
          const newLines = [
            ...lines.slice(0, idx),
            ...replLines,
            ...lines.slice(idx + 1),
          ];
          const candidate = newLines.join('\n');
          const quickValidation = await validateMermaidCode(candidate);
          if (quickValidation.isValid) {
            return new Response(
              JSON.stringify({
                success: true,
                isComplete: true,
                fixedCode: candidate,
                message: `✅ ${explanation} (Replaced line ${lineNumber}; verified)`,
                step: step + 1,
                validated: true,
                attempts: [
                  {
                    explanation,
                    fixedCode: candidate,
                    validated: true,
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
      } catch (e) {
        console.warn(
          'Line-level fix attempt failed; falling back to multi-step.',
          e
        );
      }
    }

    // Multi-step tool usage: allow the model to iterate with validation feedback
    const maxSteps = 6;
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      tools: { fixMermaidCode },
      // Let the model decide when to stop; we stop when validation passes or step cap reached
      stopWhen: async ({ steps }) => {
        // stop if step cap reached
        if (steps.length >= maxSteps) return true;
        const last = steps[steps.length - 1];
        // stop if any tool result in last step is validated
        const ok = (last.toolResults || []).some((tr: unknown) => {
          const obj = tr as { output?: { validated?: boolean } };
          return obj.output?.validated === true;
        });
        return ok;
      },
      system: `You are an expert at fixing Mermaid diagram syntax errors.

Use the fixMermaidCode tool to submit a minimally changed corrected code snippet. The tool validates with the REAL Mermaid parser and returns { validated, validationError }.

Instructions:
- Make minimal changes to address ONLY the reported error
- Preserve valid syntax (edge labels |text|, styles, emojis, etc.)
- If validation fails, analyze validationError and try again in another step
- When validation succeeds (validated: true), do NOT make further tool calls
`,
      prompt: `Fix this Mermaid diagram. Current code and real parser error:

Current Code:
\`\`\`
${code}
\`\`\`

Parser Error:
${actualError}
`,
    });

    // Collect attempts from tool results
    type Attempt = {
      fixedCode?: string;
      explanation?: string;
      validated?: boolean;
      validationError?: string;
    };
    const attempts = result.steps
      .flatMap((s: unknown) => (s as { toolResults?: Array<{ output?: unknown }> }).toolResults || [])
      .map((tr) => (tr.output as Attempt) || ({} as Attempt))
      .filter(Boolean) as Attempt[];

    // Find last successful attempt, or last attempt overall
    const success = [...attempts]
      .reverse()
      .find((a) => a?.validated === true);
    const last = attempts.at(-1);

    if (success) {
      return new Response(
        JSON.stringify({
          success: true,
          isComplete: true,
          fixedCode: success.fixedCode,
          message: `✅ ${
            success.explanation || 'Code validated'
          } (Verified with Mermaid parser)`,
          step: step + attempts.length,
          validated: true,
          attempts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (last) {
      return new Response(
        JSON.stringify({
          success: true,
          isComplete: false,
          fixedCode: last.fixedCode,
          message: `⚠️ Made progress in ${attempts.length} steps but still has issues. Final error: ${last.validationError}`,
          step: step + attempts.length,
          validated: false,
          validationError: last.validationError,
          attempts,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Model did not call the tool
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Model did not call the fix tool',
        step: step,
        validationError: actualError,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    console.error('/api/agent error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// GET endpoint for testing
export async function GET() {
  return new Response(
    JSON.stringify({
      instructions: {
        method: 'POST',
        body: {
          code: 'Mermaid code string',
          error: 'Error message from frontend validation (or null if no error)',
          step: 'Step number (optional, defaults to 1)',
        },
        description:
          'Simple one-step agent that fixes Mermaid code based on frontend validation errors',
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
