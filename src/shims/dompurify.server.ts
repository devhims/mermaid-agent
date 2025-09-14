// Minimal DOMPurify stub for server-side Mermaid validation.
// Provides a no-op sanitize to avoid DOM dependency in Node.
export default {
  sanitize<T>(value: T) {
    return value;
  },
};

