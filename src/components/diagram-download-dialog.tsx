'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useTheme } from 'next-themes';

type BackgroundVariant = 'light' | 'dark' | 'transparent';

interface DiagramDownloadDialogProps {
  getCurrentSvg: () => SVGSVGElement | null;
  onDownloadLight: () => void;
  onDownloadDark: () => void;
  onDownloadTransparent: () => void;
  onExportCode: () => void;
}

type PreviewMap = Record<BackgroundVariant, string | null>;

const PREVIEW_ORDER: BackgroundVariant[] = ['light', 'dark', 'transparent'];

const VARIANT_CONFIG: Record<
  BackgroundVariant,
  { label: string; description: string }
> = {
  light: { label: 'Light', description: 'White background' },
  dark: { label: 'Dark', description: 'Dark background' },
  transparent: { label: 'Transparent', description: 'No background' },
};

export function DiagramDownloadDialog({
  getCurrentSvg,
  onDownloadLight,
  onDownloadDark,
  onDownloadTransparent,
  onExportCode,
}: DiagramDownloadDialogProps) {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<PreviewMap>({
    light: null,
    dark: null,
    transparent: null,
  });
  const { theme } = useTheme();
  const [selectedVariant, setSelectedVariant] = useState<BackgroundVariant>(
    theme === 'dark' ? 'dark' : 'light'
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const makePreview = useCallback(
    async (variant: BackgroundVariant): Promise<string | null> => {
      const svg = getCurrentSvg();
      if (!svg) return null;

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

      return await new Promise<string | null>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const exportW = Math.max(1, Math.round(vbW));
          const exportH = Math.max(1, Math.round(vbH));
          canvas.width = exportW;
          canvas.height = exportH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);

          if (variant === 'light') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, exportW, exportH);
          }
          if (variant === 'dark') {
            ctx.fillStyle = '#0b0f1a';
            ctx.fillRect(0, 0, exportW, exportH);
          }

          ctx.drawImage(img, 0, 0, exportW, exportH);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = svgDataUrl;
      });
    },
    [getCurrentSvg]
  );

  useEffect(() => {
    if (!open) return;

    setSelectedVariant(theme === 'dark' ? 'dark' : 'light');
    setPreviews({ light: null, dark: null, transparent: null });

    let cancelled = false;
    const generate = async () => {
      setIsGenerating(true);
      const [light, dark, transparent] = await Promise.all(
        PREVIEW_ORDER.map((variant) => makePreview(variant))
      );
      if (!cancelled) {
        setPreviews({ light, dark, transparent });
        setIsGenerating(false);
      }
    };

    void generate();
    return () => {
      cancelled = true;
    };
  }, [open, makePreview, theme]);

  const actionMap = useMemo(
    () => ({
      light: onDownloadLight,
      dark: onDownloadDark,
      transparent: onDownloadTransparent,
    }),
    [onDownloadDark, onDownloadLight, onDownloadTransparent]
  );

  const getPreviewBg = (variant: BackgroundVariant) => {
    switch (variant) {
      case 'light':
        return 'bg-white border';
      case 'dark':
        return 'bg-gray-900 border';
      case 'transparent':
        return 'bg-[url("data:image/svg+xml,%3csvg width="20" height="20" xmlns="http://www.w3.org/2000/svg"%3e%3cdefs%3e%3cpattern id="a" width="20" height="20" patternUnits="userSpaceOnUse"%3e%3crect width="10" height="10" fill="%23f3f4f6"/%3e%3crect x="10" y="10" width="10" height="10" fill="%23f3f4f6"/%3e%3c/pattern%3e%3c/defs%3e%3crect width="100%25" height="100%25" fill="url(%23a)"/%3e%3c/svg%3e")] border';
    }
  };

  const handleDownload = () => {
    actionMap[selectedVariant]();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant='outline'
          size='default'
          className='text-sm shadow-sm cursor-pointer'
          aria-label='Select theme'
        >
          <Download className='h-4 w-4' />
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Export Diagram</DialogTitle>
          <DialogDescription>
            Choose a variant to download your diagram.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6'>
          {/* Preview */}
          <div className='space-y-3'>
            <div className='text-sm font-medium'>Preview</div>
            <div
              className={`aspect-video rounded-lg border p-4 flex items-center justify-center ${getPreviewBg(
                selectedVariant
              )}`}
            >
              {previews[selectedVariant] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previews[selectedVariant]}
                  alt={`${selectedVariant} preview`}
                  className='max-h-full max-w-full object-contain'
                />
              ) : isGenerating ? (
                <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Generating...
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>No preview</div>
              )}
            </div>
          </div>

          {/* Background Options */}
          <div className='space-y-3'>
            <div className='text-sm font-medium'>Background</div>
            <div className='grid grid-cols-3 gap-2'>
              {PREVIEW_ORDER.map((variant) => (
                <Button
                  key={variant}
                  variant={selectedVariant === variant ? 'default' : 'outline'}
                  onClick={() => setSelectedVariant(variant)}
                  className={`p-3 h-auto flex-col gap-1 cursor-pointer ${
                    selectedVariant === variant
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className='font-medium'>
                    {VARIANT_CONFIG[variant].label}
                  </div>
                  <div className='text-xs text-muted-foreground hidden sm:block'>
                    {VARIANT_CONFIG[variant].description}
                  </div>
                </Button>
              ))}
            </div>
          </div>

          {/* Download Actions */}
          <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-3'>
              <Button
                onClick={handleDownload}
                disabled={isGenerating && !previews[selectedVariant]}
                className='w-full cursor-pointer'
              >
                <Download className='mr-2 h-4 w-4' />
                PNG
              </Button>
              <Button
                variant='outline'
                onClick={() => {
                  onExportCode();
                  setOpen(false);
                }}
                className='w-full cursor-pointer'
              >
                <FileText className='mr-2 h-4 w-4' />
                .mmd
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
