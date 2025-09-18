import mermaid from 'mermaid/dist/mermaid.core.mjs';

// Initialize mermaid for Node.js
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose', // For backend validation
});

// Validate Mermaid code using Mermaid core only
export async function validateMermaidCode(
  code: string
): Promise<{ isValid: boolean; error?: string }> {
  try {
    // Sanitize the code (same logic as frontend)
    let sanitized = code
      .replace(/\r\n?/g, '\n')
      .replace(/^\uFEFF/, '')
      .trim();

    // Extract fenced code if present
    const fence = /```(?:\s*mermaid)?\s*([\s\S]*?)```/i.exec(sanitized);
    if (fence && fence[1]) sanitized = fence[1];

    // Remove zero-width and bidi control characters
    const INVISIBLES =
      /[\u200B-\u200D\uFEFF\u2060\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
    sanitized = sanitized.replace(INVISIBLES, '');

    // Trim each line's leading/trailing spaces
    sanitized = sanitized
      .split('\n')
      .map((l) => l.replace(/^\s+|\s+$/g, ''))
      .join('\n')
      .trim();
    // Use mermaid core parser for validation
    const result = await mermaid.parse(sanitized, { suppressErrors: false });
    console.log('✅ Mermaid validation passed:', result);
    return { isValid: true };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error ?? 'Unknown parse error');
    console.log('❌ Mermaid validation failed:', errorMessage);
    return { isValid: false, error: errorMessage };
  }
}
