'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import type { AgentActivityStep } from '@/components/diagram-editor';
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
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputTextarea,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePromptInputAttachments } from '@/components/ai-elements/prompt-input';
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

export function GenerateChat({
  currentCode,
  onDiagramGenerated,
  onApplyDiagram,
  onDismissResult,
}: GenerateChatProps) {
  const [input, setInput] = useState('');
  const [lastGeneratedDiagram, setLastGeneratedDiagram] = useState<string>('');
  const [showResult, setShowResult] = useState(false);
  const stickContextRef = useRef<StickToBottomContext | null>(null);
  const promptInputRef = useRef<PromptInputHandle | null>(null);

  // Shared editor and agent state
  const debouncedCurrentCode = useDebounced(currentCode, 120);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [hideAgentPanel, setHideAgentPanel] = useState<boolean>(false);

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
  type ToolCallStreamEvent = Record<string, unknown> & {
    type: 'tool-call';
    toolName?: string;
    args?: unknown;
    input?: unknown;
  };
  type ToolResultStreamEvent = Record<string, unknown> & {
    type: 'tool-result';
    toolName?: string;
    result?: unknown;
    output?: unknown;
  };
  type TextDeltaStreamEvent = Record<string, unknown> & {
    type: 'text-delta';
    accumulatedText?: unknown;
  };
  type FinishStreamEvent = Record<string, unknown> & {
    type: 'finish';
    usage?: unknown;
    totalUsage?: unknown;
    finishReason?: unknown;
  };
  type ErrorStreamEvent = Record<string, unknown> & {
    type: 'error';
    error?: unknown;
  };
  type GenericStreamEvent = Record<string, unknown> & {
    type: string;
  };
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

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
  const agentLoading = agentStreamingState.isLoading;
  const agentStreaming = agentStreamingState.isStreaming;

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
        prepareSendMessagesRequest: ({ messages, ...rest }) => {
          // Strip file attachments from message history to avoid sending images repeatedly
          // Only keep files in the most recent message to save input tokens
          const processedMessages = messages.map((msg, index) => {
            const isLastMessage = index === messages.length - 1;

            // Keep files only in the last message
            if (isLastMessage || !msg.parts) {
              return msg;
            }

            // For historical messages, filter out file parts
            const textOnlyParts = msg.parts.filter(
              (part: any) => part.type !== 'file'
            );

            return {
              ...msg,
              parts: textOnlyParts,
            };
          });

          return {
            ...rest,
            body: {
              messages: processedMessages,
            },
          };
        },
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

  // Convert blob URLs from PromptInput to Data URLs for server transmission
  const convertFilesToDataURLs = async (
    files: any[]
  ): Promise<
    { type: 'file'; mediaType: string; url: string; filename?: string }[]
  > => {
    return Promise.all(
      files.map(async (file) => {
        try {
          // Fetch the blob URL to get the actual file data
          const response = await fetch(file.url);
          const blob = await response.blob();

          // Convert blob to Data URL using FileReader
          return new Promise<{
            type: 'file';
            mediaType: string;
            url: string;
            filename?: string;
          }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                type: 'file',
                mediaType: file.mediaType || blob.type,
                url: reader.result as string, // Data URL: "data:image/jpeg;base64,..."
                filename: file.filename,
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          console.error('Failed to convert file:', error);
          throw error;
        }
      })
    );
  };

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

    // Convert blob URLs to Data URLs for server transmission
    const fileParts =
      hasFiles && message.files
        ? await convertFilesToDataURLs(message.files)
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

    // Clear attachments after successful submission to unlink from input and revoke blob URLs
    promptInputRef.current?.clear?.();
  };

  const hasMessages = messages.length > 0;

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='rounded-xl border border-border/60 bg-card/60 shadow-sm backdrop-blur-sm flex flex-col h-full min-h-0 overflow-hidden'>
        {/* Final Code Viewer at the top */}
        <div className='border-b border-border/60 p-3'>
          <div className='mx-auto w-full max-w-3xl'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-xs text-muted-foreground uppercase tracking-wide'>
                  Generated Diagram Code
                </span>
                {diagramError && (
                  <span className='text-xs text-destructive'>
                    ⚠️ Validation Error
                  </span>
                )}
              </div>
              {currentCode ? (
                <pre className='text-xs bg-background/50 p-3 rounded border overflow-auto max-h-32 font-mono'>
                  {currentCode}
                </pre>
              ) : (
                <div className='text-xs text-muted-foreground p-3 rounded border bg-background/50 border-dashed'>
                  No diagram code loaded yet
                </div>
              )}
            </div>
          </div>
        </div>

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

              {messages.map((message: any) => {
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
                        explanation = content.replace(mermaidRegex, '').trim();
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
        <div className='border-t border-border/60 bg-background/95 px-2 py-2'>
          <div className='mx-auto w-full max-w-3xl'>
            <PromptInput
              ref={promptInputRef}
              onSubmit={handleSubmit}
              className='border-none shadow-none'
              accept='image/*' // Accept only image files
              multiple={false} // Single image at a time
            >
              <PromptInputAttachments>
                {(attachment) => <PromptInputAttachment data={attachment} />}
              </PromptInputAttachments>
              <div className='flex items-end gap-1'>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputTextarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder='Upload a diagram image or describe what you want'
                  className='flex-1 min-h-[40px] max-h-[120px] resize-none'
                />
                <PromptInputSubmit
                  status={status}
                  disabled={
                    !input && status !== 'streaming' && status !== 'submitted'
                  }
                  className='bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                />
              </div>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
}
