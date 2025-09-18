import { createWorkersAI } from 'workers-ai-provider';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { validateMermaidCode } from '../tools';

// Track tool call count for debugging
let toolCallCount = 0;

// Mermaid validator tool execute function
const executeMermaidValidator = async ({
  fixedCode,
  explanation,
}: {
  fixedCode: string;
  explanation: string;
}) => {
  toolCallCount++;
  console.log(`🔧 Tool call #${toolCallCount}: mermaidValidator`);
  console.log('📝 Explanation:', explanation.substring(0, 100) + '...');
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
};

// Mermaid validator tool for AI SDK
const mermaidValidator = tool({
  description:
    'Validate a candidate Mermaid code snippet with the real Mermaid parser and return validation status.',
  inputSchema: z.object({
    fixedCode: z.string().describe('The corrected Mermaid code'),
    explanation: z.string().describe('Explanation of what was fixed and why'),
  }),
  outputSchema: z.object({
    fixedCode: z.string(),
    explanation: z.string(),
    validated: z.boolean(),
    validationError: z.string().optional(),
  }),
  execute: executeMermaidValidator,
});

// Extremely challenging mermaid diagram with multiple complex syntax errors
const CHALLENGING_DIAGRAM = `graph TD
    A[Start] --> B{Decision}
    B --> |Yes| C[Process]
    B --> |No| D[End]

    %% Multiple severe syntax errors requiring step-by-step fixes:
    %% 1. Missing closing bracket AND invalid node reference
    E[Task] --> F[Next
    %% 2. Completely malformed node definition
    G H[Valid Node]
    %% 3. Invalid arrow syntax with extra characters
    H --> --> I[Another]
    %% 4. Wrong connection syntax entirely
    J[Final] === K[Broken]
    %% 5. Multiple issues: missing brackets, wrong syntax, extra spaces
    L Last Node   ---   M[End Node]
    %% 6. Invalid subgraph syntax
    subgraph SG[My Subgraph
        N[Sub Node] --> O[Another Sub]
    end
    %% 7. Malformed conditional edge
    P{Choice} -- |Option 1| Q[Path1]
    -- |Option 2| R[Path2
    -- |Default| S[Default]
`;

export async function GET() {
  const workersai = createWorkersAI({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID as string,
    apiKey: process.env.CLOUDFLARE_API_TOKEN as string,
  });

  // AI SDK iterative approach with manual tool execution for Workers AI
  console.log(
    '🔄 Starting AI-powered iterative mermaid fixing with manual tool handling'
  );

  const result = streamText({
    model: workersai('@cf/meta/llama-4-scout-17b-16e-instruct'),
    tools: { mermaidValidator }, // Pass tools parameter to streamText
    stopWhen: [
      stepCountIs(6), // Maximum 6 steps to prevent infinite loops
      ({ steps }) => {
        const lastStep = steps[steps.length - 1];
        return (lastStep?.toolResults || []).some((tr) => {
          const output = tr.output as { validated?: boolean };
          return output?.validated === true;
        });
      },
    ],
    onError: ({ error }) => {
      console.error('Workers AI Error during Mermaid fixing:', error);
    },
    system: `You are an expert at fixing Mermaid diagram syntax errors.

You have access to a mermaidValidator tool that can validate Mermaid code.

IMPORTANT: When you want to validate any Mermaid code, you MUST respond with a tool call in this EXACT format:
{"name": "mermaidValidator", "parameters": {"fixedCode": "the mermaid code here", "explanation": "what you changed"}}

Stream short status updates for each step. When validated: true is returned, do not make further tool calls, and announce success.`,
    prompt: `Fix this Mermaid diagram:

${CHALLENGING_DIAGRAM}

Use the mermaidValidator tool to validate your fix.`,
  });

  // Create a ReadableStream for NDJSON (Newline Delimited JSON) format
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('🧠 Workers AI streaming with NDJSON: starting...');

        let eventCount = 0;
        let accumulatedText = '';
        let hasFinished = false;

        // Stream all events including tool calls and text deltas
        const streamPromise = (async () => {
          for await (const event of result.fullStream) {
            if (hasFinished) break; // Stop if we've already sent completion

            eventCount++;
            console.log(
              `📡 Event #${eventCount}: ${event.type}`,
              event.type === 'text-delta' ? `"${event.text}"` : event
            );

            // Handle all event types
            if (event.type === 'text-delta') {
              console.log(`📝 Text delta #${eventCount}: "${event.text}"`);
              accumulatedText += event.text;

              // Check if accumulated text contains a complete JSON tool call
              let toolDetected = false;
              if (
                accumulatedText.trim().startsWith('{') &&
                accumulatedText.trim().endsWith('}')
              ) {
                try {
                  const potentialJson = JSON.parse(accumulatedText.trim());
                  if (
                    potentialJson.name === 'mermaidValidator' &&
                    potentialJson.parameters
                  ) {
                    console.log(
                      `🔧 Tool call #${eventCount}:`,
                      potentialJson.name,
                      potentialJson.parameters
                    );

                    // Execute the tool manually
                    const toolResult = await executeMermaidValidator(
                      potentialJson.parameters
                    );

                    // Send tool call event
                    const callData =
                      JSON.stringify({
                        type: 'tool-call',
                        count: eventCount,
                        toolName: potentialJson.name,
                        args: potentialJson.parameters,
                        timestamp: new Date().toISOString(),
                      }) + '\n';

                    controller.enqueue(new TextEncoder().encode(callData));

                    // Send tool result event
                    const resultData =
                      JSON.stringify({
                        type: 'tool-result',
                        count: eventCount,
                        toolName: potentialJson.name,
                        result: toolResult,
                        timestamp: new Date().toISOString(),
                      }) + '\n';

                    controller.enqueue(new TextEncoder().encode(resultData));

                    // Clear accumulated text after processing tool call
                    accumulatedText = '';
                    toolDetected = true;
                  }
                } catch (error) {
                  // Not a complete/valid JSON yet, continue accumulating
                }
              }

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

              // Since workers-ai-provider doesn't execute tools, we need to do it manually
              try {
                if (event.toolName === 'mermaidValidator') {
                  const args = (event as any).input || (event as any).args;
                  const toolResult = await executeMermaidValidator(args);

                  // Patch the result for the AI SDK
                  (event as any).result = toolResult;
                }
              } catch (error) {
                console.error('Tool execution error:', error);
                (event as any).result = {
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Tool execution failed',
                };
              }

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
              hasFinished = true;
              controller.close();
              break;
            } else {
              // Skip internal AI SDK events that don't matter for UI updates
              console.log(
                `🔇 Skipping internal event #${eventCount}: ${event.type}`
              );
            }
          }
        })();

        // Wait for the stream to complete
        await streamPromise;

        console.log('🧠 Workers AI streaming completed');
      } catch (error) {
        console.error('🧠 Workers AI streaming error:', error);
        const errorData =
          JSON.stringify({
            type: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unknown streaming error',
            timestamp: new Date().toISOString(),
          }) + '\n';

        controller.enqueue(new TextEncoder().encode(errorData));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// Request schema for POST requests
const RequestSchema = z.object({
  code: z.string(),
  error: z.string().nullable(),
  step: z.number().default(1),
});

// POST handler for UI integration (similar to @agent/)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, error, step } = RequestSchema.parse(body);

    const workersai = createWorkersAI({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID as string,
      apiKey: process.env.CLOUDFLARE_API_TOKEN as string,
    });

    // Validate original code first
    const initialValidation = await validateMermaidCode(code);
    if (initialValidation.isValid) {
      // Return early if code is already valid
      const successResponse =
        JSON.stringify({
          success: true,
          isComplete: true,
          fixedCode: code,
          explanation: 'Code is already valid. No changes required.',
          validated: true,
          step,
        }) + '\n';

      return new Response(successResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }

    const actualError =
      initialValidation.error || error || 'Unknown validation error';

    // Reset tool call count for this request
    toolCallCount = 0;

    console.log(
      '🔄 Workers AI iterative mermaid fixing: starting POST request'
    );

    const result = streamText({
      model: workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
      tools: { mermaidValidator }, // Pass tools parameter to streamText
      stopWhen: [
        stepCountIs(6), // Maximum 6 steps to prevent infinite loops
        ({ steps }) => {
          const lastStep = steps[steps.length - 1];
          return (lastStep?.toolResults || []).some((tr) => {
            const output = tr.output as { validated?: boolean };
            return output?.validated === true;
          });
        },
      ],
      onError: ({ error }) => {
        console.error('Workers AI Error during Mermaid fixing:', error);
      },
      system: `You are an expert at fixing Mermaid diagram syntax errors.

You have access to a mermaidValidator tool that can validate Mermaid code.

IMPORTANT: When you want to validate any Mermaid code, you MUST respond with a tool call in this EXACT format:
{"name": "mermaidValidator", "parameters": {"fixedCode": "the mermaid code here", "explanation": "what you changed"}}

Stream short status updates for each step. When validated: true is returned, do not make further tool calls, and announce success.`,
      prompt: `Fix this Mermaid diagram:

${code}

Parser Error: ${actualError}

Use the mermaidValidator tool to validate your fix.`,
    });

    // Create a ReadableStream for NDJSON (Newline Delimited JSON) format
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(
            '🧠 Workers AI streaming with NDJSON: starting POST request...'
          );

          let eventCount = 0;
          let accumulatedText = '';
          let hasFinished = false;

          // Stream all events including tool calls and text deltas
          const streamPromise = (async () => {
            for await (const event of result.fullStream) {
              if (hasFinished) break; // Stop if we've already sent completion

              eventCount++;
              console.log(
                `📡 Event #${eventCount}: ${event.type}`,
                event.type === 'text-delta' ? `"${event.text}"` : event
              );

              // Handle all event types
              if (event.type === 'text-delta') {
                console.log(`📝 Text delta #${eventCount}: "${event.text}"`);
                accumulatedText += event.text;

                // Check if accumulated text contains a complete JSON tool call
                let toolDetected = false;
                if (
                  accumulatedText.trim().startsWith('{') &&
                  accumulatedText.trim().endsWith('}')
                ) {
                  try {
                    const potentialJson = JSON.parse(accumulatedText.trim());
                    if (
                      potentialJson.name === 'mermaidValidator' &&
                      potentialJson.parameters
                    ) {
                      console.log(
                        `🔧 Tool call #${eventCount}:`,
                        potentialJson.name,
                        potentialJson.parameters
                      );

                      // Execute the tool manually
                      const toolResult = await executeMermaidValidator(
                        potentialJson.parameters
                      );

                      // Send tool call event
                      const callData =
                        JSON.stringify({
                          type: 'tool-call',
                          count: eventCount,
                          toolName: potentialJson.name,
                          args: potentialJson.parameters,
                          timestamp: new Date().toISOString(),
                        }) + '\n';

                      controller.enqueue(new TextEncoder().encode(callData));

                      // Send tool result event
                      const resultData =
                        JSON.stringify({
                          type: 'tool-result',
                          count: eventCount,
                          toolName: potentialJson.name,
                          result: toolResult,
                          timestamp: new Date().toISOString(),
                        }) + '\n';

                      controller.enqueue(new TextEncoder().encode(resultData));

                      // Clear accumulated text after processing tool call
                      accumulatedText = '';
                      toolDetected = true;
                    }
                  } catch (error) {
                    // Not a complete/valid JSON yet, continue accumulating
                  }
                }

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

                // Since workers-ai-provider doesn't execute tools, we need to do it manually
                try {
                  if (event.toolName === 'mermaidValidator') {
                    const args = (event as any).input || (event as any).args;
                    const toolResult = await executeMermaidValidator(args);

                    // Patch the result for the AI SDK
                    (event as any).result = toolResult;
                  }
                } catch (error) {
                  console.error('Tool execution error:', error);
                  (event as any).result = {
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Tool execution failed',
                  };
                }

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
                hasFinished = true;
                controller.close();
                break;
              } else {
                // Skip internal AI SDK events that don't matter for UI updates
                console.log(
                  `🔇 Skipping internal event #${eventCount}: ${event.type}`
                );
              }
            }
          })();

          // Wait for the stream to complete
          await streamPromise;

          console.log('🧠 Workers AI streaming completed');
        } catch (error) {
          console.error('🧠 Workers AI streaming error:', error);
          const errorData =
            JSON.stringify({
              type: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown streaming error',
              timestamp: new Date().toISOString(),
            }) + '\n';

          controller.enqueue(new TextEncoder().encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Workers AI POST error:', error);
    return new Response(
      JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
