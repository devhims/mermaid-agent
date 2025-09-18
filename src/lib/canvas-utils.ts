/**
 * Draws a dotted grid pattern on a canvas context.
 * Used for dark theme background in PNG exports.
 *
 * @param ctx - Canvas 2D rendering context
 * @param width - Canvas width in pixels
 * @param height - Canvas height in pixels
 */
export function drawDarkGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const spacing = 24; // px
  const radius = 1; // px
  ctx.fillStyle = 'rgba(255,255,255,0.07)';

  for (let y = 0; y < height; y += spacing) {
    for (let x = 0; x < width; x += spacing) {
      ctx.beginPath();
      ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Exports an SVG element as a PNG image with specified background.
 * Handles proper scaling, background colors, and browser compatibility.
 *
 * @param svg - SVG element to export
 * @param background - Background style ('light' | 'dark' | 'transparent')
 * @param filename - Optional filename (defaults to 'mermaid-diagram-{background}.png')
 */
export function exportSvgAsPng(
  svg: SVGSVGElement,
  background: 'light' | 'dark' | 'transparent',
  filename?: string
): void {
  // Clone the SVG so we can safely adjust sizing without affecting the preview
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  // Remove any panzoom-applied transforms/styles on the root element
  cloned.removeAttribute('style');

  // Compute tight bounding box of the content and add a small padding
  const bbox = svg.getBBox();
  const padding = 16; // px
  const vbX = bbox.x - padding;
  const vbY = bbox.y - padding;
  const vbW = Math.max(1, bbox.width + padding * 2);
  const vbH = Math.max(1, bbox.height + padding * 2);

  // Force explicit viewBox/width/height so rasterization has exact dimensions
  cloned.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  cloned.setAttribute('width', String(vbW));
  cloned.setAttribute('height', String(vbH));
  if (!cloned.getAttribute('xmlns')) {
    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(cloned);

  // Convert SVG to data URL to avoid CORS issues
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    source
  )}`;

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    // Use the computed export dimensions for proper scaling
    const exportW = vbW;
    const exportH = vbH;
    const scale = 2; // Higher DPI for better quality

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(exportW * scale));
    canvas.height = Math.max(1, Math.round(exportH * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Enable high DPI rendering
    ctx.scale(scale, scale);

    // Fill background (skip for transparent)
    if (background === 'dark') {
      ctx.fillStyle = '#0b0f1a';
      ctx.fillRect(0, 0, exportW, exportH);
      // Draw dotted grid to match preview
      drawDarkGrid(ctx, exportW, exportH);
    } else if (background === 'light') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, exportW, exportH);
    }

    // Draw image with exact, unclipped dimensions
    ctx.drawImage(img, 0, 0, exportW, exportH);

    // Convert to blob and download
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename || `mermaid-diagram-${background}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
      'image/png',
      1.0
    );
  };
  img.onerror = () => {
    console.error('Failed to load SVG image');
  };
  img.src = svgDataUrl;
}
