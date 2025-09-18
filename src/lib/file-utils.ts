/**
 * Handles file import by reading the file content as text.
 * Commonly used for importing .mmd files or other text-based diagram files.
 *
 * @param file - File object to read
 * @param onSuccess - Callback function called with the file content
 * @param onError - Optional callback for error handling
 */
export function importTextFile(
  file: File,
  onSuccess: (content: string) => void,
  onError?: (error: Error) => void
): void {
  const reader = new FileReader();

  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    onSuccess(text);
  };

  reader.onerror = () => {
    const error = new Error(`Failed to read file: ${file.name}`);
    if (onError) {
      onError(error);
    } else {
      console.error(error);
    }
  };

  reader.readAsText(file);
}

/**
 * Exports text content as a downloadable file.
 * Creates a blob with the content and triggers a download.
 *
 * @param content - Text content to export
 * @param filename - Name of the file to download
 * @param mimeType - MIME type of the file (defaults to 'text/plain;charset=utf-8')
 */
export function exportTextFile(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  // Clean up the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
