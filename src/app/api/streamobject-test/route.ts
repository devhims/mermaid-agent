import { openai } from '@ai-sdk/openai';
import { streamText, tool, Output, stepCountIs } from 'ai';
import { z } from 'zod';
import { NextRequest } from 'next/server';

/**
 * Test route for AI SDK v5 streamText API with tool calling and structured output
 *
 * This route demonstrates using streamText with tools AND experimental_output for
 * structured object results. The model calls tools during generation and the final
 * result is a structured object that includes tool results.
 */

const RecipeSchema = z.object({
  recipe: z.object({
    name: z.string(),
    ingredients: z.array(z.string()),
    steps: z.array(z.string()),
    nutritionalInfo: z
      .object({
        calories: z.number(),
        protein: z.string(),
        carbs: z.string(),
        fat: z.string(),
      })
      .optional(),
    availableIngredients: z.array(z.string()).optional(),
    usedTools: z.array(z.string()).optional(), // Track which tools were used
  }),
});

export async function GET() {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Missing OPENAI_API_KEY environment variable',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(
      '🍝 Starting streamObject test with tool calling for lasagna recipe generation'
    );

    // Define a dummy tool that checks ingredient availability
    const checkIngredientAvailability = tool({
      description:
        'Check which ingredients are currently available in the kitchen pantry.',
      inputSchema: z.object({
        ingredients: z
          .array(z.string())
          .describe('List of ingredients to check availability for'),
      }),
      outputSchema: z.object({
        availableIngredients: z.array(z.string()),
        unavailableIngredients: z.array(z.string()),
        suggestions: z.array(z.string()).optional(),
      }),
      execute: async ({ ingredients }) => {
        console.log('🔍 Tool called: checkIngredientAvailability');
        console.log('📝 Ingredients to check:', ingredients);

        // Simulate checking availability - in a real app, this might query a database
        const pantryItems = [
          'lasagna noodles',
          'ground beef',
          'italian sausage',
          'ricotta cheese',
          'mozzarella cheese',
          'parmesan cheese',
          'tomato sauce',
          'onion',
          'garlic',
          'olive oil',
          'salt',
          'pepper',
          'dried basil',
          'dried oregano',
        ];

        const available = ingredients.filter((ingredient) =>
          pantryItems.some(
            (pantryItem) =>
              pantryItem.toLowerCase().includes(ingredient.toLowerCase()) ||
              ingredient.toLowerCase().includes(pantryItem.toLowerCase())
          )
        );

        const unavailable = ingredients.filter(
          (ingredient) => !available.includes(ingredient)
        );

        const suggestions =
          unavailable.length > 0
            ? [
                `Consider substituting ${unavailable[0]} with a similar ingredient`,
              ]
            : [];

        const result = {
          availableIngredients: available,
          unavailableIngredients: unavailable,
          suggestions,
        };

        console.log('✅ Tool result:', result);
        return result;
      },
    });

    const tools = { checkIngredientAvailability };

    // Use streamText with tools AND experimental_output for structured object results
    const result = streamText({
      model: openai('gpt-4o-mini'), // Using gpt-4o-mini instead of gpt-4.1 for better availability
      tools,
      experimental_output: Output.object({
        schema: RecipeSchema,
      }),
      stopWhen: stepCountIs(4), // tool call + tool result + structured output + final step
      prompt:
        'Generate a lasagna recipe with detailed ingredients and step-by-step instructions. Use the checkIngredientAvailability tool to verify which ingredients are available, then provide a structured recipe object that includes the availability information and nutritional details.',
      onError: ({ error }) => {
        console.error('streamText error:', error);
      },
      temperature: 0.7,
      maxOutputTokens: 1500,
    });

    // Create a ReadableStream to handle the streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('🍝 Starting streamText with tool calling...');

          let eventCount = 0;
          let accumulatedText = '';
          let hasFinished = false;

          // Stream all events including tool calls and text deltas
          const streamPromise = (async () => {
            for await (const event of result.fullStream) {
              if (hasFinished) break; // Stop if we've already sent completion

              eventCount++;

              if (event.type === 'text-delta') {
                accumulatedText += event.text;

                // Try to parse partial JSON
                try {
                  const partialJson = JSON.parse(accumulatedText);
                  console.log(`🍝 Partial JSON #${eventCount}:`, partialJson);

                  // Send the partial object as a JSON line
                  const data =
                    JSON.stringify({
                      type: 'partial',
                      count: eventCount,
                      partialObject: partialJson,
                      accumulatedText,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(data));
                } catch {
                  // JSON not complete yet, send raw text update
                  const data =
                    JSON.stringify({
                      type: 'text-delta',
                      count: eventCount,
                      textDelta: event.text,
                      accumulatedText,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(data));
                }
              } else if (event.type === 'tool-call') {
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
          })();

          // Wait for the stream to complete
          await streamPromise;

          // Send final completion message with full result
          const finalText = await result.text;
          let finalObject = null;

          // With experimental_output, try to get the structured object
          try {
            // The experimental_output should be available in onFinish callback
            // For now, try to parse the text as JSON
            finalObject = JSON.parse(finalText);
          } catch {
            console.log('Could not parse final text as JSON:', finalText);
            finalObject = null;
          }

          hasFinished = true;

          const finalData =
            JSON.stringify({
              type: 'complete',
              totalEvents: eventCount,
              finalText,
              finalObject,
              message:
                'Recipe generation with tool calling and structured output completed',
              timestamp: new Date().toISOString(),
            }) + '\n';

          controller.enqueue(new TextEncoder().encode(finalData));
          controller.close();

          console.log(`🍝 Stream completed with ${eventCount} events`);
        } catch (error) {
          console.error('🍝 Stream error:', error);
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
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    console.error('/api/streamobject-test error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'Missing OPENAI_API_KEY environment variable',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const json = await req.json().catch(() => ({}));
    const prompt =
      json.prompt ||
      'Generate a lasagna recipe with detailed ingredients and step-by-step instructions.';
    const model = json.model || 'gpt-4o-mini';

    console.log(
      `🍝 Custom streamObject test with tool calling and prompt: "${prompt.substring(
        0,
        50
      )}..."`
    );

    // Define a dummy tool that checks ingredient availability
    const checkIngredientAvailability = tool({
      description:
        'Check which ingredients are currently available in the kitchen pantry.',
      inputSchema: z.object({
        ingredients: z
          .array(z.string())
          .describe('List of ingredients to check availability for'),
      }),
      outputSchema: z.object({
        availableIngredients: z.array(z.string()),
        unavailableIngredients: z.array(z.string()),
        suggestions: z.array(z.string()).optional(),
      }),
      execute: async ({ ingredients }) => {
        console.log('🔍 Tool called: checkIngredientAvailability');
        console.log('📝 Ingredients to check:', ingredients);

        // Simulate checking availability - in a real app, this might query a database
        const pantryItems = [
          'lasagna noodles',
          'ground beef',
          'italian sausage',
          'ricotta cheese',
          'mozzarella cheese',
          'parmesan cheese',
          'tomato sauce',
          'onion',
          'garlic',
          'olive oil',
          'salt',
          'pepper',
          'dried basil',
          'dried oregano',
          'eggs',
          'milk',
          'flour',
          'sugar',
          'butter',
          'vanilla extract',
        ];

        const available = ingredients.filter((ingredient) =>
          pantryItems.some(
            (pantryItem) =>
              pantryItem.toLowerCase().includes(ingredient.toLowerCase()) ||
              ingredient.toLowerCase().includes(pantryItem.toLowerCase())
          )
        );

        const unavailable = ingredients.filter(
          (ingredient) => !available.includes(ingredient)
        );

        const suggestions =
          unavailable.length > 0
            ? [
                `Consider substituting ${unavailable[0]} with a similar ingredient`,
              ]
            : [];

        const result = {
          availableIngredients: available,
          unavailableIngredients: unavailable,
          suggestions,
        };

        console.log('✅ Tool result:', result);
        return result;
      },
    });

    const result = streamText({
      model: openai(model),
      tools: { checkIngredientAvailability },
      experimental_output: Output.object({
        schema: RecipeSchema,
      }),
      stopWhen: stepCountIs(4), // tool call + tool result + structured output + final step
      prompt: `${prompt} Use the checkIngredientAvailability tool to verify which ingredients are available, then provide a structured recipe object that includes the availability information.`,
      onError: ({ error }) => {
        console.error('streamText error:', error);
      },
      temperature: json.temperature || 0.7,
      maxOutputTokens: json.maxOutputTokens || 1500,
    });

    // Create a ReadableStream to handle the streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('🍝 Starting custom streamText with tool calling...');

          let eventCount = 0;
          let accumulatedText = '';
          let hasFinished = false;

          // Stream all events including tool calls and text deltas
          const streamPromise = (async () => {
            for await (const event of result.fullStream) {
              if (hasFinished) break; // Stop if we've already sent completion

              eventCount++;
              eventCount++;

              if (event.type === 'text-delta') {
                accumulatedText += event.text;

                // Try to parse partial JSON
                try {
                  const partialJson = JSON.parse(accumulatedText);
                  console.log(`🍝 Partial JSON #${eventCount}:`, partialJson);

                  // Send the partial object as a JSON line
                  const data =
                    JSON.stringify({
                      type: 'partial',
                      count: eventCount,
                      partialObject: partialJson,
                      accumulatedText,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(data));
                } catch {
                  // JSON not complete yet, send raw text update
                  const data =
                    JSON.stringify({
                      type: 'text-delta',
                      count: eventCount,
                      textDelta: event.text,
                      accumulatedText,
                      timestamp: new Date().toISOString(),
                    }) + '\n';

                  controller.enqueue(new TextEncoder().encode(data));
                }
              } else if (event.type === 'tool-call') {
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
          })();

          // Wait for the stream to complete
          await streamPromise;

          // Send final completion message with full result
          const finalText = await result.text;
          let finalObject = null;

          // With experimental_output, try to get the structured object
          try {
            // The experimental_output should be available in onFinish callback
            // For now, try to parse the text as JSON
            finalObject = JSON.parse(finalText);
          } catch {
            console.log('Could not parse final text as JSON:', finalText);
            finalObject = null;
          }

          hasFinished = true;

          const finalData =
            JSON.stringify({
              type: 'complete',
              totalEvents: eventCount,
              finalText,
              finalObject,
              message:
                'Custom recipe generation with tool calling and structured output completed',
              timestamp: new Date().toISOString(),
            }) + '\n';

          controller.enqueue(new TextEncoder().encode(finalData));
          controller.close();

          console.log(`🍝 Custom stream completed with ${eventCount} events`);
        } catch (error) {
          console.error('🍝 Stream error:', error);
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
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    console.error('/api/streamobject-test error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;
