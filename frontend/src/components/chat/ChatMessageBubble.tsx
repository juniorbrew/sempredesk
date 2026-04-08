'use client';

import { memo, useMemo } from 'react';
import { InlineChatMedia } from '@/components/chat/InlineChatMedia';
import AudioMessagePlayer from '@/components/chat/AudioMessagePlayer';
import ChatMessageMeta from '@/components/chat/ChatMessageMeta';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} style={{ background: '#FEF08A', color: '#0F172A', borderRadius: 2, padding: '0 2px' }}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function messageAuthorKey(m: { messageType?: string; authorType?: string; authorId?: string | null; authorName?: string; id?: string }): string {
  if (m.messageType === 'system') return `system:${m.id ?? ''}`;
  return `${m.authorType ?? ''}:${m.authorId ?? ''}:${m.authorName ?? ''}`;
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

export type ChatMessageBubbleProps = {
  m: any;
  isWhatsapp: boolean;
  highlight?: string;
  mediaUrl?: string | null;
  onReply?: (msg: any) => void;
  sameAuthorAsPrev: boolean;
  sameAuthorAsNext: boolean;
};

const BUBBLE_MAX = 340;

/**
 * Bolha de mensagem estilo WhatsApp Web: compacta, hora no canto inferior direito, agrupamento por autor.
 */
const ChatMessageBubble = memo(function ChatMessageBubble({
  m,
  isWhatsapp,
  highlight,
  mediaUrl,
  onReply,
  sameAuthorAsPrev,
  sameAuthorAsNext,
}: ChatMessageBubbleProps) {
  const isContact = m.authorType === 'contact';
  const isSystem = m.messageType === 'system';
  const t = useMemo(() => new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), [m.createdAt]);
  const col = avatarColor(m.authorName || '?');
  const localPreview = m._localPreviewUrl as string | undefined;
  const resolvedMediaSrc = mediaUrl || localPreview || null;
  const showMedia =
    (m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio' || m.mediaKind === 'video') &&
    (m.mediaKind === 'image' || m.mediaKind === 'audio' || m.mediaKind === 'video');
  const mediaLoading = showMedia && !resolvedMediaSrc && !m._optimistic;
  const hidePlaceholderCaption =
    !!resolvedMediaSrc && (m.content === '📷 Imagem' || m.content === '🎤 Áudio' || m.content === '📹 Vídeo');
  const showCaption = !!(m.content && !hidePlaceholderCaption);

  const accent = '#4F46E5';
  const accentLight = '#EEF2FF';
  const bg = '#FFFFFF';
  const txt = '#111118';
  const txt2 = '#6B6B80';

  const marginTop = sameAuthorAsPrev ? 2 : 10;
  const showAuthorLabel = isContact && !sameAuthorAsPrev;
  const showAvatar = isContact && !sameAuthorAsNext;

  const bubbleRadii = (() => {
    if (isContact) {
      if (sameAuthorAsPrev && sameAuthorAsNext) return '4px 14px 14px 4px';
      if (sameAuthorAsPrev) return '4px 14px 14px 6px';
      if (sameAuthorAsNext) return '14px 14px 14px 4px';
      return '14px 14px 14px 4px';
    }
    if (sameAuthorAsPrev && sameAuthorAsNext) return '14px 4px 4px 14px';
    if (sameAuthorAsPrev) return '14px 4px 14px 14px';
    if (sameAuthorAsNext) return '14px 14px 4px 14px';
    return '14px 14px 4px 14px';
  })();

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
        <div
          style={{
            background: '#EEF2FF',
            border: '1px solid #C7D2FE',
            borderRadius: 8,
            padding: '5px 14px',
            fontSize: 11,
            color: '#4338CA',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4338CA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
          </svg>
          {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
        </div>
      </div>
    );
  }

  const avatarColWidth = showAvatar ? 30 : 10;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        alignItems: isContact ? 'flex-start' : 'flex-end',
        marginTop,
      }}
    >
      {showAuthorLabel && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: txt2,
            marginBottom: 3,
            paddingLeft: avatarColWidth + 8,
          }}
        >
          {m.authorName}
        </span>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          flexDirection: isContact ? 'row' : 'row-reverse',
          maxWidth: '100%',
        }}
      >
        {isContact && (
          <div
            style={{
              width: avatarColWidth,
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              paddingBottom: 2,
            }}
          >
            {showAvatar ? (
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: col,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {initials(m.authorName || '?')}
              </div>
            ) : null}
          </div>
        )}

        <div
          style={{
            maxWidth: BUBBLE_MAX,
            minWidth: 0,
            padding: '6px 10px 5px',
            fontSize: 13,
            lineHeight: 1.45,
            position: 'relative',
            background: isContact ? bg : accent,
            color: isContact ? txt : '#fff',
            border: isContact ? '1px solid rgba(0,0,0,.07)' : 'none',
            borderRadius: bubbleRadii,
            boxShadow: isContact ? '0 1px 2px rgba(0,0,0,.04)' : '0 1px 6px rgba(79,70,229,.2)',
            opacity: m._optimistic ? 0.75 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {m.replyTo && (
            <div
              style={{
                borderLeft: `3px solid ${isContact ? accent : 'rgba(255,255,255,.6)'}`,
                background: isContact ? 'rgba(79,70,229,.07)' : 'rgba(255,255,255,.15)',
                borderRadius: 6,
                padding: '4px 8px',
                marginBottom: 6,
                fontSize: 12,
                opacity: 0.92,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2, color: isContact ? accent : 'rgba(255,255,255,.9)' }}>{m.replyTo.authorName}</div>
              <div
                style={{
                  color: isContact ? txt2 : 'rgba(255,255,255,.82)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: BUBBLE_MAX - 24,
                }}
              >
                {m.replyTo.mediaKind === 'image'
                  ? '📷 Imagem'
                  : m.replyTo.mediaKind === 'audio'
                    ? '🎤 Áudio'
                    : m.replyTo.mediaKind === 'video'
                      ? '📹 Vídeo'
                      : m.replyTo.content}
              </div>
            </div>
          )}

          {m.mediaKind === 'image' && resolvedMediaSrc && (
            <InlineChatMedia
              src={resolvedMediaSrc}
              mediaKind="image"
              imageStyle={{
                maxHeight: 240,
                marginBottom: showCaption ? 4 : 0,
                borderRadius: 8,
              }}
            />
          )}
          {m.mediaKind === 'audio' && resolvedMediaSrc && (
            <div style={{ marginBottom: showCaption ? 4 : 0 }}>
              <AudioMessagePlayer src={resolvedMediaSrc} variant={isContact ? 'received' : 'sent'} />
            </div>
          )}
          {m.mediaKind === 'video' && resolvedMediaSrc && (
            <InlineChatMedia
              src={resolvedMediaSrc}
              mediaKind="video"
              videoContainerStyle={{ marginBottom: showCaption ? 4 : 0 }}
              videoStyle={{
                maxWidth: 300,
                maxHeight: 240,
                borderRadius: 8,
              }}
            />
          )}
          {mediaLoading && <p style={{ margin: '0 0 6px', fontSize: 12, opacity: 0.85 }}>A carregar…</p>}

          {(showCaption || showMedia || mediaLoading) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                gap: '4px 8px',
              }}
            >
              {showCaption && (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', flex: '1 1 120px', minWidth: 48, wordBreak: 'break-word' }}>
                  {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
                </p>
              )}
              <ChatMessageMeta timeLabel={t} isContact={isContact} isWhatsapp={isWhatsapp} whatsappStatus={m.whatsappStatus} />
            </div>
          )}

          {!showCaption && !showMedia && !mediaLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <ChatMessageMeta timeLabel={t} isContact={isContact} isWhatsapp={isWhatsapp} whatsappStatus={m.whatsappStatus} />
            </div>
          )}
        </div>

        {onReply && !m._optimistic && !String(m.id).startsWith('_opt') && (
          <button
            type="button"
            onClick={() => onReply(m)}
            title="Responder"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 4px',
              color: '#94A3B8',
              fontSize: 11,
              borderRadius: 6,
              alignSelf: 'center',
              flexShrink: 0,
              opacity: 0.55,
              transition: 'opacity .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
          >
            ↩
          </button>
        )}
      </div>
    </div>
  );
});

export default ChatMessageBubble;
