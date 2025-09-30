'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { upload } from '@vercel/blob/client';
import { Copy, CheckCheck, Paperclip } from 'lucide-react';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import type { AgentActivityStep } from '@/components/diagram-editor';
import type { FileUIPart } from 'ai';
import { validateMermaid } from '@/lib/mermaid-validator';
import { formatLintErrors } from '@/lib/mermaid-lint';
import { useDebounced } from '@/hooks/useDebounced';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Loader } from '@/components/ai-elements/loader';
import { Response } from '@/components/ai-elements/response';
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PromptInputHandle } from '@/components/ai-elements/prompt-input';

type GenerateChatProps = {
  currentCode: string;
  onDiagramGenerated: (
    diagram: string,
    explanation?: string | string[]
  ) => void;
  onApplyDiagram?: (diagram: string) => void;
  onDismissResult?: () => void;
};

const DEFAULT_CODE = `%% Mermaid Viewer — sample
graph TD
  A[Start] --> B{Condition?}
  B -- Yes --> C[Do thing]
  B -- No  --> D[Skip]
  C --> E[Finish]
  D --> E
`;

export function GenerateChat({
  currentCode,
  onDiagramGenerated,
}: GenerateChatProps) {
  const [input, setInput] = useState('');

  // Check if current code is the default sample code
  const isDefaultCode = currentCode.trim() === DEFAULT_CODE.trim();
  const [copied, setCopied] = useState(false);
  const stickContextRef = useRef<StickToBottomContext | null>(null);
  const promptInputRef = useRef<PromptInputHandle | null>(null);

  // Shared editor and agent state
  const debouncedCurrentCode = useDebounced(currentCode, 120);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // Upload state tracking
  const [fileUploadStates, setFileUploadStates] = useState<
    Record<
      string,
      {
        status: 'uploading' | 'complete' | 'error';
        blobUrl?: string;
        error?: string;
        progress?: number; // 0-100
      }
    >
  >({});

  type AgentUsage = {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  type AgentStatus = {
    label: string;
    detail?: string;
    tone: 'progress' | 'success' | 'error';
    toolName?: string;
  };

  type AgentStream = {
    steps: AgentActivityStep[];
    message?: string;
    finalCode?: string;
    validated?: boolean;
    stepsUsed?: number;
    toolCallCount?: number;
    usage?: AgentUsage;
    status?: AgentStatus;
  } | null;
  const [agentStream, setAgentStream] = useState<AgentStream>(null);
  const [agentStreamingState, setAgentStreamingState] = useState({
    isLoading: false,
    isStreaming: false,
    abortController: null as AbortController | null,
    runId: null as number | null,
  });

  const normalizeDiagram = (raw: string): string => {
    // Strip code fences and leading/trailing whitespace
    const withoutFences = raw
      .replace(/^```mermaid\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    return withoutFences;
  };

  // Validate the current diagram code
  useEffect(() => {
    const code = debouncedCurrentCode.trim();
    if (!code) {
      setDiagramError(null);
      return;
    }
    try {
      const validation = validateMermaid(code);
      if (validation.ok) {
        setDiagramError(null);
      } else {
        const header = 'Mermaid syntax issues detected.';
        const raw = validation.rawMessage
          ? `Parser: ${validation.rawMessage}`
          : undefined;
        const hints =
          validation.errors && validation.errors.length
            ? formatLintErrors(validation.errors, { max: 6 })
            : undefined;
        const composed = [header, raw, hints].filter(Boolean).join('\n');
        setDiagramError(composed || 'Invalid Mermaid diagram.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown validation error';
      setDiagramError(msg);
    }
  }, [debouncedCurrentCode]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/generate',
      }),
    []
  );

  const { messages, status, stop, sendMessage } = useChat({
    transport,
    onFinish: (options: any) => {
      console.log('onFinish called with:', options);

      // With AI SDK v5 structured output, we should get structured data
      const message = options.message;

      // Check if we have structured output in the message content
      let diagram = '';
      let explanation = '';

      // Look for structured output in message parts
      if (message?.parts && Array.isArray(message.parts)) {
        for (const part of message.parts) {
          if (part.type === 'text' && part.text) {
            try {
              // Try to parse as JSON first (structured output)
              const parsed = JSON.parse(part.text);
              if (parsed.diagram && typeof parsed.diagram === 'string') {
                diagram = parsed.diagram;
                explanation = parsed.explanation || '';
                break;
              }
            } catch {
              // Not JSON, continue to fallback
            }
          }
        }
      }

      // Fallback: look for any text content if no structured output found
      if (!diagram) {
        const content =
          typeof message?.content === 'string'
            ? message.content
            : Array.isArray(message?.content)
            ? message.content.join('')
            : '';

        if (content) {
          try {
            // Try parsing the content as JSON
            const parsed = JSON.parse(content);
            if (parsed.diagram) {
              diagram = parsed.diagram;
              explanation = parsed.explanation || '';
            }
          } catch {
            // If not JSON, fallback to regex parsing
            const mermaidRegex =
              /(?:```mermaid\s*)?((?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gitgraph|pie|journey|gantt|quadrantChart|requirement|mindmap|timeline|zenuml|sankey|block|packet|architecture)[\s\S]*?)(?:```)?$/m;

            const match = content.match(mermaidRegex);
            if (match && match[1]) {
              diagram = match[1].trim();
              explanation = content.replace(mermaidRegex, '').trim();
            }
          }
        }
      }

      if (diagram) {
        diagram = normalizeDiagram(diagram);
        onDiagramGenerated(diagram, explanation || undefined);
      }
    },
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      stickContextRef.current?.scrollToBottom({ animation: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, status]);

  const handleSubmit = async (
    message: { text?: string | null; files?: any[] },
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    console.log('handleSubmit called with:', message);

    // If currently submitting or streaming, stop the request
    if (status === 'submitted' || status === 'streaming') {
      stop();
      return;
    }

    const hasText = Boolean(message.text?.trim());
    const hasFiles = Boolean(message.files?.length);
    console.log('hasText:', hasText, 'hasFiles:', hasFiles);

    if (!hasText && !hasFiles) return;

    setInput('');

    // Visually detach attachments immediately via imperative handle
    promptInputRef.current?.unlink?.();

    // Use already uploaded blob URLs
    const fileParts =
      hasFiles && message.files
        ? message.files.map((file) => {
            const uploadState = fileUploadStates[file.id];
            return {
              type: 'file' as const,
              mediaType: file.mediaType,
              url: uploadState?.blobUrl || file.url, // Use blob URL if available, fallback to original
              filename: file.filename,
            };
          })
        : [];

    console.log('Sending message with text and file parts:', {
      text: message.text,
      fileParts: fileParts.map((f) => ({
        ...f,
        url: `${f.url.substring(0, 50)}...`,
      })),
    });

    // Send message with parts array (AI SDK v5 pattern)
    await sendMessage({
      role: 'user',
      parts: [
        ...(hasText ? [{ type: 'text' as const, text: message.text! }] : []),
        ...fileParts,
      ],
    });

    // Clear attachments and upload states after successful submission
    promptInputRef.current?.clear?.();
    setFileUploadStates({});
  };

  const hasMessages = messages.length > 0;

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Handle file uploads when files are added
  const handleFilesAdded = useCallback(
    async (files: (FileUIPart & { id: string })[]) => {
      // Set all new files to uploading state
      setFileUploadStates((prev) => {
        const newStates = { ...prev };
        files.forEach((file) => {
          newStates[file.id] = { status: 'uploading', progress: 0 };
        });
        return newStates;
      });

      // Upload each file
      for (const file of files) {
        try {
          const response = await fetch(file.url);
          const blob = await response.blob();

          const blobResult = await upload(file.filename || 'upload', blob, {
            access: 'public',
            handleUploadUrl: '/api/upload-blob',
            onUploadProgress: (progress) => {
              setFileUploadStates((prev) => ({
                ...prev,
                [file.id]: {
                  ...prev[file.id],
                  progress: progress.percentage,
                },
              }));
            },
          });

          setFileUploadStates((prev) => ({
            ...prev,
            [file.id]: {
              status: 'complete',
              blobUrl: blobResult.url,
            },
          }));
        } catch (error) {
          console.error('Upload failed:', error);
          setFileUploadStates((prev) => ({
            ...prev,
            [file.id]: {
              status: 'error',
              error: error instanceof Error ? error.message : 'Upload failed',
            },
          }));
        }
      }
    },
    []
  );

  // Handle file removal
  const handleFileRemoved = useCallback((fileId: string) => {
    setFileUploadStates((prev) => {
      const newStates = { ...prev };
      delete newStates[fileId];
      return newStates;
    });
  }, []);

  // Set up the callbacks when component mounts
  useEffect(() => {
    if (promptInputRef.current?.setOnFilesAdded) {
      promptInputRef.current.setOnFilesAdded(handleFilesAdded);
    }
    if (promptInputRef.current?.setOnFileRemoved) {
      promptInputRef.current.setOnFileRemoved(handleFileRemoved);
    }
  }, [handleFilesAdded, handleFileRemoved]);

  // Check if all uploads are complete
  const allUploadsComplete = Object.values(fileUploadStates).every(
    (state) => state.status === 'complete'
  );
  const hasPendingUploads = Object.values(fileUploadStates).some(
    (state) => state.status === 'uploading'
  );

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='rounded-lg border border-border/60 bg-card/60 shadow-sm backdrop-blur-sm flex flex-col h-full min-h-0 overflow-hidden'>
        {/* Final Code Viewer at the top - only show when we have generated code */}
        {!isDefaultCode && (
          <div className='border-b border-border/60 p-3'>
            <div className='mx-auto w-full max-w-3xl'>
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground uppercase tracking-wide'>
                    Generated Diagram Code
                  </span>
                  <div className='flex items-center gap-2'>
                    {diagramError && (
                      <span className='text-xs text-destructive'>
                        ⚠️ Validation Error
                      </span>
                    )}
                    {currentCode && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleCopyClick}
                        className='h-6 px-2 text-xs cursor-pointer'
                      >
                        {copied ? (
                          <CheckCheck className='h-3 w-3 text-white' />
                        ) : (
                          <Copy className='h-3 w-3' />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                {currentCode ? (
                  <textarea
                    value={currentCode}
                    onChange={(e) => onDiagramGenerated(e.target.value)}
                    spellCheck={false}
                    className='w-full h-32 resize-none rounded-md border bg-background px-3 py-2 text-xs font-mono leading-relaxed shadow-sm focus:ring-2 focus:ring-ring focus:border-transparent transition-colors overflow-auto'
                    placeholder='Generated diagram code will appear here...'
                  />
                ) : (
                  <div className='text-xs text-muted-foreground p-3 rounded border bg-background/50 border-dashed h-32 flex items-center justify-center'>
                    No diagram code loaded yet
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className='flex-1 min-h-0 flex flex-col'>
          <Conversation
            contextRef={stickContextRef}
            className='w-full flex-1 overscroll-contain bg-gradient-to-br from-background via-background to-muted/30'
          >
            <ConversationContent
              className={cn(
                'mx-auto w-full max-w-3xl space-y-4 py-6 pb-28',
                !hasMessages &&
                  'flex min-h-full flex-col items-center justify-center text-center text-muted-foreground'
              )}
            >
              {!hasMessages && (
                <div className='space-y-2'>
                  <h3 className='text-lg font-medium'>
                    Sketch ideas into Mermaid diagrams
                  </h3>
                  <p className='text-xs text-muted-foreground'>
                    Share what you need and the agent will craft a validated
                    diagram
                  </p>
                </div>
              )}

              {messages
                .filter((message: any) => {
                  // For assistant messages, only show if they have actual content
                  if (message.role === 'assistant') {
                    // Extract content to check if it exists
                    let content = '';
                    let diagram = '';

                    // Check message parts for content
                    if (message?.parts && Array.isArray(message.parts)) {
                      for (const part of message.parts) {
                        if (part.type === 'text' && part.text) {
                          try {
                            const parsed = JSON.parse(part.text);
                            if (
                              parsed.diagram &&
                              typeof parsed.diagram === 'string'
                            ) {
                              return true; // Has structured content
                            }
                          } catch {
                            if (part.text.trim()) {
                              return true; // Has text content
                            }
                          }
                        }
                      }
                    }

                    // Check regular content formats
                    const anyMsg = message as any;
                    if (
                      typeof anyMsg.content === 'string' &&
                      anyMsg.content.trim()
                    ) {
                      return true;
                    } else if (Array.isArray(anyMsg.content)) {
                      const hasContent = anyMsg.content.some((part: any) => {
                        if (typeof part === 'string') return part.trim();
                        if (part?.text) return part.text.trim();
                        if (part?.content) return part.content.trim();
                        return false;
                      });
                      if (hasContent) return true;
                    } else if (anyMsg.text && anyMsg.text.trim()) {
                      return true;
                    }

                    return false; // No content, don't show the message
                  }
                  return true; // Show user messages
                })
                .map((message: any) => {
                  console.log('Message object:', message); // Debug log

                  // Extract content and handle structured output
                  let content = '';
                  let diagram = '';
                  let explanation = '';

                  // First, try to extract structured output from message parts
                  if (message?.parts && Array.isArray(message.parts)) {
                    for (const part of message.parts) {
                      if (part.type === 'text' && part.text) {
                        try {
                          // Try to parse as JSON first (structured output)
                          const parsed = JSON.parse(part.text);
                          if (
                            parsed.diagram &&
                            typeof parsed.diagram === 'string'
                          ) {
                            diagram = parsed.diagram;
                            explanation = parsed.explanation || '';
                            content = explanation; // Use explanation as content for display
                            break;
                          }
                        } catch {
                          // Not JSON, use as regular content
                          content += part.text;
                        }
                      }
                    }
                  }

                  // Fallback: extract from regular content formats
                  if (!content && !diagram) {
                    const anyMsg = message as any;
                    if (typeof anyMsg.content === 'string') {
                      content = anyMsg.content;
                    } else if (Array.isArray(anyMsg.content)) {
                      content = anyMsg.content
                        .map((part: any) => {
                          if (typeof part === 'string') return part;
                          if (part?.text) return part.text;
                          if (part?.content) return part.content;
                          return '';
                        })
                        .join('');
                    } else if (anyMsg.text) {
                      content = anyMsg.text;
                    } else {
                      content = String(anyMsg.content || anyMsg.text || '');
                    }

                    // Try to parse content as JSON if we haven't found structured data
                    if (message.role === 'assistant' && content && !diagram) {
                      try {
                        const parsed = JSON.parse(content);
                        if (parsed.diagram) {
                          diagram = parsed.diagram;
                          explanation = parsed.explanation || '';
                          content = explanation; // Use explanation as display content
                        }
                      } catch {
                        // Not JSON, try regex parsing as fallback
                        const mermaidRegex =
                          /(?:```mermaid\s*)?((?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gitgraph|pie|journey|gantt|quadrantChart|requirement|mindmap|timeline|zenuml|sankey|block|packet|architecture)[\s\S]*?)(?:```)?$/m;

                        const match = content.match(mermaidRegex);
                        if (match && match[1]) {
                          diagram = match[1].trim();
                          explanation = content
                            .replace(mermaidRegex, '')
                            .trim();
                          content = explanation;
                        }
                      }
                    }
                  }

                  // Collect image attachments to render in the user bubble
                  const attachmentImages: string[] = [];
                  if (message?.parts && Array.isArray(message.parts)) {
                    for (const part of message.parts) {
                      const p: any = part;
                      if (
                        p?.type === 'file' &&
                        typeof p?.url === 'string' &&
                        typeof p?.mediaType === 'string' &&
                        p.mediaType.startsWith('image/')
                      ) {
                        attachmentImages.push(p.url);
                      } else if (p?.type === 'image') {
                        // Support both { image: base64, mediaType } and { image: { data, mimeType } }
                        const base64: string | undefined =
                          typeof p.image === 'string'
                            ? p.image
                            : typeof p.image?.data === 'string'
                            ? p.image.data
                            : undefined;
                        const mediaType: string | undefined =
                          typeof p.mediaType === 'string'
                            ? p.mediaType
                            : typeof p.image?.mimeType === 'string'
                            ? p.image.mimeType
                            : undefined;
                        if (base64 && mediaType) {
                          attachmentImages.push(
                            `data:${mediaType};base64,${base64}`
                          );
                        }
                      }
                    }
                  }

                  return (
                    <Message key={message.id} from={message.role}>
                      <MessageContent>
                        {message.role === 'assistant' ? (
                          <>{content && <Response>{content}</Response>}</>
                        ) : (
                          <>
                            {attachmentImages.length > 0 && (
                              <div className='mb-2 grid grid-cols-2 gap-2'>
                                {attachmentImages.map((src, i) => (
                                  <img
                                    key={i}
                                    src={src}
                                    alt='Attached image'
                                    className='max-h-40 w-auto rounded-md border object-contain'
                                  />
                                ))}
                              </div>
                            )}
                            <Response>{content || 'No content'}</Response>
                          </>
                        )}
                      </MessageContent>
                    </Message>
                  );
                })}

              {(status === 'streaming' || status === 'submitted') && <Loader />}
            </ConversationContent>
            <ConversationScrollButton className='bottom-20 z-30' />
          </Conversation>
        </div>

        {/* Prompt input stays at the bottom to drive generation */}
        <div className='border-t border-border bg-muted/30 px-2 py-2'>
          <div className='mx-auto w-full max-w-3xl'>
            <PromptInput
              ref={promptInputRef}
              onSubmit={handleSubmit}
              className='border border-border bg-background shadow-sm'
              accept='image/*' // Accept only image files
              multiple={false} // Single image at a time
            >
              <PromptInputAttachments>
                {(attachment) => (
                  <PromptInputAttachment
                    data={attachment}
                    uploadState={fileUploadStates[attachment.id]}
                  />
                )}
              </PromptInputAttachments>
              <div className='flex items-end gap-2'>
                <PromptInputButton
                  className='h-11 w-11 border border-primary/20 bg-background hover:bg-muted/50 cursor-pointer'
                  onClick={() => {
                    promptInputRef.current?.fileInputRef.current?.click();
                  }}
                >
                  <Paperclip className='size-4' />
                </PromptInputButton>
                <PromptInputTextarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder='Upload a diagram image or describe what you want'
                  className='flex-1 min-h-11 max-h-[120px] resize-none'
                  preventSubmit={hasPendingUploads}
                />
                <PromptInputSubmit
                  status={status}
                  disabled={
                    (!input &&
                      status !== 'streaming' &&
                      status !== 'submitted') ||
                    hasPendingUploads ||
                    !allUploadsComplete
                  }
                  className='h-11 w-11 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 border border-primary/20 cursor-pointer'
                />
              </div>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
}
