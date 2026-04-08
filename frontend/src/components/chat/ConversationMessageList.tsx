'use client';

import type { CSSProperties, RefObject, UIEventHandler } from 'react';
import { MessageSquare } from 'lucide-react';
import ChatMessageBubble, { messageAuthorKey } from '@/components/chat/ChatMessageBubble';
import { useTheme } from '@/components/ThemeProvider';
import { DEFAULT_CHAT_DENSITY_MODE, type ChatDensityMode } from '@/components/chat/chatDensity';

/** Estilos alinhados ao objeto `S` da tela de atendimento (evita acoplar ao layout pai). */
export type ConversationMessageListTheme = {
  border2: string;
  txt3: string;
};

export type ConversationMessageListProps = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  /** Estilo do div rolável (padding, flex, etc.) */
  containerStyle: CSSProperties;
  theme: ConversationMessageListTheme;
  messages: any[];
  loadingChat: boolean;
  loadingMoreMsgs: boolean;
  hasMoreMsgs: boolean;
  onLoadMore: () => void;
  messageMediaUrls: Record<string, string | undefined | null>;
  isWhatsapp: boolean;
  msgSearchQuery: string;
  msgSearchIdx: number;
  msgMatchIds: string[];
  onReply: (msg: any) => void;
  isContactTyping: boolean;
  /** Nome do contato para avatar no indicador "digitando…" */
  typingContactName?: string | null;
  /** Densidade das bolhas (normal = WhatsApp-like; compact = mais denso). */
  chatDensity?: ChatDensityMode;
};

function MessageSkeleton() {
  const { theme } = useTheme();
  const barBg = theme === 'dark' ? '#334155' : '#E2E8F0';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
      {([false, true, false] as boolean[]).map((right, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: right ? 'flex-end' : 'flex-start' }}>
          <div className="animate-pulse" style={{ width: `${42 + i * 10}%`, height: 32, borderRadius: 8, background: barBg }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Lista rolável de mensagens da conversa (inbox atendimento): skeleton, histórico, bolhas agrupadas, digitando, âncora final.
 */
export default function ConversationMessageList({
  scrollContainerRef,
  messagesEndRef,
  onScroll,
  containerStyle,
  theme: S,
  messages,
  loadingChat,
  loadingMoreMsgs,
  hasMoreMsgs,
  onLoadMore,
  messageMediaUrls,
  isWhatsapp,
  msgSearchQuery,
  msgSearchIdx,
  msgMatchIds,
  onReply,
  isContactTyping,
  typingContactName,
  chatDensity = DEFAULT_CHAT_DENSITY_MODE,
}: ConversationMessageListProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const compact = chatDensity === 'compact';
  const typingNameColor = isDark ? '#94A3B8' : '#64748B';
  const typingBubbleBg = isDark ? '#1E293B' : '#F1F5F9';
  const typingBubbleBorder = isDark ? '1px solid rgba(148,163,184,0.22)' : '1px solid #E2E8F0';

  return (
    <div ref={scrollContainerRef} onScroll={onScroll} style={containerStyle}>
      {loadingChat && messages.length === 0 ? (
        <MessageSkeleton />
      ) : messages.length === 0 ? (
        <div style={{ margin: 'auto', textAlign: 'center', color: S.txt3, fontSize: 13 }}>
          <MessageSquare size={32} style={{ margin: '0 auto 10px', opacity: 0.25 }} />
          <p style={{ margin: 0 }}>Nenhuma mensagem ainda</p>
        </div>
      ) : (
        <div style={{ display: 'contents', opacity: loadingChat ? 0.55 : 1, transition: 'opacity 0.18s' }}>
          {loadingMoreMsgs && (
            <div style={{ textAlign: 'center', padding: '8px 0', color: S.txt3, fontSize: 12 }}>Carregando histórico...</div>
          )}
          {!loadingMoreMsgs && hasMoreMsgs && (
            <div style={{ textAlign: 'center', padding: '4px 0' }}>
              <button
                type="button"
                onClick={onLoadMore}
                style={{
                  background: 'none',
                  border: S.border2,
                  borderRadius: 12,
                  padding: '4px 14px',
                  fontSize: 12,
                  color: S.txt3,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Carregar mensagens anteriores
              </button>
            </div>
          )}
          {(() => {
            const visible = messages.filter((m: any) => m.messageType !== 'internal');
            return visible.map((m: any, i: number) => {
              const prev = visible[i - 1];
              const next = visible[i + 1];
              const keyCur = messageAuthorKey(m);
              const sameAuthorAsPrev =
                !!prev && prev.messageType !== 'system' && m.messageType !== 'system' && messageAuthorKey(prev) === keyCur;
              const sameAuthorAsNext =
                !!next && next.messageType !== 'system' && m.messageType !== 'system' && messageAuthorKey(next) === keyCur;
              const isCurrentMatch =
                msgSearchQuery.trim() !== '' &&
                msgMatchIds.length > 0 &&
                msgMatchIds[Math.min(msgSearchIdx, msgMatchIds.length - 1)] === m.id;
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  style={isCurrentMatch ? { borderRadius: 8, outline: '2px solid #FDE68A', outlineOffset: 2 } : undefined}
                >
                  <ChatMessageBubble
                    m={m}
                    isWhatsapp={isWhatsapp}
                    highlight={msgSearchQuery.trim() || undefined}
                    mediaUrl={messageMediaUrls[m.id] ?? null}
                    onReply={onReply}
                    sameAuthorAsPrev={sameAuthorAsPrev}
                    sameAuthorAsNext={sameAuthorAsNext}
                    density={chatDensity}
                  />
                </div>
              );
            });
          })()}
        </div>
      )}
      {isContactTyping && isWhatsapp && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: compact ? 1 : 2,
            marginTop: compact ? 4 : 6,
            paddingLeft: compact ? 0 : 40,
          }}
        >
          {typingContactName ? (
            <span
              style={{
                fontSize: compact ? 11 : 12,
                fontWeight: 500,
                color: typingNameColor,
                paddingLeft: compact ? 0 : 4,
              }}
            >
              {typingContactName}
            </span>
          ) : null}
          <div
            style={{
              background: typingBubbleBg,
              border: typingBubbleBorder,
              borderRadius: compact ? 6 : 8,
              padding: compact ? '5px 10px' : '6px 12px',
              boxShadow: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#94A3B8',
                    display: 'inline-block',
                    animation: `typingDot 1.2s ${i * 0.2}s infinite ease-in-out`,
                  }}
                />
              ))}
            </span>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
