'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import { Download, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface DiagramPreviewProps {
  error: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isRendering?: boolean;
  onDownloadLight: () => void;
  onDownloadDark: () => void;
  onDownloadTransparent: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitToView: () => void;
  zoomPanRef: React.RefObject<ReactZoomPanPinchRef | null>;
}

export function DiagramPreview({
  error,
  containerRef,
  isRendering = false,
  onDownloadLight,
  onDownloadDark,
  onDownloadTransparent,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitToView,
  zoomPanRef,
}: DiagramPreviewProps) {
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [lightPreview, setLightPreview] = useState<string | null>(null);
  const [darkPreview, setDarkPreview] = useState<string | null>(null);
  const [transparentPreview, setTransparentPreview] = useState<string | null>(
    null
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);

  function getCurrentSvg(): SVGSVGElement | null {
    return containerRef.current?.querySelector('svg') ?? null;
  }

  function makePreview(
    bg: 'light' | 'dark' | 'transparent'
  ): Promise<string | null> {
    const svg = getCurrentSvg();
    if (!svg) return Promise.resolve(null);

    // Clone and normalize sizing using content bbox + padding
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    cloned.removeAttribute('style');
    const bbox = svg.getBBox();
    const padding = 16;
    const vbX = bbox.x - padding;
    const vbY = bbox.y - padding;
    const vbW = Math.max(1, bbox.width + padding * 2);
    const vbH = Math.max(1, bbox.height + padding * 2);
    cloned.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
    cloned.setAttribute('width', String(vbW));
    cloned.setAttribute('height', String(vbH));
    if (!cloned.getAttribute('xmlns')) {
      cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(cloned);
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      source
    )}`;

    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const exportW = vbW;
        const exportH = vbH;
        const scale = 1; // keep previews quick
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(exportW * scale));
        canvas.height = Math.max(1, Math.round(exportH * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.scale(scale, scale);
        const drawDarkGrid = (
          ctx: CanvasRenderingContext2D,
          w: number,
          h: number
        ) => {
          const spacing = 24;
          const radius = 1;
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          for (let y = 0; y < h; y += spacing) {
            for (let x = 0; x < w; x += spacing) {
              ctx.beginPath();
              ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        };

        if (bg === 'light') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, exportW, exportH);
        } else if (bg === 'dark') {
          ctx.fillStyle = '#0b0f1a';
          ctx.fillRect(0, 0, exportW, exportH);
          drawDarkGrid(ctx, exportW, exportH);
        }
        ctx.drawImage(img, 0, 0, exportW, exportH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = svgDataUrl;
    });
  }

  async function refreshPreviews() {
    const [lp, dp, tp] = await Promise.all([
      makePreview('light'),
      makePreview('dark'),
      makePreview('transparent'),
    ]);
    setLightPreview(lp);
    setDarkPreview(dp);
    setTransparentPreview(tp);
  }

  // Fullscreen overlay lifecycle
  useEffect(() => {
    if (!isFullscreen) return;
    const dst = fullscreenContainerRef.current;
    const src = containerRef.current;
    if (!dst || !src) return;

    // Fill overlay with current diagram markup
    dst.innerHTML = src.innerHTML || '';

    // Prevent background scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen, containerRef]);

  return (
    <div className='flex flex-col h-full'>
      {isFullscreen && (
        <div className='fixed inset-0 z-50 bg-background/95 backdrop-blur-sm'>
          <TransformWrapper
            initialScale={1}
            minScale={0.1}
            maxScale={10}
            centerOnInit={false}
            wheel={{ step: 0.1 }}
            pinch={{ disabled: false }}
            doubleClick={{ disabled: false }}
            panning={{ disabled: false }}
            limitToBounds={false}
          >
            <TransformComponent
              wrapperClass='!absolute inset-0 overflow-hidden diagram-grid-bg'
              contentClass='!h-full !w-full flex items-center justify-center'
            >
              <div
                ref={fullscreenContainerRef}
                className='[&_svg]:block [&_svg]:max-w-none [&_svg]:h-auto [&_svg]:overflow-visible [&_svg]:drop-shadow-lg'
              />
            </TransformComponent>
          </TransformWrapper>
          <div className='absolute top-2 right-3 text-xs text-muted-foreground select-none'>
            Press Esc to exit
          </div>
        </div>
      )}
      {/* Toolbar */}
      <div className='flex items-center justify-between p-4 border-b bg-card/50 backdrop-blur-sm'>
        <div className='flex items-center gap-3'>
          <h2 className='text-xl font-semibold'>Preview</h2>
          {isRendering && (
            <span className='text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-1 rounded flex items-center gap-1'>
              <div className='w-2 h-2 border border-current border-t-transparent rounded-full animate-spin'></div>
              Updating...
            </span>
          )}
          {error && !isRendering && (
            <span className='text-xs text-destructive bg-destructive/10 px-2 py-1 rounded'>
              Error
            </span>
          )}
        </div>

        <div className='flex items-center gap-3'>
          {/* Zoom Controls */}
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='default'
              onClick={onZoomOut}
              className='h-10 w-10 p-0 cursor-pointer'
            >
              <ZoomOut className='h-4 w-4' />
            </Button>
            <Button
              variant='ghost'
              size='default'
              onClick={onZoomIn}
              className='h-10 w-10 p-0 cursor-pointer'
            >
              <ZoomIn className='h-4 w-4' />
            </Button>

            <Button
              variant='ghost'
              size='default'
              onClick={onResetView}
              className='h-10 w-10 p-0 cursor-pointer'
              aria-label='Reset view'
              title='Reset view'
            >
              <RotateCcw className='h-4 w-4' />
            </Button>

            <Button
              variant='ghost'
              size='default'
              onClick={() => setIsFullscreen(true)}
              className='h-10 w-10 p-0 cursor-pointer'
              aria-label='Full screen'
              title='Full screen (Esc to exit)'
            >
              <Maximize2 className='h-4 w-4' />
            </Button>
          </div>

          <Separator orientation='vertical' className='h-8' />

          {/* Download Button with Modal */}
          <Dialog
            open={isDownloadDialogOpen}
            onOpenChange={setIsDownloadDialogOpen}
          >
            <DialogTrigger
              asChild
              onClick={() => {
                // Generate fresh previews whenever opening
                setTimeout(() => refreshPreviews(), 0);
              }}
            >
              <Button
                variant='outline'
                size='default'
                className='h-10 px-4 text-sm text-white bg-white dark:bg-gray-800 dark:text-white shadow-sm cursor-pointer'
              >
                <Download className='h-4 w-4' />
              </Button>
            </DialogTrigger>
            <DialogContent className='sm:max-w-2xl'>
              <DialogHeader>
                <DialogTitle className='text-xl'>Download Diagram</DialogTitle>
                <DialogDescription className='text-base'>
                  Choose a background for your diagram export
                </DialogDescription>
              </DialogHeader>
              <div className='grid grid-cols-3 gap-6 mt-6'>
                {/* Light */}
                <div className='space-y-4'>
                  <div className='aspect-square border-2 rounded-xl overflow-hidden bg-white border-gray-200 shadow-sm'>
                    {lightPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={lightPreview}
                        alt='Light preview'
                        className='w-full h-full object-contain p-2'
                      />
                    ) : (
                      <div className='h-full bg-gray-50 flex items-center justify-center text-sm text-gray-500'>
                        Generating…
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => {
                      onDownloadLight();
                      setIsDownloadDialogOpen(false);
                    }}
                    className='w-full h-11'
                    variant='outline'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Light PNG
                  </Button>
                </div>

                {/* Dark */}
                <div className='space-y-4'>
                  <div className='aspect-square border-2 rounded-xl overflow-hidden bg-[#0b0f1a] border-gray-700 shadow-sm'>
                    {darkPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={darkPreview}
                        alt='Dark preview'
                        className='w-full h-full object-contain p-2'
                      />
                    ) : (
                      <div className='h-full bg-gray-800 flex items-center justify-center text-sm text-gray-300'>
                        Generating…
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => {
                      onDownloadDark();
                      setIsDownloadDialogOpen(false);
                    }}
                    className='w-full h-11'
                    variant='outline'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Dark PNG
                  </Button>
                </div>

                {/* Transparent */}
                <div className='space-y-4'>
                  <div
                    className='aspect-square border-2 rounded-xl overflow-hidden border-gray-300 shadow-sm'
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #f8fafc 25%, transparent 25%), linear-gradient(-45deg, #f8fafc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8fafc 75%), linear-gradient(-45deg, transparent 75%, #f8fafc 75%)',
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    }}
                  >
                    {transparentPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={transparentPreview}
                        alt='Transparent preview'
                        className='w-full h-full object-contain p-2'
                      />
                    ) : (
                      <div className='h-full flex items-center justify-center text-sm text-gray-500'>
                        Generating…
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => {
                      onDownloadTransparent();
                      setIsDownloadDialogOpen(false);
                    }}
                    className='w-full h-11'
                    variant='outline'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Transparent PNG
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Preview Area */}
      <div className='flex-1 relative overflow-hidden diagram-grid-bg'>
        {error ? (
          <div className='absolute inset-0 flex items-center justify-center p-8'>
            <div className='max-w-md text-center space-y-4'>
              <div className='text-destructive'>
                <svg
                  className='h-12 w-12 mx-auto mb-4'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={1.5}
                    d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                  />
                </svg>
              </div>
              <h3 className='text-lg font-semibold'>Diagram Error</h3>
              <p className='text-sm text-muted-foreground whitespace-pre-line'>
                {error}
              </p>
            </div>
          </div>
        ) : (
          <TransformWrapper
            ref={zoomPanRef}
            initialScale={1}
            minScale={0.1}
            maxScale={10}
            centerOnInit={false}
            wheel={{ step: 0.1 }}
            pinch={{ disabled: false }}
            doubleClick={{ disabled: false }}
            panning={{ disabled: false }}
            limitToBounds={false}
          >
            <TransformComponent
              wrapperClass='!h-full !w-full'
              contentClass='!h-full !w-full'
            >
              <div
                ref={containerRef}
                className='absolute inset-0 flex items-center justify-center [&_svg]:block [&_svg]:max-w-none [&_svg]:h-auto [&_svg]:overflow-visible [&_svg]:drop-shadow-lg'
              />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>
    </div>
  );
}
