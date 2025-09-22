# AI Agent Architecture

## Overview

This single document consolidates the system and agent architecture for the Mermaid Viewer application. It covers frontend-backend interactions, AI service integration, tool calling, validation flows, and runtime behavior as implemented in the current codebase.

## Frontend Architecture

### Core Stack

- **Next.js 15** (App Router, Turbopack)
- **React 19** with modern hooks
- **TypeScript**
- **Tailwind CSS**
- **Mermaid.js** for diagram rendering

### UI Components

- `CodeEditor`: Text editor with AI integration. Contains a vertical `ResizablePanelGroup` splitting Editor and Agent Result panels; both are collapsible and resizable.
- `DiagramPreview`: Zoomable preview with export controls (PNG export via canvas).
- `DiagramDownloadDialog`: Advanced export dialog.
- Theme toggle and responsive layout components.

### Layout & Panels

- `src/app/page.tsx` uses a horizontal `ResizablePanelGroup` to split `CodeEditor` (left) and `DiagramPreview` (right).
- Inside `CodeEditor`, a nested vertical `ResizablePanelGroup` manages the editor and the live agent activity/result panel.

### Validation & Linting (frontend)

- `src/lib/mermaid-validator.ts` provides `validateMermaid()` for UI-side pre-render checks. It wraps the Mermaid parser and augments errors with friendly hints from `src/lib/mermaid-lint.ts`.
- The UI validates before rendering and surfaces concise errors. Rendering is skipped on validation failure to avoid stale previews.

## Backend Architecture

### Shared Validation Tooling

- `src/app/api/tools.ts` exports `validateMermaidCode(code)` which:
  - Sanitizes input, detects diagram intent, and uses Mermaid core to parse.
  - Returns `{ isValid, isLikelyMermaid, error?, diagramType?, hints? }`.
  - Integrates lint hints from `src/lib/mermaid-lint.ts` for more actionable feedback.

### API Routes (current)

- `/api/agent` — OpenAI multi-step fixer

  - Method: POST
  - Model: `openai('gpt-4.1')`
  - Tools: `mermaidValidator` (server-side parser + lint hints)
  - Streaming: NDJSON lines including `text-delta`, `tool-call`, `tool-result`, `structured-output`, `finish`, and final summary payload
  - Iteration control: `stopWhen: stepCountIs(5)`
  - Structured output: `experimental_output: Output.object({ fixedCode, explanation })` with fallback extraction from text or the last tool result

- `/api/gemini-ai` — Gemini multi-step fixer

  - Method: POST
  - Model: `google('gemini-2.5-pro')`
  - Tools: `mermaidValidator`
  - Streaming: NDJSON events similar to `/api/agent`
  - Iteration control: `stopWhen: stepCountIs(6)` (up to ~3 attempts)
  - Output: Model returns strict JSON in-text; the route parses fenced or plain JSON and falls back to tool results if needed

- `/api/fix` — Alternative OpenAI fixer (non-UI streaming response)

  - Method: POST (+ GET demo)
  - Model: `openai('gpt-4o-mini')`
  - Tools: `mermaidValidator`
  - Iteration control: `stopWhen: [stepCountIs(6), validated-in-last-step]`
  - Returns a consolidated JSON when completed (no UI event stream here)

- `/api/workers-ai` — Cloudflare Workers AI integration

  - Methods: GET and POST
  - Models: `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
  - Tools: `mermaidValidator`
  - Streaming: NDJSON with manual tool execution fallback when provider tool calls are not executed

- Experimental/Test routes
  - `/api/streamobject-test`: Demonstrates `streamText` with tools and `experimental_output` (structured object streaming).
  - `/api/gpt-oss`: Direct Cloudflare Responses API test with function tools and schema-enforced JSON.

### Tool Calling System

- Single server tool used across routes: **`mermaidValidator`**
  - Input: `{ fixedCode: string, explanation?: string }` (shape varies slightly by route)
  - Output: `{ fixedCode, validated, validationError?, hints? }`
  - Execute: calls `validateMermaidCode(fixedCode)` then returns structured result

### Data Flow

1. User edits Mermaid code in `CodeEditor`.
2. UI validates locally with `validateMermaid()`; preview render is skipped if invalid.
3. On "✨ Auto Fix", UI POSTs to `/api/agent` with `{ code, error, step }`.
4. Backend runs multi-step generation with tool calls; events are streamed as NDJSON lines.
5. UI consumes events to show live status, tool activity, and the emerging `fixedCode`/`explanation`.
6. User can apply the final fix into the editor.

### Validation Flow

1. Frontend sanitizes and validates using `validateMermaid()` and lint hints.
2. If invalid, UI shows actionable hints (e.g., unbalanced brackets, unquoted parentheses in labels).
3. Backend tool `validateMermaidCode()` validates candidates from the model and surfaces the same hints in `hints`/`validationError`.

### AI Processing Flow (multi-step)

- Each attempt: model proposes a minimally changed `fixedCode`, calls `mermaidValidator`, and adapts.
- OpenAI route uses `experimental_output` to yield `{ fixedCode, explanation }` during streaming; Gemini returns strict JSON text that is parsed server-side.
- `prepareStep()` compacts transcripts to keep only the freshest tool result and relevant context, reducing token usage.
- Stop conditions prevent infinite loops and allow early termination on success.

## Environment Configuration

- Required:
  - `OPENAI_API_KEY` (for `/api/agent`, `/api/fix`, and tests)
  - `GOOGLE_GENERATIVE_AI_API_KEY` (for `/api/gemini-ai`)
- Optional (for Workers AI and GPT-OSS tests):
  - `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

## Security Considerations

- API keys validated per request.
- Input sanitization for Mermaid code (server and client).
- Error responses avoid exposing sensitive details.

## Performance Optimizations

- **Debounced rendering** in the UI to minimize reflows.
- **Streaming responses** (NDJSON) for responsive UX.
- **Transcript compaction** via `prepareStep()` to limit token usage.
- **Step limits** using `stepCountIs()` with success-aware stops.

## Deployment

- Development: Next.js dev server with Turbopack; env in `.env.local`.
- Production: Next.js app with API routes for AI features; env set via hosting platform.

## UI Integration Summary

- Single "✨ Auto Fix" button in `CodeEditor` triggers `/api/agent`.
- Live panel shows step-by-step tool calls and validation outcomes.
- Users can Apply/Dismiss the agent’s final `fixedCode`.

## Future Enhancements

- Multi-diagram workspace, collaboration, custom themes.
- Additional export formats (SVG, PDF), plugin validators.
- Parallel validation strategies and smarter stop conditions.

## Appendix: Models & Limits (as implemented)

- `/api/agent`: `openai('gpt-4.1')`, `stopWhen: stepCountIs(5)`, `experimental_output` object with `{ fixedCode, explanation }`.
- `/api/gemini-ai`: `google('gemini-2.5-pro')`, `stopWhen: stepCountIs(6)`, strict JSON-in-text parsing.
- `/api/fix`: `openai('gpt-4o-mini')`, up to 6 steps + success stop.
- `/api/workers-ai`: Cloudflare models, NDJSON streaming with manual tool fallback.
