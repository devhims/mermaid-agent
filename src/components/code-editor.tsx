'use client';

import { useState, useEffect } from 'react';
import { Code, Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';

interface AISuggestion {
  fixedCode: string;
  rationale?: string;
  changes?: string[];
}

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  onReset: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  aiSuggestion: AISuggestion | null;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
  aiLoading: boolean;
  onFixWithAI: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function CodeEditor({
  code,
  onCodeChange,
  onReset,
  onImport,
  onExport,
  aiSuggestion,
  onAcceptSuggestion,
  onDismissSuggestion,
  aiLoading,
  onFixWithAI,
  isCollapsed = true,
  onToggleCollapse,
}: CodeEditorProps) {
  const [isOpen, setIsOpen] = useState(!isCollapsed);

  // Sync internal state with external collapsed state
  useEffect(() => {
    setIsOpen(!isCollapsed);
  }, [isCollapsed]);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    onToggleCollapse?.();
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className='relative'>
        <CollapsibleContent className='space-y-4'>
          <div className='rounded-lg border bg-card/50 backdrop-blur-sm shadow-sm p-4 space-y-4'>
            {/* Header */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Code className='h-4 w-4 text-muted-foreground' />
                <span className='text-sm font-medium'>Mermaid Code</span>
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onReset}
                  className='h-8 px-2 text-xs'
                >
                  <RotateCcw className='h-3 w-3 mr-1' />
                  Reset
                </Button>

                <Button
                  variant='ghost'
                  size='sm'
                  onClick={onFixWithAI}
                  disabled={aiLoading}
                  className='h-8 px-2 text-xs'
                >
                  {aiLoading ? 'Fixing...' : 'Fix with AI'}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Code Editor */}
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-muted-foreground uppercase tracking-wide'>
                  Editor
                </span>
                <div className='flex gap-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => navigator.clipboard.writeText(code)}
                    className='h-7 px-2 text-xs'
                  >
                    <Copy className='h-3 w-3 mr-1' />
                    Copy
                  </Button>
                  <label className='cursor-pointer'>
                    <input
                      type='file'
                      accept='.mmd,.mermaid,.txt'
                      className='hidden'
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onImport(file);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              <textarea
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                spellCheck={false}
                className='w-full h-64 resize-none rounded-md border bg-background px-3 py-2 text-sm font-mono leading-relaxed shadow-sm focus:ring-2 focus:ring-ring focus:border-transparent transition-colors'
                placeholder='Paste your Mermaid code here...'
              />
            </div>

            {/* AI Suggestion */}
            {aiSuggestion && (
              <div className='rounded-md border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-3'>
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium text-emerald-800 dark:text-emerald-200'>
                    AI Suggestion
                  </span>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      onClick={onAcceptSuggestion}
                      className='h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700'
                    >
                      Apply
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={onDismissSuggestion}
                      className='h-7 px-2 text-xs'
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>

                {aiSuggestion.rationale && (
                  <p className='text-xs text-muted-foreground'>
                    {aiSuggestion.rationale}
                  </p>
                )}

                <pre className='text-xs bg-background/50 p-2 rounded border overflow-auto max-h-32'>
                  {aiSuggestion.fixedCode}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>

        {/* Collapsed State Indicator */}
        {!isOpen && (
          <div className='absolute inset-y-0 right-0 flex items-center'>
            <div className='bg-card/80 backdrop-blur-sm border rounded-l-md px-2 py-1 shadow-sm'>
              <Code className='h-4 w-4 text-muted-foreground' />
            </div>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
