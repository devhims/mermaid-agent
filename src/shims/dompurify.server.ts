// Minimal DOMPurify stub for server-side Mermaid validation.
// Provides a no-op sanitize to avoid DOM dependency in Node.
const DOMPurifyStub = {
  sanitize<T>(value: T): T {
    return value;
  },
};

export default DOMPurifyStub;
