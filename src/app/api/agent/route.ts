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

const ExplanationSchema = z.union([z.string(), z.array(z.string())]);

// Response schema - defines the shape returned by this API
const ResponseSchema = z.object({
  success: z.boolean(),
  isComplete: z.boolean(),
  fixedCode: z.string().optional(),
  validated: z.boolean().optional(),
  validationError: z.string().optional(),
  explanation: ExplanationSchema.optional(),
  message: z.string().optional(),
  step: z.number().optional(),
  attempts: z
    .array(
      z.object({
        fixedCode: z.string().optional(),
        validated: z.boolean().optional(),
        validationError: z.string().optional(),
        explanation: ExplanationSchema.optional(),
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
      explanation: ExplanationSchema.describe(
        'Explanation of the changes made to fix the diagram'
      ),
    });
    type FixProposal = z.infer<typeof ObjectSchema>;

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
        hints: z.string().optional(),
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
          hints: validation.hints,
        };
      },
    });

    const tools = { mermaidValidator };

    // ========================================
    // AI STREAM TEXT CONFIGURATION
    // ========================================
    // Configure the AI model with tools, structured output, and step limits
    const result = streamText({
      model: openai('gpt-4.1-mini'),
      tools,
      prepareStep({ messages }) {
        // Compact the transcript before each turn so we only resend the
        // freshest tool result while keeping relevant conversational context.
        // console.log('🔍 Prepare step:', messages);

        if (!Array.isArray(messages) || messages.length === 0) {
          return { messages };
        }

        const isRecordMessage = (
          msg: unknown
        ): msg is Record<string, unknown> =>
          typeof msg === 'object' && msg !== null;

        // Helper to detect assistant messages that bundle tool-call metadata.
        const hasToolCallContent = (msg: unknown) => {
          if (!isRecordMessage(msg)) {
            return false;
          }

          const content = msg.content;
          if (!Array.isArray(content)) {
            return false;
          }

          return content.some(
            (item: unknown) =>
              isRecordMessage(item) && item.type === 'tool-call'
          );
        };

        const lastToolIndexFromEnd = [...messages]
          .reverse()
          .findIndex((msg) => isRecordMessage(msg) && msg.role === 'tool');

        if (lastToolIndexFromEnd === -1) {
          return { messages };
        }

        const absoluteLastToolIndex =
          messages.length - 1 - lastToolIndexFromEnd;

        // Find the assistant message that triggered the tool result we kept so
        // we can prune older tool-call attempts while leaving other dialog.
        const lastAssistantToolIndexFromEnd = [...messages]
          .slice(0, absoluteLastToolIndex)
          .reverse()
          .findIndex((msg) => hasToolCallContent(msg));

        const absoluteLastAssistantToolIndex =
          lastAssistantToolIndexFromEnd === -1
            ? -1
            : absoluteLastToolIndex - 1 - lastAssistantToolIndexFromEnd;

        const filteredMessages = messages.filter((msg, index) => {
          if (!isRecordMessage(msg)) {
            return true;
          }

          // Keep the most recent tool payload so the model can see the latest
          // validator feedback; older tool outputs are dropped to save tokens
          // and to avoid dangling tool-call references the API will reject.
          if (msg.role === 'tool') {
            return index === absoluteLastToolIndex;
          }

          if (
            hasToolCallContent(msg) &&
            index < absoluteLastAssistantToolIndex
          ) {
            return false;
          }

          return true;
        });

        // console.log('🔍 Filtered messages:', filteredMessages);
        return { messages: filteredMessages };
      },
      experimental_output: Output.object({
        schema: ObjectSchema,
      }),
      // Allow the model to emit a final structured object after a tool pass; cap total steps
      stopWhen: stepCountIs(5),
      system: `<role>
You are a meticulous Mermaid diagram fixer for a code validation agent.
</role>
<objective>
- Repair every parser error you encounter, including multiple simultaneous issues.
- Preserve the original intent of the diagram with minimal, targeted edits.
- When the validator returns hints, prioritize fixing issues mentioned in the hints before trying other edits
</objective>
<tool_use>
- Call mermaidValidator to check each candidate fix before returning the final answer; when validation fails, analyze the new error and adjust your fix.
</tool_use>
<workflow>
- After each candidate change, call mermaidValidator.
- If mermaidValidator returns validated=true, you may stop but MUST still return a structured object with a bullet list explanation covering all edits made.
- If validation fails, iterate with one targeted fix per attempt.
- If you must stop without a valid diagram, clearly state what blocked you.
</workflow>
<output>
- Return a structured object containing fixedCode and explanation.
- Provide explanation as a concise Markdown bullet list where each bullet names a specific fix or remaining blocker.
- Ensure every code change is represented by its own bullet; never combine multiple fixes into a single bullet. If nothing changed, state that explicitly.
- Avoid redundant narration or status updates outside the required list.
</output>`,
      prompt: `Fix this Mermaid diagram. Provide a minimal fix.

Current Code:
\`\`\`
${code}
\`\`\`

Parser Error:
${actualError}`,
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

          const partialOutputIterator = result.experimental_partialOutputStream;
          const structuredOutputPromise: Promise<FixProposal | null> =
            partialOutputIterator
              ? (async () => {
                  let last: FixProposal | null = null;
                  try {
                    for await (const partial of partialOutputIterator) {
                      if (partial && typeof partial === 'object') {
                        last = partial as FixProposal;

                        //console.log('🔍 Partial output:', last);

                        const data =
                          JSON.stringify({
                            type: 'structured-output',
                            count: ++eventCount,
                            output: last,
                            timestamp: new Date().toISOString(),
                          }) + '\n';

                        controller.enqueue(new TextEncoder().encode(data));
                      }
                    }
                  } catch (streamError) {
                    console.warn(
                      'Failed reading experimental_partialOutputStream:',
                      streamError
                    );
                  }
                  return last;
                })()
              : Promise.resolve(null);

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

          const [finalText, totalUsage, finishReason, steps, structuredOutput] =
            await Promise.all([
              result.text,
              result.totalUsage,
              result.finishReason,
              result.steps,
              structuredOutputPromise,
            ]);

          console.log('🧠 streamText: completed');

          // ========================================
          // STRUCTURED OUTPUT EXTRACTION
          // ========================================
          // Attempt to extract the structured fix proposal from various sources
          let obj: FixProposal | null = structuredOutput ?? null;

          if (obj) {
            console.log(
              'Got structured object from experimental_partialOutputStream:',
              obj
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
                  // Prefer structured object; if missing, fall back but keep explanation high-quality
                  if (!obj && output.fixedCode) {
                    obj = {
                      fixedCode: output.fixedCode,
                      explanation: [
                        'Validated the final candidate with the Mermaid parser (no syntax errors).',
                        ...(output.hints
                          ? [
                              'Addressed issues based on validator hints as needed.',
                            ]
                          : []),
                      ],
                    } as unknown as FixProposal;
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
            explanation?: string | string[];
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
