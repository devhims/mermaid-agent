Mermaid Viewer — a lightweight mermaid.live-style editor to paste and render Mermaid diagrams, download PNGs (light/dark), and fix errors with AI (GPT‑4o via Vercel AI SDK).

## Getting Started

1) Install dependencies and set your OpenAI key:

```bash
npm install
echo "OPENAI_API_KEY=YOUR_KEY" > .env.local
```

2) Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000 to use the app.

## Features
- Paste Mermaid code and see live preview
- Download PNG with light or dark background
- Preview theme toggle (light/dark)
- Fix with AI: repairs Mermaid syntax with minimal changes using GPT‑4o

## Notes
- Requires `OPENAI_API_KEY` env var for the AI fix API.
- Rendering uses `mermaid` client-side and converts SVG to PNG with an offscreen canvas.
