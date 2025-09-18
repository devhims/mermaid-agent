import { NextRequest } from 'next/server';
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  tool,
  generateText,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { validateMermaidCode } from '../tools';

export const runtime = 'nodejs';

// Request schema - AI SDK v5 enhanced
const RequestSchema = z.object({
  code: z.string(),
  error: z.string().nullable(),
  step: z.number().default(1),
  // Future streaming support (AI SDK v5 ready)
  stream: z.boolean().optional().default(false),
});

// Response schema - defines the shape returned by this API
const ResponseSchema = z.object({
  success: z.boolean(),
  isComplete: z.boolean(),
  fixedCode: z.string().optional(),
  validated: z.boolean().optional(),
  validationError: z.string().optional(),
  explanation: z.string().optional(),
  message: z.string().optional(),
  step: z.number().optional(),
  attempts: z
    .array(
      z.object({
        fixedCode: z.string().optional(),
        validated: z.boolean().optional(),
        validationError: z.string().optional(),
        explanation: z.string().optional(),
      })
    )
    .optional(),
  usage: z
    .object({
      totalTokens: z.number().optional(),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    })
    .optional(),
  finishReason: z.unknown().optional(),
  stepsCount: z.number().optional(),
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
    const modeParam = req.nextUrl.searchParams.get('mode');
    const mode = (modeParam || json?.mode || '').toString();

    // Branch A: AI SDK UI chat transport streaming (preferred for live tool/step updates)
    if (json && Array.isArray(json.messages)) {
      const messages = json.messages as UIMessage[];

      // Define tool in this branch so it is available for streaming execution
      const mermaidValidator = tool({
        description:
          'Validate a candidate Mermaid code snippet with the real Mermaid parser and return validation status.',
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
        tools: { mermaidValidator },
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

Use the mermaidValidator tool to validate a minimally changed corrected code snippet. The tool validates with the REAL Mermaid parser and returns { validated, validationError }.

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

    // Branch B: Default multi-step fixing (original functionality)
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }

    const { code, error, step, stream } = parsed.data;

    console.log(`🤖 Fix Agent Step ${step}:`, {
      codeLength: code.length,
      hasError: !!error,
      errorPreview: error?.substring(0, 100) || 'No error',
      streamingEnabled: stream,
      mode,
    });

    // Validate with real Mermaid parser
    const validation = await validateMermaidCode(code);

    // If validation passes, we're done
    if (validation.isValid) {
      return new Response(
        JSON.stringify(
          ResponseSchema.parse({
            success: true,
            isComplete: true,
            fixedCode: code,
            message: `✅ Code is valid! Real Mermaid validation passed.`,
            step: step,
            validated: true,
          })
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Use real validation error if available, otherwise use frontend error
    const actualError = validation.error || error || 'Unknown validation error';

    // Create tool for making fixes; executes validation and returns result
    const mermaidValidator = tool({
      description:
        'Validate a candidate Mermaid code snippet with the real Mermaid parser and return validation status.',
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
        console.log('🔧 Tool called: mermaidValidator');
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
      tools: { mermaidValidator },
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

Use the mermaidValidator tool to validate a minimally changed corrected code snippet. The tool validates with the REAL Mermaid parser and returns { validated, validationError }.

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
      validated?: boolean;
      validationError?: string;
      explanation?: string;
    };

    // Pair toolCalls with toolResults to recover the candidate fixedCode from input args
    const attempts: Attempt[] = [];
    for (const step of steps) {
      const calls = step.toolCalls || [];
      const results = step.toolResults || [];
      const count = Math.max(calls.length, results.length);
      for (let i = 0; i < count; i++) {
        const call = calls[i] as any;
        const result = results[i] as any;
        const output = (result?.output || {}) as {
          validated?: boolean;
          validationError?: string;
        };
        const args = (call?.args || {}) as {
          fixedCode?: string;
          explanation?: string;
        };
        // Only include entries that look like our validator tool interactions
        const toolName = call?.toolName || call?.name;
        if (!toolName || toolName !== 'mermaidValidator') continue;
        attempts.push({
          fixedCode: args?.fixedCode,
          validated: output?.validated,
          validationError: output?.validationError,
          explanation: args?.explanation,
        });
      }
    }

    // Find last successful attempt, or last attempt overall
    const success = [...attempts].reverse().find((a) => a?.validated === true);
    const last = attempts.at(-1);

    if (success) {
      return new Response(
        JSON.stringify(
          ResponseSchema.parse({
            success: true,
            isComplete: true,
            fixedCode: success.fixedCode,
            explanation: success.explanation,
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
          })
        ),
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
        JSON.stringify(
          ResponseSchema.parse({
            success: true,
            isComplete: false,
            fixedCode: last.fixedCode,
            explanation: last.explanation,
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
          })
        ),
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
      JSON.stringify(
        ResponseSchema.parse({
          success: false,
          isComplete: false,
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
        })
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-AI-SDK-Version': '5.0',
        },
      }
    );
  } catch (err: unknown) {
    console.error('/api/fix error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Missing OPENAI_API_KEY environment variable',
        }),
        { status: 500 }
      );
    }

    // const json = await req.json().catch(() => ({}));
    // const parsed = ReqSchema.safeParse(json);
    // if (!parsed.success) {
    //   return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
    //     status: 400,
    //   });
    // }

    // const { code } = parsed.data;

    const system = `You are a precise Mermaid diagram fixer.
    - Input will be Mermaid code (e.g., graph/sequence/class/gantt/pie/state/er/journey).
    - Validate and repair syntax strictly to latest Mermaid conventions.
    - Preserve author intent, node names, relationships, and layout hints when possible.
    - Do not invent unrelated content.
    - Prefer minimal changes.
    - If the code is already valid, return it unchanged.
    - Ensure the output compiles in Mermaid without runtime errors.
    - Never wrap the code in backticks.`;

    const { text } = await generateText({
      model: openai('gpt-4o'),
      // schema: ResSchema,
      system,
      prompt: 'Hello!',
      // prompt: `Fix this Mermaid code. Provide fixedCode and short rationale.\n\n<MERMAID>\n${code}\n</MERMAID>`,
    });

    return new Response(JSON.stringify(text), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('/api/fix error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
