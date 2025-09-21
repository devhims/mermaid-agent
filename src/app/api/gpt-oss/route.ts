import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

type MermaidValidatorArgs = { code: string };
type StructuredOutput = { fixedCode: string; explanation: string };
type Attempt = {
  fixedCode?: string;
  validated?: boolean;
  validationError?: string | null;
  explanation?: string;
};
type ToolCallRecord = {
  id: string;
  function: {
    name: string;
    arguments?: string;
  };
};
type ToolResultRecord = {
  tool_call_id: string;
  content: unknown;
};
type ProcessedResponsesData = {
  content: string;
  structuredOutput: StructuredOutput | null;
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  attempts: Attempt[];
  finalResult: Attempt | null;
  isComplete: boolean;
};

type ValidationToolResult = {
  type: 'validation';
  isValid: boolean;
  error: string | null;
  message: string;
};
type ErrorToolResult = {
  type: 'error';
  error: string;
};
type ToolExecutionResult = ValidationToolResult | ErrorToolResult;

type OutputTextContent = { type: 'output_text'; text: string };
type FunctionCallContent = {
  type: 'function_call';
  call_id?: string;
  name: string;
  arguments?: string;
};
type FunctionCallOutput = {
  type: 'function_call_output';
  call_id?: string;
  output?: unknown;
};
type ResponseMessageItem = {
  type: 'message';
  role: string;
  content?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMermaidValidatorArgs = (
  value: unknown
): value is MermaidValidatorArgs =>
  isObject(value) && typeof value.code === 'string';

const isStructuredOutput = (value: unknown): value is StructuredOutput =>
  isObject(value) &&
  typeof value.fixedCode === 'string' &&
  typeof value.explanation === 'string';

const isOutputTextContent = (
  value: unknown
): value is OutputTextContent =>
  isObject(value) &&
  value.type === 'output_text' &&
  typeof value.text === 'string';

const isFunctionCallContent = (
  value: unknown
): value is FunctionCallContent =>
  isObject(value) &&
  value.type === 'function_call' &&
  typeof value.name === 'string';

const isFunctionCallOutput = (
  value: unknown
): value is FunctionCallOutput =>
  isObject(value) && value.type === 'function_call_output';

const isResponseMessageItem = (
  value: unknown
): value is ResponseMessageItem =>
  isObject(value) &&
  value.type === 'message' &&
  typeof value.role === 'string';

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const createToolCallRecord = (
  content: FunctionCallContent,
  fallbackIndex: number
): ToolCallRecord => ({
  id: content.call_id ?? `call-${fallbackIndex}`,
  function: {
    name: content.name,
    arguments: content.arguments,
  },
});

const executeTool = async (
  toolName: string,
  args: unknown
): Promise<ToolExecutionResult> => {
  if (toolName === 'mermaid_validator') {
    if (!isMermaidValidatorArgs(args)) {
      return { type: 'error', error: 'Invalid arguments for mermaid_validator' };
    }

    const { validateMermaidCode } = await import('../tools');
    const validation = await validateMermaidCode(args.code);
    const errorMessage = validation.error ?? null;
    return {
      type: 'validation',
      isValid: validation.isValid,
      error: errorMessage,
      message: validation.isValid
        ? 'Mermaid code is valid'
        : `Mermaid validation failed: ${errorMessage ?? 'unknown error'}`,
    };
  }

  return { type: 'error', error: `Unknown tool: ${toolName}` };
};

const executeToolCall = async (
  toolCall: ToolCallRecord
): Promise<{ result: ToolExecutionResult; attempt: Attempt | null }> => {
  const parsedArgs =
    typeof toolCall.function.arguments === 'string'
      ? safeParseJson(toolCall.function.arguments)
      : null;

  const validatorArgs = isMermaidValidatorArgs(parsedArgs)
    ? parsedArgs
    : null;

  const result = await executeTool(
    toolCall.function.name,
    validatorArgs ?? parsedArgs
  );

  if (result.type === 'validation' && validatorArgs) {
    const attempt: Attempt = {
      fixedCode: validatorArgs.code,
      validated: result.isValid,
      validationError: result.error,
      explanation: result.isValid
        ? 'Validation passed'
        : `Validation failed: ${result.error ?? 'Unknown error'}`,
    };
    return { result, attempt };
  }

  return { result, attempt: null };
};

const getNestedString = (value: unknown, path: string[]): string | null => {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' ? current : null;
};

const processResponsesApiData = async (
  data: unknown
): Promise<ProcessedResponsesData> => {
  let content = '';
  let structuredOutput: StructuredOutput | null = null;
  const toolCalls: ToolCallRecord[] = [];
  const toolResults: ToolResultRecord[] = [];
  const attempts: Attempt[] = [];

  if (isObject(data) && Array.isArray(data.output)) {
    for (const rawItem of data.output as unknown[]) {
      if (isResponseMessageItem(rawItem) && rawItem.role === 'assistant') {
        const contentItems = Array.isArray(rawItem.content)
          ? (rawItem.content as unknown[])
          : [];

        for (const item of contentItems) {
          if (isOutputTextContent(item)) {
            content += item.text;

            let jsonText = item.text.trim();
            if (jsonText.startsWith('```json') && jsonText.endsWith('```')) {
              jsonText = jsonText.slice(7, -3).trim();
            } else if (
              jsonText.startsWith('```') &&
              jsonText.endsWith('```')
            ) {
              jsonText = jsonText.slice(3, -3).trim();
            }

            const parsed = safeParseJson(jsonText);
            if (isStructuredOutput(parsed)) {
              structuredOutput = parsed;
            }
          } else if (isFunctionCallContent(item)) {
            const toolCall = createToolCallRecord(item, toolCalls.length + 1);
            toolCalls.push(toolCall);
            const { result, attempt } = await executeToolCall(toolCall);
            if (attempt) attempts.push(attempt);
            toolResults.push({
              tool_call_id: toolCall.id,
              content: result,
            });
          }
        }
      } else if (isFunctionCallContent(rawItem)) {
        const toolCall = createToolCallRecord(rawItem, toolCalls.length + 1);
        toolCalls.push(toolCall);
        const { result, attempt } = await executeToolCall(toolCall);
        if (attempt) attempts.push(attempt);
        toolResults.push({
          tool_call_id: toolCall.id,
          content: result,
        });
      } else if (isFunctionCallOutput(rawItem)) {
        toolResults.push({
          tool_call_id: rawItem.call_id ?? `call-${toolResults.length + 1}`,
          content: rawItem.output,
        });
      }
    }
  }

  if (!content) {
    content =
      getNestedString(data, ['result', 'response']) ??
      getNestedString(data, ['response']) ??
      '';
  }

  const successfulAttempt = attempts.find((attempt) => attempt.validated);
  const fallbackAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const finalResult = successfulAttempt ?? fallbackAttempt ?? null;

  return {
    content,
    structuredOutput,
    toolCalls,
    toolResults,
    attempts,
    finalResult,
    isComplete: Boolean(finalResult?.validated),
  };
};

// Test GPT-OSS using Cloudflare Responses API directly
export async function GET() {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: '@cf/openai/gpt-oss-20b',
          input: [
            {
              role: 'user',
              content: `You are an expert Mermaid diagram fixer. Fix this diagram using these steps:

1. Use the mermaid_validator tool to validate the current code
2. If validation fails, propose a minimal fix and validate it again
3. Continue until you find a valid fix or reach 10 attempts
4. Report the results of your validation attempts

Current Code:
\`\`\`
graph TD A-- B
\`\`\`

Note: GPT-OSS models on Cloudflare Workers AI do not currently support structured outputs/JSON mode. Use the mermaid_validator tool to validate your fixes.`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'mermaid_fix_response',
              schema: {
                type: 'object',
                properties: {
                  fixedCode: {
                    type: 'string',
                    description: 'Minimally changed Mermaid code proposal',
                  },
                  explanation: {
                    type: 'string',
                    description: 'Short explanation of the changes',
                  },
                },
                required: ['fixedCode', 'explanation'],
              },
              strict: true,
            },
          },
          tools: [
            {
              type: 'function',
              name: 'mermaid_validator',
              description:
                'Validate Mermaid diagram syntax and return validation results',
              parameters: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description: 'The Mermaid code to validate',
                  },
                },
                required: ['code'],
              },
              strict: null,
            },
          ],
          tool_choice: 'auto',
          max_tokens: 100,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      return new Response(
        JSON.stringify({
          success: false,
          model: '@cf/openai/gpt-oss-20b',
          error: `API request failed: ${response.status} ${response.statusText}`,
          responseBody: errorData,
          api: 'responses-api',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const processed = await processResponsesApiData(data);

    return new Response(
      JSON.stringify({
        success: true,
        model: '@cf/openai/gpt-oss-20b',
        response: processed.content,
        structuredOutput: processed.structuredOutput,
        hasStructuredOutput: processed.structuredOutput !== null,
        toolCalls: processed.toolCalls,
        toolResults: processed.toolResults,
        attempts: processed.attempts,
        hasToolCalls: processed.toolCalls.length > 0,
        hasAttempts: processed.attempts.length > 0,
        finalResult: processed.finalResult,
        isComplete: processed.isComplete,
        api: 'responses-api',
        rawResponse: data,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        model: '@cf/openai/gpt-oss-20b',
        error: error instanceof Error ? error.message : 'Error',
        api: 'responses-api',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// POST endpoint for testing with dynamic prompts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, code } = body;

    // Use provided code or default to invalid Mermaid for testing
    const testCode = code || 'graph TD A-- B';
    const testPrompt =
      prompt ||
      `You are an expert Mermaid diagram fixer. Fix this diagram using these steps:

1. Use the mermaid_validator tool to validate the current code
2. If validation fails, propose a minimal fix and validate it again
3. Continue until you find a valid fix or reach 10 attempts
4. Report the results of your validation attempts

Current Code:
\`\`\`
${testCode}
\`\`\`

Note: GPT-OSS models on Cloudflare Workers AI do not currently support structured outputs/JSON mode. Use the mermaid_validator tool to validate your fixes.`;

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: '@cf/openai/gpt-oss-20b',
          input: [
            {
              role: 'user',
              content: testPrompt,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'mermaid_fix_response',
              schema: {
                type: 'object',
                properties: {
                  fixedCode: {
                    type: 'string',
                    description: 'Minimally changed Mermaid code proposal',
                  },
                  explanation: {
                    type: 'string',
                    description: 'Short explanation of the changes',
                  },
                },
                required: ['fixedCode', 'explanation'],
              },
              strict: true,
            },
          },
          tools: [
            {
              type: 'function',
              name: 'mermaid_validator',
              description:
                'Validate Mermaid diagram syntax and return validation results',
              parameters: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description: 'The Mermaid code to validate',
                  },
                },
                required: ['code'],
              },
              strict: null,
            },
          ],
          tool_choice: 'auto',
          max_tokens: 100,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      return new Response(
        JSON.stringify({
          success: false,
          model: '@cf/openai/gpt-oss-20b',
          error: `API request failed: ${response.status} ${response.statusText}`,
          responseBody: errorData,
          api: 'responses-api',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const processed = await processResponsesApiData(data);

    return new Response(
      JSON.stringify({
        success: true,
        model: '@cf/openai/gpt-oss-20b',
        response: processed.content,
        structuredOutput: processed.structuredOutput,
        hasStructuredOutput: processed.structuredOutput !== null,
        toolCalls: processed.toolCalls,
        toolResults: processed.toolResults,
        attempts: processed.attempts,
        hasToolCalls: processed.toolCalls.length > 0,
        hasAttempts: processed.attempts.length > 0,
        finalResult: processed.finalResult,
        isComplete: processed.isComplete,
        api: 'responses-api',
        rawResponse: data,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        model: '@cf/openai/gpt-oss-20b',
        error: error instanceof Error ? error.message : 'Error',
        api: 'responses-api',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
