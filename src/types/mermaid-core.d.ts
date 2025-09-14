declare module 'mermaid/dist/mermaid.core.mjs' {
  export interface MermaidParseOptions {
    suppressErrors?: boolean;
    [key: string]: unknown;
  }

  export interface MermaidRenderResult {
    svg: string;
    bindFunctions?: unknown;
  }

  export interface MermaidCore {
    initialize(config: Record<string, unknown>): void;
    parse(text: string, options?: MermaidParseOptions): Promise<unknown> | unknown;
    render(id: string, text: string, container?: Element): Promise<MermaidRenderResult>;
  }

  const mermaid: MermaidCore;
  export default mermaid;
}
