'use client';

import { useState } from 'react';
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
} from 'lucide-react';
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
  onDownloadLight: () => void;
  onDownloadDark: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitToView: () => void;
}

export function DiagramPreview({
  error,
  containerRef,
  onDownloadLight,
  onDownloadDark,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitToView,
}: DiagramPreviewProps) {
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);

  return (
    <div className='flex flex-col h-full'>
      {/* Toolbar */}
      <div className='flex items-center justify-between p-4 border-b bg-card/50 backdrop-blur-sm'>
        <div className='flex items-center gap-2'>
          <h2 className='text-lg font-semibold'>Diagram Preview</h2>
          {error && (
            <span className='text-xs text-destructive bg-destructive/10 px-2 py-1 rounded'>
              Error
            </span>
          )}
        </div>

        <div className='flex items-center gap-2'>
          {/* Zoom Controls */}
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              onClick={onZoomOut}
              className='h-8 w-8 p-0'
            >
              <ZoomOut className='h-3 w-3' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onZoomIn}
              className='h-8 w-8 p-0'
            >
              <ZoomIn className='h-3 w-3' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onResetView}
              className='h-8 w-8 p-0'
            >
              <RotateCcw className='h-3 w-3' />
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onFitToView}
              className='h-8 w-8 p-0'
            >
              <Maximize2 className='h-3 w-3' />
            </Button>
          </div>

          <Separator orientation='vertical' className='h-6' />

          {/* Download Button with Modal */}
          <Dialog
            open={isDownloadDialogOpen}
            onOpenChange={setIsDownloadDialogOpen}
          >
            <DialogTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-8 px-3 text-xs bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-sm'
              >
                <Download className='h-3 w-3 mr-1' />
                Download
              </Button>
            </DialogTrigger>
            <DialogContent className='sm:max-w-md'>
              <DialogHeader>
                <DialogTitle>Download Diagram</DialogTitle>
                <DialogDescription>
                  Choose a theme for your diagram download
                </DialogDescription>
              </DialogHeader>
              <div className='grid grid-cols-2 gap-4 mt-4'>
                <div className='space-y-3'>
                  <div className='aspect-video bg-white border-2 border-gray-200 rounded-lg p-2'>
                    <div className='h-full bg-gray-100 rounded flex items-center justify-center'>
                      <div className='text-xs text-gray-500'>Light Preview</div>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      onDownloadLight();
                      setIsDownloadDialogOpen(false);
                    }}
                    className='w-full'
                    variant='outline'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Light Theme
                  </Button>
                </div>
                <div className='space-y-3'>
                  <div className='aspect-video bg-gray-900 border-2 border-gray-700 rounded-lg p-2'>
                    <div className='h-full bg-gray-800 rounded flex items-center justify-center'>
                      <div className='text-xs text-gray-300'>Dark Preview</div>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      onDownloadDark();
                      setIsDownloadDialogOpen(false);
                    }}
                    className='w-full'
                    variant='outline'
                  >
                    <Download className='h-4 w-4 mr-2' />
                    Dark Theme
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Preview Area */}
      <div className='flex-1 relative bg-muted/30'>
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
          <div
            ref={containerRef}
            className='absolute inset-0 overflow-auto p-8 [&_svg]:block [&_svg]:max-w-none [&_svg]:h-auto [&_svg]:overflow-visible'
          />
        )}
      </div>
    </div>
  );
}
