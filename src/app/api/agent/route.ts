/**
 * Modernized Mermaid Code Fixing API Route using AI SDK v5 Best Practices
 *
 * Key modernizations applied:
 * - Using streamText() instead of generateText() for better performance and streaming capabilities
 * - Modern stopWhen conditions with stepCountIs() helper function
 * - Proper onError and onFinish lifecycle callbacks
 * - Enhanced tool definitions with outputSchema for type safety
 * - Modern usage tracking with totalUsage instead of deprecated usage
 * - Proper error handling and metadata exposure
 *
 * This implementation follows AI SDK v5 best practices while maintaining backward compatibility
 * with the existing frontend interface.
 */

import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
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
      error instanceof Error
        ? error.message
        : String(error ?? 'Unknown parse error');
    console.log('❌ Mermaid validation failed:', errorMessage);
    return { isValid: false, error: errorMessage };
  }
}

// Request schema - AI SDK v5 enhanced
const RequestSchema = z.object({
  code: z.string(),
  error: z.string().nullable(),
  step: z.number().default(1),
  // Future streaming support (AI SDK v5 ready)
  stream: z.boolean().optional().default(false),
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

    // Branch 1: AI SDK UI chat transport streaming (preferred for live tool/step updates)
    if (json && Array.isArray(json.messages)) {
      const messages = json.messages as UIMessage[];

      // Define tool in this branch so it is available for streaming execution
      const fixMermaidCode = tool({
        description:
          'Submit a corrected Mermaid code snippet. The tool validates it and returns whether it is valid along with any parse error.',
        inputSchema: z.object({
          fixedCode: z.string().describe('The corrected Mermaid code'),
          explanation: z
            .string()
            .describe('Explanation of what was fixed and why'),
        }),
        outputSchema: z.object({
          fixedCode: z.string(),
          explanation: z.string(),
          validated: z.boolean(),
          validationError: z.string().optional(),
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

      const result = streamText({
        model: openai('gpt-4o-mini'),
        messages: convertToModelMessages(messages),
        tools: { fixMermaidCode },
        stopWhen: [
          stepCountIs(6),
          ({ steps }) => {
            const lastStep = steps[steps.length - 1];
            return (lastStep?.toolResults || []).some((tr) => {
              const output = tr.output as { validated?: boolean };
              return output?.validated === true;
            });
          },
        ],
        onError: ({ error }) => {
          console.error('AI SDK Error during Mermaid fixing (stream):', error);
        },
        system: `You are an expert at fixing Mermaid diagram syntax errors.

Use the fixMermaidCode tool to submit a minimally changed corrected code snippet. The tool validates with the REAL Mermaid parser and returns { validated, validationError }.

Stream short status updates for each step. When validated: true is returned, do not make further tool calls, and announce success.`,
      });

      const errorHandler = (error: unknown) => {
        if (error == null) return 'unknown error';
        if (typeof error === 'string') return error;
        if (error instanceof Error) return error.message;
        try {
          return JSON.stringify(error);
        } catch {
          return 'An error occurred';
        }
      };

      return result.toUIMessageStreamResponse({
        onError: errorHandler,
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return { createdAt: Date.now(), model: 'gpt-4o-mini' };
          }
          if (part.type === 'finish') {
            return {
              totalTokens: part.totalUsage?.totalTokens,
              inputTokens: part.totalUsage?.inputTokens,
              outputTokens: part.totalUsage?.outputTokens,
            };
          }
          return undefined;
        },
      });
    }
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }

    const { code, error, step, stream } = parsed.data;

    console.log(`🤖 Agent Step ${step}:`, {
      codeLength: code.length,
      hasError: !!error,
      errorPreview: error?.substring(0, 100) || 'No error',
      streamingEnabled: stream,
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
      // Modern AI SDK v5 - outputSchema for type safety
      outputSchema: z.object({
        fixedCode: z.string(),
        explanation: z.string(),
        validated: z.boolean(),
        validationError: z.string().optional(),
      }),
      execute: async ({ fixedCode, explanation }) => {
        console.log('🔧 Tool called: fixMermaidCode');
        console.log('📝 Explanation:', explanation);
        const validation = await validateMermaidCode(fixedCode);
        console.log(
          `🔍 Validation result: ${validation.isValid ? 'PASSED' : 'FAILED'}`
        );
        return {
          fixedCode,
          explanation,
          validated: validation.isValid,
          validationError: validation.error,
        };
      },
    });

    // AI SDK v5 Multi-step approach: allow the model to iterate with validation feedback
    console.log('🔄 Starting AI-powered iterative fixing with up to 6 steps');
    const result = await streamText({
      model: openai('gpt-4o-mini'),
      tools: { fixMermaidCode },
      // Modern AI SDK v5 stopWhen with proper helper function
      stopWhen: [
        stepCountIs(6), // Stop after 6 steps max
        ({ steps }) => {
          // Stop if any tool result in last step is validated
          const lastStep = steps[steps.length - 1];
          return (lastStep?.toolResults || []).some((tr) => {
            const output = tr.output as { validated?: boolean };
            return output?.validated === true;
          });
        },
      ],
      // Modern error handling with onError callback
      onError: ({ error }) => {
        console.error('AI SDK Error during Mermaid fixing:', error);
      },
      // Lifecycle callback for completion
      onFinish: ({ text, totalUsage, steps }) => {
        console.log(
          `🎯 Multi-step process completed in ${steps.length} AI steps. Usage:`,
          totalUsage
        );
        console.log(
          `📊 Total tool calls across all steps: ${steps.reduce(
            (acc, step) => acc + (step.toolCalls?.length || 0),
            0
          )}`
        );
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

    // Wait for the stream to complete and get the final result
    const finalResult = await Promise.all([
      result.text,
      result.steps,
      result.totalUsage,
      result.finishReason,
    ]);

    const [finalText, steps, totalUsage, finishReason] = finalResult;

    // AI SDK v5 Feature: Streaming response option for future frontend support
    if (stream) {
      // For future streaming implementation using toUIMessageStreamResponse()
      // This would return: return result.toUIMessageStreamResponse();
      console.log(
        '📡 Streaming mode requested but not yet implemented in frontend'
      );
    }

    // Collect attempts from tool results using modern AI SDK v5 structure
    type Attempt = {
      fixedCode?: string;
      explanation?: string;
      validated?: boolean;
      validationError?: string;
    };

    const attempts = steps
      .flatMap((step) => step.toolResults || [])
      .map((toolResult) => toolResult.output as Attempt)
      .filter(Boolean) as Attempt[];

    // Find last successful attempt, or last attempt overall
    const success = [...attempts].reverse().find((a) => a?.validated === true);
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
          // Modern AI SDK v5 usage information
          usage: {
            totalTokens: totalUsage?.totalTokens,
            inputTokens: totalUsage?.inputTokens,
            outputTokens: totalUsage?.outputTokens,
          },
          finishReason,
          stepsCount: steps.length,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-AI-SDK-Version': '5.0',
          },
        }
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
          // Modern AI SDK v5 usage information
          usage: {
            totalTokens: totalUsage?.totalTokens,
            inputTokens: totalUsage?.inputTokens,
            outputTokens: totalUsage?.outputTokens,
          },
          finishReason,
          stepsCount: steps.length,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-AI-SDK-Version': '5.0',
          },
        }
      );
    }

    // Model did not call the tool - AI SDK v5 enhanced error response
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Model did not call the fix tool',
        step: step,
        validationError: actualError,
        // Modern AI SDK v5 usage information
        usage: {
          totalTokens: totalUsage?.totalTokens,
          inputTokens: totalUsage?.inputTokens,
          outputTokens: totalUsage?.outputTokens,
        },
        finishReason,
        stepsCount: steps.length,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-AI-SDK-Version': '5.0',
        },
      }
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

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;
