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

import { streamText, tool, stepCountIs, Output, InferToolOutput } from 'ai';

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
    // ========================================
    // ENVIRONMENT VALIDATION
    // ========================================
    // Ensure OpenAI API key is configured before proceeding
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Missing OPENAI_API_KEY environment variable',
        }),
        { status: 500 }
      );
    }

    // ========================================
    // REQUEST PARSING & VALIDATION
    // ========================================
    // Parse and validate incoming request body against our schema
    const json = await req.json().catch(() => ({}));

    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }
    const { code, error, step } = parsed.data;

    // ========================================
    // INITIAL MERMAID CODE VALIDATION
    // ========================================
    // Check if the provided code is already valid - if so, return early
    const initialValidation = await validateMermaidCode(code);

    if (!initialValidation.isLikelyMermaid) {
      return new Response(
        JSON.stringify({
          error: 'Input is not a valid Mermaid diagram.',
          validationError: initialValidation.error,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

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

    // Determine the actual error message to work with
    const actualError =
      initialValidation.error || error || 'Unknown validation error';

    // ========================================
    // AI MODEL SETUP & TOOL CONFIGURATION
    // ========================================
    // Define the structured output schema for AI SDK v5 experimental_output
    const ObjectSchema = z.object({
      fixedCode: z.string().describe('Minimally changed Mermaid code proposal'),
      explanation: z.string().describe('Short explanation of the changes'),
    });

    console.log('🧠 streamText with experimental_output: preparing request');

    // Create a validation tool that the AI model can use to test its fixes
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

    const tools = { mermaidValidator };

    // ========================================
    // AI STREAM TEXT CONFIGURATION
    // ========================================
    // Configure the AI model with tools, structured output, and step limits
    const result = streamText({
      model: openai('gpt-4o-mini'),
      tools,
      experimental_output: Output.object({
        schema: ObjectSchema,
      }),
      stopWhen: stepCountIs(4), // max round trips with the LLM
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

    // ========================================
    // STREAMING RESPONSE SETUP
    // ========================================
    // Create a ReadableStream to handle real-time streaming of AI SDK stream events
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(
            '🧠 streamText with experimental_output: starting streaming...'
          );

          // Initialize streaming state variables
          let eventCount = 0;
          let accumulatedText = '';
          let hasFinished = false;

          // ========================================
          // EVENT STREAMING LOOP
          // ========================================
          // Process and forward all AI SDK events (text deltas, tool calls, results, etc.)
          for await (const event of result.fullStream) {
            if (hasFinished) break; // Stop if we've already sent completion

            eventCount++;

            // Handle incremental text generation from the AI model
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
              // Handle AI model invoking the mermaidValidator tool
              console.log(
                `🔧 Tool call #${eventCount}:`,
                event.toolName,
                event.input
              );

              // Send tool call event
              const data =
                JSON.stringify({
                  type: 'tool-call',
                  count: eventCount,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  providerExecuted: event.providerExecuted,
                  args: event.input,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'tool-result') {
              // Handle results from tool execution (validation outcomes)
              console.log(
                `✅ Tool result #${eventCount}:`,
                event.toolName,
                event.output
              );

              // Send tool result event
              const data =
                JSON.stringify({
                  type: 'tool-result',
                  count: eventCount,
                  toolName: event.toolName,
                  toolCallId: event.toolCallId,
                  providerExecuted: event.providerExecuted,
                  preliminary: event.preliminary,
                  result: event.output,
                  timestamp: new Date().toISOString(),
                }) + '\n';

              controller.enqueue(new TextEncoder().encode(data));
            } else if (event.type === 'error') {
              // Handle any errors that occur during AI SDK processing
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
              // Handle completion of AI processing
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

          // ========================================
          // FINAL RESULT PROCESSING
          // ========================================
          // Extract and process the final AI results once streaming completes

          const [finalText, totalUsage, finishReason, steps] =
            await Promise.all([
              result.text,
              result.totalUsage,
              result.finishReason,
              result.steps,
            ]);

          console.log('🧠 streamText: completed');

          // ========================================
          // STRUCTURED OUTPUT EXTRACTION
          // ========================================
          // Attempt to extract the structured fix proposal from various sources
          type FixProposal = z.infer<typeof ObjectSchema>;
          type StreamResultWithOutput = typeof result & {
            experimental_output?: FixProposal;
          };

          let obj: FixProposal | null = null;

          // First try: AI SDK v5 experimental_output (preferred method)
          try {
            const experimentalObj = (result as StreamResultWithOutput)
              .experimental_output;
            if (experimentalObj) {
              obj = experimentalObj;
              console.log(
                'Got structured object from experimental_output:',
                obj
              );
            }
          } catch {
            console.log(
              'experimental_output not available, trying other methods'
            );
          }

          // Second try: Parse final text as JSON (fallback method)
          if (!obj) {
            try {
              obj = JSON.parse(finalText) as FixProposal;
              console.log('Parsed structured object from final text:', obj);
            } catch {
              console.log('Could not parse final text as JSON');
            }
          }

          // ========================================
          // TOOL RESULT EXTRACTION
          // ========================================
          // Extract validation results from the last tool execution as backup
          type ValidatorOutput = InferToolOutput<typeof mermaidValidator>;
          let lastValidatorOutput: ValidatorOutput | null = null;

          if (steps.length > 0) {
            const lastStep = steps[steps.length - 1];
            if (lastStep.toolResults && lastStep.toolResults.length > 0) {
              const lastToolResult =
                lastStep.toolResults[lastStep.toolResults.length - 1];
              if (lastToolResult && !lastToolResult.dynamic) {
                const output = lastToolResult.output as ValidatorOutput;
                if (output) {
                  lastValidatorOutput = output;
                  // Third try: Use tool result if no structured output found
                  if (!obj && output.fixedCode) {
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
            }
          }

          // ========================================
          // RESPONSE PREPARATION
          // ========================================
          // Prepare the final response with fallback mechanisms
          const fallbackExplanation = finalText.trim();
          const finalFixedCode =
            obj?.fixedCode ?? lastValidatorOutput?.fixedCode ?? code;
          const finalExplanation =
            obj?.explanation ??
            (fallbackExplanation
              ? fallbackExplanation
              : 'Model did not return structured output. Refer to the transcript for details.');

          // Final validation of the proposed fix
          const validation = await validateMermaidCode(finalFixedCode);

          // Build attempts array for debugging and transparency
          const attempts = [] as Array<{
            fixedCode?: string;
            validated?: boolean;
            validationError?: string | null;
            explanation?: string;
          }>;

          if (obj) {
            attempts.push({
              fixedCode: obj.fixedCode,
              validated: validation.isValid,
              validationError: validation.error,
              explanation: obj.explanation,
            });
          } else if (lastValidatorOutput) {
            attempts.push({
              fixedCode: lastValidatorOutput.fixedCode,
              validated: lastValidatorOutput.validated,
              validationError: lastValidatorOutput.validationError,
              explanation: finalExplanation,
            });
          }

          // Count tool calls for monitoring
          const toolCallCount = steps.reduce(
            (count, currentStep) => count + currentStep.toolCalls.length,
            0
          );

          hasFinished = true;

          // ========================================
          // FINAL RESPONSE TRANSMISSION
          // ========================================
          // Send the complete result as the final streaming message
          const finalData =
            JSON.stringify({
              success: validation.isValid && Boolean(obj),
              isComplete: validation.isValid,
              fixedCode: finalFixedCode,
              explanation: finalExplanation,
              validated: validation.isValid,
              validationError: validation.error,
              step,
              attempts,
              toolCallCount,
              stepsCount: steps.length,
              usage: {
                totalTokens: totalUsage?.totalTokens,
                inputTokens: totalUsage?.inputTokens,
                outputTokens: totalUsage?.outputTokens,
              },
              finishReason,
            }) + '\n';

          console.log('steps count', steps.length);
          controller.enqueue(new TextEncoder().encode(finalData));
          controller.close();

          console.log('🧠 streamText: streaming completed');
        } catch (error) {
          // ========================================
          // ERROR HANDLING
          // ========================================
          // Handle any catastrophic errors during the streaming process
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

    // ========================================
    // STREAM RESPONSE CONFIGURATION
    // ========================================
    // Return the streaming response with appropriate headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    // ========================================
    // TOP-LEVEL ERROR HANDLING
    // ========================================
    // Handle any errors that occur outside the streaming context
    console.error('/api/agent error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;
