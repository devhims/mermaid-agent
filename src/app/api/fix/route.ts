import { NextRequest } from 'next/server';
import { z } from 'zod';
import { generateObject, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export const runtime = 'nodejs';

const ReqSchema = z.object({
  code: z.string().min(1, 'Mermaid code is required'),
});

const ResSchema = z.object({
  fixedCode: z.string(),
  rationale: z.string().optional(),
  changes: z.array(z.string()).optional(),
});

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
