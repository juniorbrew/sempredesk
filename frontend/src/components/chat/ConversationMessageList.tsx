'use client';

import type { CSSProperties, RefObject, UIEventHandler } from 'react';
import { MessageSquare } from 'lucide-react';
import ChatMessageBubble, { messageAuthorKey } from '@/components/chat/ChatMessageBubble';

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
};

function MessageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
      {([false, true, false] as boolean[]).map((right, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: right ? 'row-reverse' : 'row' }}>
          <div className="animate-pulse" style={{ width: 28, height: 28, borderRadius: '50%', background: '#E2E8F0', flexShrink: 0 }} />
          <div className="animate-pulse" style={{ width: `${38 + i * 12}%`, height: 44, borderRadius: 12, background: '#E2E8F0' }} />
        </div>
      ))}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string) {
  const COLORS = ['#16A34A', '#2563EB', '#EA580C', '#7C3AED', '#E11D48', '#0891B2', '#4F46E5', '#B45309'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
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
}: ConversationMessageListProps) {
  const typingName = typingContactName || '?';

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
                  style={isCurrentMatch ? { borderRadius: 14, outline: '2px solid #FDE68A', outlineOffset: 3 } : undefined}
                >
                  <ChatMessageBubble
                    m={m}
                    isWhatsapp={isWhatsapp}
                    highlight={msgSearchQuery.trim() || undefined}
                    mediaUrl={messageMediaUrls[m.id] ?? null}
                    onReply={onReply}
                    sameAuthorAsPrev={sameAuthorAsPrev}
                    sameAuthorAsNext={sameAuthorAsNext}
                  />
                </div>
              );
            });
          })()}
        </div>
      )}
      {isContactTyping && isWhatsapp && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: avatarColor(typingName),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initials(typingName)}
          </div>
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid rgba(0,0,0,.09)',
              borderRadius: '18px 18px 18px 4px',
              padding: '10px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,.06)',
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
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#A8A8BE',
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
