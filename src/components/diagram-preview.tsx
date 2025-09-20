'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MERMAID_THEMES,
  MERMAID_THEME_LABELS,
  type MermaidTheme,
} from '@/lib/mermaid-utils';
import { DiagramDownloadDialog } from '@/components/diagram-download-dialog';
import { PanelLeftIcon } from 'lucide-react';

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
  zoomPanRef: React.RefObject<ReactZoomPanPinchRef | null>;
  selectedTheme: MermaidTheme;
  onThemeChange: (theme: MermaidTheme) => void;
  onExportCode: () => void;
  onToggleEditor?: () => void;
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
  zoomPanRef,
  selectedTheme,
  onThemeChange,
  onExportCode,
  onToggleEditor,
}: DiagramPreviewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const getCurrentSvg = useCallback(() => {
    return containerRef.current?.querySelector('svg') ?? null;
  }, [containerRef]);

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
    <div className='relative h-full'>
      {isFullscreen && (
        <div className='fixed inset-0 z-50 bg-background/95 backdrop-blur-sm diagram-grid-bg'>
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
              wrapperClass='!h-full !w-full'
              contentClass='!h-full !w-full'
            >
              <div className='relative w-full h-full'>
                <div
                  ref={fullscreenContainerRef}
                  className='absolute inset-0 flex items-center justify-center [&_svg]:block [&_svg]:max-w-none [&_svg]:h-auto [&_svg]:overflow-visible [&_svg]:drop-shadow-lg'
                />
              </div>
            </TransformComponent>
          </TransformWrapper>
          <div className='absolute top-2 right-3 text-xs text-muted-foreground select-none'>
            Press Esc to exit
          </div>
        </div>
      )}
      {/* Toolbar */}
      <div className='absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4'>
        <div className='flex items-center gap-3'>
          {onToggleEditor && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onToggleEditor}
              className='size-8 cursor-pointer'
              aria-label='Toggle editor panel'
              title='Toggle editor panel'
            >
              <PanelLeftIcon className='h-4 w-4' />
            </Button>
          )}
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

        <div className='flex items-center gap-1'>
          {/* Zoom Controls */}
          <Button
            variant='ghost'
            size='default'
            onClick={onZoomIn}
            className='h-10 w-10 p-0 cursor-pointer'
          >
            <ZoomIn className='h-4 w-4' />
          </Button>
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

          {/* Theme Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='default'
                className='text-sm shadow-sm cursor-pointer'
                aria-label='Select theme'
              >
                <Palette className='h-4 w-4' />
                {/* {MERMAID_THEME_LABELS[selectedTheme]} */}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-fit'>
              {MERMAID_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => onThemeChange(theme)}
                  className={`cursor-pointer ${
                    selectedTheme === theme
                      ? 'bg-accent text-accent-foreground font-medium'
                      : ''
                  }`}
                >
                  {MERMAID_THEME_LABELS[theme]}
                  {selectedTheme === theme && (
                    <span className='ml-auto text-xs'>✓</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation='vertical' className='h-8' />

          <DiagramDownloadDialog
            getCurrentSvg={getCurrentSvg}
            onDownloadLight={onDownloadLight}
            onDownloadDark={onDownloadDark}
            onDownloadTransparent={onDownloadTransparent}
            onExportCode={onExportCode}
          />
        </div>
      </div>

      {/* Preview Area */}
      <div className='absolute inset-0 overflow-hidden diagram-grid-bg'>
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
