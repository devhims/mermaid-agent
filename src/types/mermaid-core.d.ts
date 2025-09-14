declare module 'mermaid/dist/mermaid.core.mjs' {
  export interface MermaidCore {
    initialize(config: any): void;
    parse(text: string, options?: any): Promise<any> | any;
    render(
      id: string,
      text: string,
      container?: any
    ): Promise<{ svg: string; bindFunctions?: unknown }>; 
  }
  const mermaid: MermaidCore;
  export default mermaid;
}

