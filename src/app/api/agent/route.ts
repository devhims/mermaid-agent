/**
 * Modernized Mermaid Code Fixing API Route using AI SDK v5 Best Practices
 *
 * Key modernizations applied:
 * - Using streamText() with experimental_output for JSON mode
 * - Tool calling integration
 * - Modern stopWhen conditions with stepCountIs() helper function
 * - Proper onError and onFinish lifecycle callbacks
 * - Enhanced tool definitions with outputSchema for type safety
 * - Modern usage tracking with totalUsage instead of deprecated usage
 * - Proper error handling and metadata exposure
 *
 * This implementation follows AI SDK v5 best practices while maintaining backward compatibility
 * with the existing frontend interface.
 */

import { streamText, tool, stepCountIs, Output } from 'ai';

import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { validateMermaidCode } from '../tools';

// Request schema - AI SDK v5 enhanced
const RequestSchema = z.object({
  code: z.string(),
  error: z.string().nullable(),
  step: z.number().default(1),
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

    // Structured object generation (fixedCode + explanation) with validation

    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }
    const { code, error, step } = parsed.data;

    // Validate original code first
    const initialValidation = await validateMermaidCode(code);
    if (initialValidation.isValid) {
      const response = ResponseSchema.parse({
        success: true,
        isComplete: true,
        fixedCode: code,
        explanation: 'Code is already valid. No changes required.',
        validated: true,
        step,
      });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const actualError =
      initialValidation.error || error || 'Unknown validation error';

    // Ask model for minimally changed fixedCode + explanation using streamText + experimental_output
    const ObjectSchema = z.object({
      fixedCode: z.string().describe('Minimally changed Mermaid code proposal'),
      explanation: z.string().describe('Short explanation of the changes'),
    });

    console.log('🧠 streamText with experimental_output: preparing request');

    // Create a validation tool for the model to use
    const mermaidValidator = tool({
      description:
        'Validate a candidate Mermaid code snippet with the real Mermaid parser and return validation status.',
      inputSchema: z.object({
        fixedCode: z
          .string()
          .describe('The corrected Mermaid code to validate'),
      }),
      outputSchema: z.object({
        fixedCode: z.string(),
        validated: z.boolean(),
        validationError: z.string().optional(),
      }),
      execute: async ({ fixedCode }) => {
        console.log('🔧 Tool called: mermaidValidator for json mode');
        const validation = await validateMermaidCode(fixedCode);
        console.log(
          `🔍 Validation result: ${validation.isValid ? 'PASSED' : 'FAILED'}`
        );
        return {
          fixedCode,
          validated: validation.isValid,
          validationError: validation.error,
        };
      },
    });

    const result = streamText({
      model: openai('gpt-4o-mini'),
      tools: { mermaidValidator },
      experimental_output: Output.object({
        schema: ObjectSchema,
      }),
      stopWhen: stepCountIs(4), // tool call + tool result + structured output + final step
      system: `You fix Mermaid diagrams with minimal edits. Use the mermaidValidator tool to validate your fixes. Output a structured object with fixedCode and explanation.`,
      prompt: `Fix this Mermaid diagram. Provide a minimal fix.

Current Code:
\`\`\`
${code}
\`\`\`

Parser Error:
${actualError}

Use the mermaidValidator tool to validate your proposed fix before finalizing the output.`,
      onError: ({ error }) => {
        console.error('AI SDK streamText error:', error);
      },
      temperature: 0.2,
      maxOutputTokens: 1000,
    });

    // Create a ReadableStream to handle the streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(
            '🧠 streamText with experimental_output: starting streaming...'
          );

          let eventCount = 0;
          let accumulatedText = '';
          let hasFinished = false;

          // Stream all events including tool calls and text deltas

          for await (const event of result.fullStream) {
            if (hasFinished) break; // Stop if we've already sent completion

            eventCount++;

            if (event.type === 'text-delta') {
              accumulatedText += event.text;

              // Send text delta for progress indication
              const data =
                JSON.stringify({
                  type: 'text-delta',
                  count: eventCount,
                  textDelta: event.text,
                  accumulatedText,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'tool-call') {
              console.log(
                `🔧 Tool call #${eventCount}:`,
                event.toolName,
                (event as any).input || (event as any).args
              );

              // Send tool call event
              const data =
                JSON.stringify({
                  type: 'tool-call',
                  count: eventCount,
                  toolName: event.toolName,
                  args: (event as any).input || (event as any).args,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'tool-result') {
              console.log(
                `✅ Tool result #${eventCount}:`,
                event.toolName,
                (event as any).output || (event as any).result
              );

              // Send tool result event
              const data =
                JSON.stringify({
                  type: 'tool-result',
                  count: eventCount,
                  toolName: event.toolName,
                  result: (event as any).output || (event as any).result,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'error') {
              console.error(`❌ Error #${eventCount}:`, event.error);

              // Send error event
              const data =
                JSON.stringify({
                  type: 'error',
                  count: eventCount,
                  error: event.error,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'finish') {
              console.log(`🏁 Finish #${eventCount}:`, event.finishReason);

              // Send finish event
              const data =
                JSON.stringify({
                  type: 'finish',
                  count: eventCount,
                  finishReason: event.finishReason,
                  usage: event.totalUsage,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            }
          }

          // Get final results
          const finalText = await result.text;
          const totalUsage = await result.totalUsage;
          const finishReason = await result.finishReason;
          const steps = await result.steps;

          console.log('🧠 streamText: completed');

          // Try to parse the final structured output from experimental_output
          let obj: { fixedCode: string; explanation: string } | null = null;

          // Check if experimental_output is available
          try {
            const experimentalObj = await (result as any).experimental_output;
            if (experimentalObj) {
              obj = experimentalObj;
              console.log(
                'Got structured object from experimental_output:',
                obj
              );
            }
          } catch (e) {
            console.log(
              'experimental_output not available, trying other methods'
            );
          }

          // Fallback: try to parse from final text
          if (!obj) {
            try {
              obj = JSON.parse(finalText);
              console.log('Parsed structured object from final text:', obj);
            } catch (parseError) {
              console.log('Could not parse final text as JSON');
              obj = null;
            }
          }

          // Last fallback: extract from tool results
          if (!obj && steps.length > 0) {
            const lastStep = steps[steps.length - 1];
            if (lastStep.toolResults && lastStep.toolResults.length > 0) {
              const lastToolResult =
                lastStep.toolResults[lastStep.toolResults.length - 1];
              const output = lastToolResult.output as any;
              if (output?.fixedCode) {
                obj = {
                  fixedCode: output.fixedCode,
                  explanation: `Fixed using validator tool: ${
                    output.validationError || 'Validation passed'
                  }`,
                };
                console.log('Extracted object from tool result:', obj);
              }
            }
          }

          if (!obj) {
            console.error('No structured output received from model');
            throw new Error('No structured output received from model');
          }

          const validation = await validateMermaidCode(obj.fixedCode);

          hasFinished = true;

          const finalData =
            JSON.stringify({
              success: true,
              isComplete: validation.isValid,
              fixedCode: obj.fixedCode,
              explanation: obj.explanation,
              validated: validation.isValid,
              validationError: validation.error,
              step,
              attempts: [
                {
                  fixedCode: obj.fixedCode,
                  validated: validation.isValid,
                  validationError: validation.error,
                  explanation: obj.explanation,
                },
              ],
              usage: {
                totalTokens: totalUsage?.totalTokens,
                inputTokens: totalUsage?.inputTokens,
                outputTokens: totalUsage?.outputTokens,
              },
              finishReason,
              stepsCount: steps.length,
            }) + '\n';

          controller.enqueue(new TextEncoder().encode(finalData));
          controller.close();

          console.log('🧠 streamText: streaming completed');
        } catch (error) {
          console.error('🧠 streamText streaming error:', error);
          const errorData =
            JSON.stringify({
              success: false,
              isComplete: false,
              validated: false,
              validationError: actualError,
              message:
                error instanceof Error
                  ? error.message
                  : 'Unknown streaming error',
              step,
              attempts: [],
              timestamp: new Date().toISOString(),
            }) + '\n';

          controller.enqueue(new TextEncoder().encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    console.error('/api/agent error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;
