'use client';

import { memo, useMemo } from 'react';
import { InlineChatMedia } from '@/components/chat/InlineChatMedia';
import AudioMessagePlayer from '@/components/chat/AudioMessagePlayer';
import ChatMessageMeta from '@/components/chat/ChatMessageMeta';
import { useTheme } from '@/components/ThemeProvider';
import { DEFAULT_CHAT_DENSITY_MODE, type ChatDensityMode } from '@/components/chat/chatDensity';

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

function bubbleBorderRadius(
  density: ChatDensityMode,
  isContact: boolean,
  sameAuthorAsPrev: boolean,
  sameAuthorAsNext: boolean,
): number | string {
  if (density === 'compact') return 8;
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
}

type ChatPalette = {
  received: { background: string; border: string; color: string };
  sent: { background: string; border: string; color: string };
  systemBg: string;
  systemBorder: string;
  systemColor: string;
  authorLabel: string;
  replyBorderContact: string;
  replyBorderSent: string;
  replyBgContact: string;
  replyBgSent: string;
  replyNameContact: string;
  replyNameSent: string;
  replySnippet: string;
  loadingText: string;
  replyBtn: string;
};

function chatPalette(theme: 'light' | 'dark'): ChatPalette {
  if (theme === 'dark') {
    return {
      received: { background: '#1E293B', border: '1px solid rgba(148,163,184,0.22)', color: '#E2E8F0' },
      sent: { background: 'rgba(91,33,182,0.35)', border: '1px solid rgba(167,139,250,0.45)', color: '#F1F5F9' },
      systemBg: '#1E293B',
      systemBorder: '1px solid rgba(148,163,184,0.22)',
      systemColor: '#94A3B8',
      authorLabel: '#94A3B8',
      replyBorderContact: '#64748B',
      replyBorderSent: '#A78BFA',
      replyBgContact: 'rgba(148,163,184,0.14)',
      replyBgSent: 'rgba(139,92,246,0.2)',
      replyNameContact: '#CBD5E1',
      replyNameSent: '#DDD6FE',
      replySnippet: '#94A3B8',
      loadingText: '#94A3B8',
      replyBtn: '#64748B',
    };
  }
  return {
    received: { background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#1E293B' },
    sent: { background: '#EDE9FE', border: '1px solid #DDD6FE', color: '#1E293B' },
    systemBg: '#F1F5F9',
    systemBorder: '1px solid #E2E8F0',
    systemColor: '#64748B',
    authorLabel: '#64748B',
    replyBorderContact: '#CBD5E1',
    replyBorderSent: '#C4B5FD',
    replyBgContact: 'rgba(241,245,249,0.95)',
    replyBgSent: 'rgba(237,233,254,0.85)',
    replyNameContact: '#475569',
    replyNameSent: '#6D28D9',
    replySnippet: '#64748B',
    loadingText: '#64748B',
    replyBtn: '#94A3B8',
  };
}

export type ChatMessageBubbleProps = {
  m: any;
  isWhatsapp: boolean;
  highlight?: string;
  mediaUrl?: string | null;
  onReply?: (msg: any) => void;
  sameAuthorAsPrev: boolean;
  sameAuthorAsNext: boolean;
  density?: ChatDensityMode;
};

const ChatMessageBubble = memo(function ChatMessageBubble({
  m,
  isWhatsapp,
  highlight,
  mediaUrl,
  onReply,
  sameAuthorAsPrev,
  sameAuthorAsNext,
  density = DEFAULT_CHAT_DENSITY_MODE,
}: ChatMessageBubbleProps) {
  const { theme } = useTheme();
  const P = useMemo(() => chatPalette(theme), [theme]);
  const isContact = m.authorType === 'contact';
  const isSystem = m.messageType === 'system';
  const t = useMemo(() => new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), [m.createdAt]);
  const localPreview = m._localPreviewUrl as string | undefined;
  const resolvedMediaSrc = mediaUrl || localPreview || null;
  const showMedia =
    (m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio' || m.mediaKind === 'video') &&
    (m.mediaKind === 'image' || m.mediaKind === 'audio' || m.mediaKind === 'video');
  const mediaLoading = showMedia && !resolvedMediaSrc && !m._optimistic;
  const hidePlaceholderCaption =
    !!resolvedMediaSrc && (m.content === '📷 Imagem' || m.content === '🎤 Áudio' || m.content === '📹 Vídeo');
  const showCaption = !!(m.content && !hidePlaceholderCaption);

  const bubbleMax = density === 'compact' ? 580 : 520;
  const bubbleMaxCss = `min(100%, ${bubbleMax}px)`;
  const marginTop = sameAuthorAsPrev ? (density === 'compact' ? 2 : 4) : density === 'compact' ? 8 : 12;
  const showAuthorLabel = isContact && !isSystem && !sameAuthorAsPrev;
  const showAvatar = density === 'normal' && isContact && !sameAuthorAsNext;
  const avatarColWidth = density === 'normal' && isContact ? 36 : 0;

  const padding = density === 'compact' ? '6px 10px' : '8px 12px';
  const hPad = density === 'compact' ? 20 : 24;
  const metaReserve = 56;
  const textMaxWidth = Math.max(140, bubbleMax - hPad - metaReserve);
  const innerContentMax = bubbleMax - hPad;

  const fontSize = density === 'compact' ? 13 : 14;
  const lineHeight = density === 'compact' ? 1.3 : 1.35;
  const borderRadius = bubbleBorderRadius(density, isContact, sameAuthorAsPrev, sameAuthorAsNext);
  const innerGap = density === 'compact' ? 6 : 8;

  const mediaMaxH = density === 'compact' ? 220 : 240;

  const replyBorder = isContact ? P.replyBorderContact : P.replyBorderSent;
  const replyBg = isContact ? P.replyBgContact : P.replyBgSent;
  const replyNameColor = isContact ? P.replyNameContact : P.replyNameSent;
  const replySnippetColor = P.replySnippet;
  const replyPadding = density === 'compact' ? '3px 5px' : '4px 6px';
  const replyFont = density === 'compact' ? 10.5 : 11;
  const replyMb = density === 'compact' ? 3 : 4;

  if (isSystem) {
    const sysMt = sameAuthorAsPrev ? (density === 'compact' ? 2 : 4) : density === 'compact' ? 6 : 8;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: sysMt }}>
        <div
          style={{
            display: 'inline-block',
            maxWidth: '92%',
            width: 'fit-content',
            padding: density === 'compact' ? '3px 8px' : '4px 10px',
            borderRadius: density === 'compact' ? 6 : 8,
            background: P.systemBg,
            border: P.systemBorder,
            color: P.systemColor,
            fontSize: density === 'compact' ? 11 : 12,
            lineHeight: 1.35,
            boxShadow: 'none',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
        </div>
      </div>
    );
  }

  const bubbleBase = isContact ? P.received : P.sent;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        alignItems: isContact ? 'flex-start' : 'flex-end',
        marginTop,
        width: '100%',
      }}
    >
      {showAuthorLabel && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: P.authorLabel,
            marginBottom: density === 'compact' ? 1 : 2,
            paddingLeft: avatarColWidth > 0 ? 4 : 2,
          }}
        >
          {m.authorName}
        </span>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: density === 'compact' ? 4 : 6,
          flexDirection: isContact ? 'row' : 'row-reverse',
          width: 'max-content',
          maxWidth: '100%',
          alignSelf: isContact ? 'flex-start' : 'flex-end',
        }}
      >
        {avatarColWidth > 0 && (
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
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: avatarColor(m.authorName || '?'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 11,
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
            width: 'fit-content',
            maxWidth: bubbleMaxCss,
            flexShrink: 0,
            boxSizing: 'border-box',
            padding,
            fontSize,
            lineHeight,
            position: 'relative',
            ...bubbleBase,
            borderRadius,
            boxShadow: 'none',
            opacity: m._optimistic ? 0.75 : 1,
            transition: 'opacity 0.2s',
          }}
        >
          {m.replyTo && (
            <div
              style={{
                borderLeft: `2px solid ${replyBorder}`,
                background: replyBg,
                borderRadius: 4,
                padding: replyPadding,
                marginBottom: replyMb,
                fontSize: replyFont,
                lineHeight: 1.3,
                maxWidth: innerContentMax,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 1, color: replyNameColor, fontSize: replyFont }}>{m.replyTo.authorName}</div>
              <div
                style={{
                  color: replySnippetColor,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: innerContentMax,
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
            <div style={{ maxWidth: innerContentMax }}>
              <InlineChatMedia
                src={resolvedMediaSrc}
                mediaKind="image"
                imageStyle={{
                  maxHeight: mediaMaxH,
                  marginBottom: showCaption ? replyMb : 0,
                  borderRadius: density === 'compact' ? 6 : 8,
                  width: 'auto',
                  height: 'auto',
                }}
              />
            </div>
          )}
          {m.mediaKind === 'audio' && resolvedMediaSrc && (
            <div style={{ marginBottom: showCaption ? replyMb : 0, maxWidth: innerContentMax, minWidth: 0 }}>
              <AudioMessagePlayer src={resolvedMediaSrc} variant={isContact ? 'received' : 'sent'} density={density} />
            </div>
          )}
          {m.mediaKind === 'video' && resolvedMediaSrc && (
            <div style={{ maxWidth: innerContentMax }}>
              <InlineChatMedia
                src={resolvedMediaSrc}
                mediaKind="video"
                videoContainerStyle={{ marginBottom: showCaption ? replyMb : 0 }}
                videoStyle={{
                  maxWidth: innerContentMax,
                  width: '100%',
                  maxHeight: mediaMaxH,
                  borderRadius: density === 'compact' ? 6 : 8,
                }}
              />
            </div>
          )}
          {mediaLoading && (
            <p style={{ margin: `0 0 ${replyMb}px`, fontSize: density === 'compact' ? 11 : 12, opacity: 0.85, color: P.loadingText }}>A carregar…</p>
          )}

          {(showCaption || showMedia || mediaLoading) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
                gap: innerGap,
              }}
            >
              {showCaption ? (
                <p
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxWidth: textMaxWidth,
                    flexShrink: 0,
                  }}
                >
                  {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
                </p>
              ) : null}
              <ChatMessageMeta
                timeLabel={t}
                isContact={isContact}
                isWhatsapp={isWhatsapp}
                whatsappStatus={m.whatsappStatus}
                density={density}
              />
            </div>
          )}

          {!showCaption && !showMedia && !mediaLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
              <ChatMessageMeta
                timeLabel={t}
                isContact={isContact}
                isWhatsapp={isWhatsapp}
                whatsappStatus={m.whatsappStatus}
                density={density}
              />
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
              color: P.replyBtn,
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
