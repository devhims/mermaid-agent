/**
 * Mermaid Diagram Generation API Route using AI SDK v5
 *
 * This route mirrors the fixer agent flow but focuses on generating brand-new
 * Mermaid diagrams from natural language briefs. It streams structured events
 * and guarantees that the final diagram passes server-side validation via the
 * shared mermaidValidator tool before returning it to the client.
 */

import {
  streamText,
  tool,
  stepCountIs,
  Output,
  convertToModelMessages,
  UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { validateMermaidCode } from '../tools';

const RequestSchema = z.object({
  messages: z.array(z.any()).min(1, 'Messages are required'),
  diagramType: z.string().optional(),
  context: z.string().optional(),
});

// Structured output schema for Mermaid diagram generation
const MermaidDiagramSchema = z.object({
  diagram: z.string().describe('Valid Mermaid diagram code without backticks'),
  explanation: z
    .union([z.string(), z.array(z.string())])
    .describe('Explanation of the diagram design and structure'),
});

type MermaidDiagramOutput = z.infer<typeof MermaidDiagramSchema>;

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
    console.log('API received request:', JSON.stringify(json, null, 2));

    const parsed = RequestSchema.safeParse(json);

    if (!parsed.success) {
      console.error('Request validation failed:', parsed.error.flatten());
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
      });
    }

    const {
      messages: chatMessages,
      diagramType,
      context,
    } = parsed.data as {
      messages: UIMessage[];
      diagramType: string;
      context: string;
    };
    console.log('Parsed messages:', chatMessages);

    // Convert to proper ModelMessage format using AI SDK utility
    const aiMessages = convertToModelMessages(chatMessages);

    const mermaidValidator = tool({
      description:
        'Validate a candidate Mermaid diagram with the real Mermaid parser and return validation status.',
      inputSchema: z.object({
        diagram: z
          .string()
          .describe(
            'The Mermaid diagram code to validate before sharing with the user'
          ),
      }),
      outputSchema: z.object({
        diagram: z.string(),
        validated: z.boolean(),
        validationError: z.string().optional(),
        hints: z.string().optional(),
      }),
      execute: async ({ diagram }) => {
        console.log('🔧 Tool called: mermaidValidator (generation)');
        const validation = await validateMermaidCode(diagram);
        console.log(
          `🔍 Generation validation: ${
            validation.isValid ? 'PASSED' : 'FAILED'
          }`
        );
        if (validation.isValid) {
          console.log('📊 Validated Diagram:\n', diagram);
        } else {
          console.log('⚠️ Unvalidated Diagram (failed validation):\n', diagram);
          if (validation.error) {
            console.log('❌ Validation Error:', validation.error);
          }
          if (validation.hints) {
            console.log('💡 Validation Hints:', validation.hints);
          }
        }
        return {
          diagram,
          validated: validation.isValid,
          validationError: validation.error,
          hints: validation.hints,
        };
      },
    });

    const tools = { mermaidValidator };

    // Build system message with context
    let systemPrompt = `<role>
    You are a meticulous Mermaid diagram designer with vision capabilities.
    </role>
    
    <objective>
    - Analyze images of diagrams/flowcharts and convert them to clean Mermaid code
    - Translate user briefs into clear, well structured Mermaid diagrams
    - Prefer the requested diagram type when provided; otherwise choose the format that best communicates the relationships
    - Ensure labels are concise and nodes are unique
    - Use meaningful colors for nodes to enhance visual clarity and convey semantic meaning
    - Maintain conversation context and build upon previous diagrams when referenced
    </objective>
    
    <styling>
    - Colors are applied via Mermaid classes only (never inline style).
    - Node/class syntax pattern (each on its own line):
      flowchart TD
        %% NODES
        A["Start"]:::primary
        B["Next"]:::process
        %% EDGES
        A --> B
        %% CLASSES
        classDef primary fill:#0ea5e9,color:#0f172a,stroke:#0c4a6e
        classDef process fill:#f97316,color:#1f2937,stroke:#ea580c
    
    - CRITICAL NEWLINE RULES (to prevent validation errors when adding colors):
      1) Every node declaration must end with a newline, and NOTHING may follow after \`:::className\` on that same line.
      2) Insert a separator comment line between sections to guard against newline trimming:
         - A \`%% NODES\` header before nodes
         - A \`%% EDGES\` line after the last node line
         - A \`%% CLASSES\` line before classDef lines
      3) Ensure a trailing newline at the very end of the diagram.
    
    - Reserved-word safety:
      - Do NOT use Mermaid keywords as class names or node IDs: \`end\`, \`subgraph\`, \`click\`, \`class\`, \`classDef\`, \`style\`, \`linkStyle\`, \`graph\`, \`flowchart\`, \`LR\`, \`RL\`, \`TD\`, \`BT\`.
      - Prefer neutral class names like \`primary\`, \`branch\`, \`terminal\`, \`success\`, \`warning\`, etc.
      - Example fix: use \`terminal\` instead of \`end\`.
    
    - Reuse class names when colors convey the same meaning; avoid inventing a unique class per node unless required.
    - Never apply \`:::className\` to edges. Use \`linkStyle\` only if edge styling is explicitly requested.
    - Place every \`classDef\` on its own line; do not mix with nodes or edges.
    </styling>
    
    <image_analysis>
    - When given an image, carefully analyze the visual diagram structure
    - Identify nodes, connections, flow directions, and relationships
    - Convert visual elements to appropriate Mermaid syntax
    - Preserve the logical structure and relationships from the original diagram
    </image_analysis>
    
    <syntax_safety>
    - If a parse error mentions tokens running together (e.g., \`:::classXNodeY\` or \`got 'end'\`), you likely missed a newline or used a reserved word as a class name. Insert the \`%% EDGES\` separator after the last node line and/or rename the class (e.g., \`end -> terminal\`).
    - Node IDs: use simple alphanumerics/underscores; keep them unique and distinct from class names.
    </syntax_safety>
    
    <tool_use>
    - After drafting each candidate diagram, ALWAYS call mermaidValidator to check if it parses successfully
    - If mermaidValidator returns validated=false, analyze the validationError and hints to identify what needs to be fixed
    - Do NOT return the final diagram until mermaidValidator confirms validated=true
    - Use the validator hints to make targeted fixes - each iteration should address specific validation issues
    - Continue calling mermaidValidator after each fix until validation passes
    </tool_use>
    
    <workflow>
    - For images: First analyze the visual structure, then create Mermaid code
    - For text requests: Translate natural language into diagram code
    - Always structure output in three blocks with separators:
      1) \`%% NODES\`
      2) \`%% EDGES\`
      3) \`%% CLASSES\`
    - After drafting each candidate diagram, call mermaidValidator to check if it parses successfully
    - If mermaidValidator returns validated=true, you may stop and provide the final diagram
    - If validation fails, analyze the error and validator hints, then iterate with one targeted improvement per attempt
    - Continue iterating until validation succeeds or you reach the maximum number of attempts
    - If you must stop without a valid diagram, explain what blocked you in the explanation field
    </workflow>
    
    <conversation>
    - Remember previous diagrams and user preferences from this conversation
    - Reference or build upon earlier diagrams when the user asks to modify or extend them
    </conversation>
    
    <output>
    - Return a structured object with 'diagram' and 'explanation' fields ONLY after mermaidValidator confirms the diagram is valid
    - The 'diagram' field MUST contain Mermaid code that passes validation (validated=true)
    - The 'diagram' code MUST include the \`%% NODES\`, \`%% EDGES\`, and \`%% CLASSES\` separator lines and end with a trailing newline
    - If validation repeatedly fails, explain the persistent issues in the explanation field instead of returning invalid code
    - The 'explanation' field should contain a brief description of design choices and how requirements were met
    </output>`;

    // Add diagram type preference if specified
    if (diagramType) {
      systemPrompt += `\n\nPREFERRED DIAGRAM TYPE: ${diagramType.trim()}`;
    }

    // Add additional context if provided
    if (context) {
      systemPrompt += `\n\nADDITIONAL CONTEXT:\n${context.trim()}`;
    }

    const result = streamText({
      model: openai('gpt-4.1'),
      tools,
      experimental_output: Output.object({
        schema: MermaidDiagramSchema,
      }),
      system: systemPrompt,
      messages: aiMessages, // Send full conversation history
      stopWhen: stepCountIs(5),
      temperature: 0.4,
      maxOutputTokens: 1000,
    });

    // Use AI SDK v5's built-in streaming response
    return result.toUIMessageStreamResponse();
  } catch (err: unknown) {
    console.error('/api/generate error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}

export const maxDuration = 30;
