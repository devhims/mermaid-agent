import { createWorkersAI } from 'workers-ai-provider';
import { streamText, tool, stepCountIs } from 'ai';
import type {
  InferToolInput,
  InferToolOutput,
  StreamTextResult,
  TypedToolCall,
  TypedToolResult,
} from 'ai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { validateMermaidCode } from '../tools';

// Track tool call count for debugging
let toolCallCount = 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

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

const tools = { mermaidValidator };
type Tools = typeof tools;
type ValidatorInput = InferToolInput<typeof mermaidValidator>;
type ValidatorOutput = InferToolOutput<typeof mermaidValidator>;

type PotentialToolCallJson = {
  name: string;
  parameters?: unknown;
};

const isValidatorInput = (value: unknown): value is ValidatorInput =>
  isObject(value) &&
  typeof value.fixedCode === 'string' &&
  typeof value.explanation === 'string';

const isValidatorCall = (
  call: TypedToolCall<Tools>
): call is TypedToolCall<Tools> & {
  toolName: 'mermaidValidator';
  dynamic?: false | undefined;
  input: ValidatorInput;
} => call.toolName === 'mermaidValidator' && call.dynamic !== true;

const isValidatorResult = (
  result: TypedToolResult<Tools>
): result is TypedToolResult<Tools> & {
  toolName: 'mermaidValidator';
  dynamic?: false | undefined;
  output: ValidatorOutput;
} => result.toolName === 'mermaidValidator' && result.dynamic !== true;

const getValidatorArgsFromCall = (
  call: TypedToolCall<Tools>
): ValidatorInput | null => {
  if (isValidatorCall(call)) {
    return call.input;
  }
  if (isValidatorInput(call.input)) {
    return call.input;
  }
  return null;
};

const isPotentialToolCall = (
  value: unknown
): value is PotentialToolCallJson =>
  isObject(value) && typeof value.name === 'string';

const createNdjsonStream = (
  result: StreamTextResult<Tools, never>,
  logs: { start: string; complete: string; error: string }
) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        console.log(logs.start);

        let eventCount = 0;
        let accumulatedText = '';
        let hasFinished = false;

        const streamPromise = (async () => {
          for await (const event of result.fullStream) {
            if (hasFinished) break;

            eventCount++;
            console.log(
              `📡 Event #${eventCount}: ${event.type}`,
              event.type === 'text-delta' ? `"${event.text}"` : event
            );

            if (event.type === 'text-delta') {
              accumulatedText += event.text;

              const trimmed = accumulatedText.trim();
              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                const parsed = safeParseJson(trimmed);
                if (
                  isPotentialToolCall(parsed) &&
                  parsed.name === 'mermaidValidator' &&
                  isValidatorInput(parsed.parameters)
                ) {
                  console.log(
                    `🔧 Tool call #${eventCount}:`,
                    parsed.name,
                    parsed.parameters
                  );

                  const toolResult = await executeMermaidValidator(
                    parsed.parameters
                  );

                  const callData =
                    JSON.stringify({
                      type: 'tool-call',
                      count: eventCount,
                      toolName: parsed.name,
                      args: parsed.parameters,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(callData));

                  const resultData =
                    JSON.stringify({
                      type: 'tool-result',
                      count: eventCount,
                      toolName: parsed.name,
                      result: toolResult,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(resultData));

                  accumulatedText = '';
                }
              }

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
                event.input
              );

              let manualResult:
                | ValidatorOutput
                | { error: string }
                | null = null;

              if (event.toolName === 'mermaidValidator') {
                const validatorArgs = getValidatorArgsFromCall(event);
                if (validatorArgs) {
                  try {
                    manualResult = await executeMermaidValidator(validatorArgs);
                  } catch (error) {
                    console.error('Tool execution error:', error);
                    const errorMessage =
                      error instanceof Error
                        ? error.message
                        : 'Tool execution failed';
                    manualResult = { error: errorMessage };
                  }
                }
              }

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

              if (!event.providerExecuted && manualResult) {
                const manualResultData =
                  JSON.stringify({
                    type: 'tool-result',
                    count: eventCount,
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    providerExecuted: true,
                    result: manualResult,
                    timestamp: new Date().toISOString(),
                  }) + '\n';

                controller.enqueue(
                  new TextEncoder().encode(manualResultData)
                );
              }
            } else if (event.type === 'tool-result') {
              console.log(
                `✅ Tool result #${eventCount}:`,
                event.toolName,
                event.output
              );

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
              console.error(`❌ Error #${eventCount}:`, event.error);

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
              console.log(
                `🔇 Skipping internal event #${eventCount}: ${event.type}`
              );
            }
          }
        })();

        await streamPromise;

        console.log(logs.complete);
      } catch (error) {
        console.error(logs.error, error);
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
    tools,
    stopWhen: [
      stepCountIs(6), // Maximum 6 steps to prevent infinite loops
      ({ steps }) => {
        const lastStep = steps[steps.length - 1];
        if (!lastStep) return false;
        return lastStep.toolResults.some(
          (toolResult) =>
            isValidatorResult(toolResult) &&
            toolResult.output.validated === true
        );
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

  const stream = createNdjsonStream(result, {
    start: '🧠 Workers AI streaming with NDJSON: starting...',
    complete: '🧠 Workers AI streaming completed',
    error: '🧠 Workers AI streaming error:',
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
      tools,
      stopWhen: [
        stepCountIs(6), // Maximum 6 steps to prevent infinite loops
        ({ steps }) => {
          const lastStep = steps[steps.length - 1];
          if (!lastStep) return false;
          return lastStep.toolResults.some(
            (toolResult) =>
              isValidatorResult(toolResult) &&
              toolResult.output.validated === true
          );
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

    const stream = createNdjsonStream(result, {
      start: '🧠 Workers AI streaming with NDJSON: starting POST request...',
      complete: '🧠 Workers AI streaming completed',
      error: '🧠 Workers AI streaming error:',
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
