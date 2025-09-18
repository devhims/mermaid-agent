import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// Helper function to simulate tool execution
const executeTool = async (toolName: string, args: any) => {
  if (toolName === 'mermaid_validator') {
    const { validateMermaidCode } = await import('../tools');
    const validation = await validateMermaidCode(args.code);
    return {
      isValid: validation.isValid,
      error: validation.error,
      message: validation.isValid
        ? 'Mermaid code is valid'
        : `Mermaid validation failed: ${validation.error}`,
    };
  }
  return { error: `Unknown tool: ${toolName}` };
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

    // Extract the response content, tool calls, and structured output from the Responses API format
    let content = '';
    let toolCalls = [];
    let toolResults = [];
    let attempts = [];
    let structuredOutput = null;

    if (data.output && Array.isArray(data.output)) {
      // Process each output item
      for (const item of data.output) {
        if (item.type === 'message' && item.role === 'assistant') {
          // Extract text content
          if (item.content && Array.isArray(item.content)) {
            const textContent = item.content.find(
              (c: any) => c.type === 'output_text'
            );
            if (textContent?.text) {
              content += textContent.text;

              // Try to parse as JSON for structured output
              // Handle both direct JSON and markdown-wrapped JSON
              let jsonText = textContent.text.trim();

              // Remove markdown code blocks if present
              if (jsonText.startsWith('```json') && jsonText.endsWith('```')) {
                jsonText = jsonText.slice(7, -3).trim();
              } else if (
                jsonText.startsWith('```') &&
                jsonText.endsWith('```')
              ) {
                jsonText = jsonText.slice(3, -3).trim();
              }

              try {
                const parsed = JSON.parse(jsonText);
                if (parsed.fixedCode && parsed.explanation) {
                  structuredOutput = parsed;
                }
              } catch (e) {
                // Not JSON, use as plain text
              }
            }

            // Extract function calls
            const functionCallContent = item.content.find(
              (c: any) => c.type === 'function_call'
            );
            if (functionCallContent) {
              const toolCall = {
                id: functionCallContent.call_id,
                function: {
                  name: functionCallContent.name,
                  arguments: functionCallContent.arguments,
                },
              };
              toolCalls.push(toolCall);

              // Execute the tool and add result
              try {
                let args = {};
                if (toolCall.function.arguments) {
                  args = JSON.parse(toolCall.function.arguments);
                }
                const result = await executeTool(toolCall.function.name, args);

                // Track attempts for agent-like behavior
                if (result.isValid !== undefined) {
                  attempts.push({
                    fixedCode: (args as any).code,
                    validated: result.isValid,
                    validationError: result.error,
                    explanation: result.isValid
                      ? 'Validation passed'
                      : `Validation failed: ${result.error}`,
                  });
                }

                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: result,
                });
              } catch (error) {
                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: { error: 'Tool execution failed' },
                });
              }
            }
          }
        } else if (item.type === 'function_call') {
          // Direct function call in output array
          const toolCall = {
            id: item.call_id,
            function: {
              name: item.name,
              arguments: item.arguments,
            },
          };
          toolCalls.push(toolCall);

          // Execute the tool and add result
          try {
            let args = {};
            if (toolCall.function.arguments) {
              args = JSON.parse(toolCall.function.arguments);
            }
            const result = await executeTool(toolCall.function.name, args);

            // Track attempts for agent-like behavior
            if (result.isValid !== undefined) {
              attempts.push({
                fixedCode: (args as any).code,
                validated: result.isValid,
                validationError: result.error,
                explanation: result.isValid
                  ? 'Validation passed'
                  : `Validation failed: ${result.error}`,
              });
            }

            toolResults.push({
              tool_call_id: toolCall.id,
              content: result,
            });
          } catch (error) {
            toolResults.push({
              tool_call_id: toolCall.id,
              content: { error: 'Tool execution failed' },
            });
          }
        } else if (item.type === 'function_call_output') {
          // Extract function results
          toolResults.push({
            tool_call_id: item.call_id,
            content: item.output,
          });
        }
      }
    }

    // Fallback to other possible locations
    if (!content) {
      content = data.result?.response || data.response || '';
    }

    // Determine the final result from attempts
    let finalResult = null;
    if (attempts.length > 0) {
      // Find the first successful validation or the last attempt
      const successfulAttempt = attempts.find((attempt) => attempt.validated);
      if (successfulAttempt) {
        finalResult = successfulAttempt;
      } else {
        // Use the last attempt as the final result
        finalResult = attempts[attempts.length - 1];
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        model: '@cf/openai/gpt-oss-20b',
        response: content,
        structuredOutput,
        hasStructuredOutput: structuredOutput !== null,
        toolCalls,
        toolResults,
        attempts,
        hasToolCalls: toolCalls.length > 0,
        hasAttempts: attempts.length > 0,
        finalResult,
        isComplete: finalResult?.validated || false,
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

    // Extract the response content, tool calls, and structured output from the Responses API format
    let content = '';
    let toolCalls = [];
    let toolResults = [];
    let attempts = [];
    let structuredOutput = null;

    if (data.output && Array.isArray(data.output)) {
      // Process each output item
      for (const item of data.output) {
        if (item.type === 'message' && item.role === 'assistant') {
          // Extract text content
          if (item.content && Array.isArray(item.content)) {
            const textContent = item.content.find(
              (c: any) => c.type === 'output_text'
            );
            if (textContent?.text) {
              content += textContent.text;

              // Try to parse as JSON for structured output
              // Handle both direct JSON and markdown-wrapped JSON
              let jsonText = textContent.text.trim();

              // Remove markdown code blocks if present
              if (jsonText.startsWith('```json') && jsonText.endsWith('```')) {
                jsonText = jsonText.slice(7, -3).trim();
              } else if (
                jsonText.startsWith('```') &&
                jsonText.endsWith('```')
              ) {
                jsonText = jsonText.slice(3, -3).trim();
              }

              try {
                const parsed = JSON.parse(jsonText);
                if (parsed.fixedCode && parsed.explanation) {
                  structuredOutput = parsed;
                }
              } catch (e) {
                // Not JSON, use as plain text
              }
            }

            // Extract function calls
            const functionCallContent = item.content.find(
              (c: any) => c.type === 'function_call'
            );
            if (functionCallContent) {
              const toolCall = {
                id: functionCallContent.call_id,
                function: {
                  name: functionCallContent.name,
                  arguments: functionCallContent.arguments,
                },
              };
              toolCalls.push(toolCall);

              // Execute the tool and add result
              try {
                let args = {};
                if (toolCall.function.arguments) {
                  args = JSON.parse(toolCall.function.arguments);
                }
                const result = await executeTool(toolCall.function.name, args);

                // Track attempts for agent-like behavior
                if (result.isValid !== undefined) {
                  attempts.push({
                    fixedCode: (args as any).code,
                    validated: result.isValid,
                    validationError: result.error,
                    explanation: result.isValid
                      ? 'Validation passed'
                      : `Validation failed: ${result.error}`,
                  });
                }

                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: result,
                });
              } catch (error) {
                toolResults.push({
                  tool_call_id: toolCall.id,
                  content: { error: 'Tool execution failed' },
                });
              }
            }
          }
        } else if (item.type === 'function_call') {
          // Direct function call in output array
          const toolCall = {
            id: item.call_id,
            function: {
              name: item.name,
              arguments: item.arguments,
            },
          };
          toolCalls.push(toolCall);

          // Execute the tool and add result
          try {
            let args = {};
            if (toolCall.function.arguments) {
              args = JSON.parse(toolCall.function.arguments);
            }
            const result = await executeTool(toolCall.function.name, args);

            // Track attempts for agent-like behavior
            if (result.isValid !== undefined) {
              attempts.push({
                fixedCode: (args as any).code,
                validated: result.isValid,
                validationError: result.error,
                explanation: result.isValid
                  ? 'Validation passed'
                  : `Validation failed: ${result.error}`,
              });
            }

            toolResults.push({
              tool_call_id: toolCall.id,
              content: result,
            });
          } catch (error) {
            toolResults.push({
              tool_call_id: toolCall.id,
              content: { error: 'Tool execution failed' },
            });
          }
        } else if (item.type === 'function_call_output') {
          // Extract function results
          toolResults.push({
            tool_call_id: item.call_id,
            content: item.output,
          });
        }
      }
    }

    // Fallback to other possible locations
    if (!content) {
      content = data.result?.response || data.response || '';
    }

    // Determine the final result from attempts
    let finalResult = null;
    if (attempts.length > 0) {
      // Find the first successful validation or the last attempt
      const successfulAttempt = attempts.find((attempt) => attempt.validated);
      if (successfulAttempt) {
        finalResult = successfulAttempt;
      } else {
        // Use the last attempt as the final result
        finalResult = attempts[attempts.length - 1];
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        model: '@cf/openai/gpt-oss-20b',
        response: content,
        structuredOutput,
        hasStructuredOutput: structuredOutput !== null,
        toolCalls,
        toolResults,
        attempts,
        hasToolCalls: toolCalls.length > 0,
        hasAttempts: attempts.length > 0,
        finalResult,
        isComplete: finalResult?.validated || false,
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
