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

/** Classificação para bolha do Atendimento: áudio/imagem/vídeo inalterados; resto → arquivo compacto. */
type BubbleMediaKind = 'image' | 'audio' | 'video' | 'file' | null;

function resolveBubbleMediaKind(m: {
  hasMedia?: boolean;
  mediaKind?: string | null;
  mediaMime?: string | null;
  attachments?: Array<{ kind?: string; mime?: string | null }> | null;
}): BubbleMediaKind {
  let has = !!(m.hasMedia || m.mediaKind);
  let mediaMime = m.mediaMime;
  let mk = m.mediaKind;
  const att0 = Array.isArray(m.attachments) && m.attachments.length ? m.attachments[0] : null;
  if (!has && att0?.kind === 'ticket_reply_file' && att0.mime) {
    has = true;
    mediaMime = att0.mime;
    mk = null;
  }
  if (!has) return null;
  const mkStr = String(mk || '').toLowerCase();
  const mime = String(mediaMime || '').toLowerCase().split(';')[0].trim();
  if (mkStr === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (mkStr === 'image' || mime.startsWith('image/')) return 'image';
  if (mkStr === 'video' || mime.startsWith('video/')) return 'video';
  if (mkStr === 'file') return 'file';
  if (mime && !mime.startsWith('image/') && !mime.startsWith('audio/') && !mime.startsWith('video/')) return 'file';
  return null;
}

function bubbleFileTypeLabel(mime: string): string {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf' || m === 'application/x-pdf') return 'PDF';
  if (m.includes('wordprocessingml.document') || m === 'application/msword') return 'Documento';
  if (m.includes('spreadsheetml.sheet') || m.includes('ms-excel') || m === 'text/csv' || m === 'application/csv') return 'Planilha';
  if (m === 'application/zip' || m === 'application/x-zip-compressed') return 'ZIP';
  if (m === 'application/x-rar-compressed' || m === 'application/vnd.rar') return 'RAR';
  if (m === 'text/plain') return 'Arquivo TXT';
  return 'Arquivo';
}

function bubbleFileDownloadName(m: { content?: string | null; mediaMime?: string | null }): string {
  const line = String(m.content || '')
    .trim()
    .split('\n')
    .pop()
    ?.trim();
  if (line && line.length <= 200 && /\.[a-z0-9]{2,8}$/i.test(line) && !/[\\/:*?"<>|\r\n]/.test(line)) {
    return line;
  }
  const mime = String(m.mediaMime || '').toLowerCase().split(';')[0].trim();
  let ext = 'bin';
  if (mime === 'application/pdf') ext = 'pdf';
  else if (mime.includes('wordprocessingml.document')) ext = 'docx';
  else if (mime === 'application/msword') ext = 'doc';
  else if (mime.includes('spreadsheetml.sheet')) ext = 'xlsx';
  else if (mime.includes('ms-excel')) ext = 'xls';
  else if (mime === 'text/csv' || mime === 'application/csv') ext = 'csv';
  else if (mime === 'text/plain') ext = 'txt';
  else if (mime === 'application/zip' || mime === 'application/x-zip-compressed') ext = 'zip';
  else if (mime === 'application/x-rar-compressed' || mime === 'application/vnd.rar') ext = 'rar';
  return `anexo.${ext}`;
}

function chatPalette(theme: 'light' | 'dark'): ChatPalette {
  if (theme === 'dark') {
    return {
      received: { background: '#1E293B', border: '1px solid rgba(148,163,184,0.22)', color: '#E2E8F0' },
      sent: { background: '#4F46E5', border: 'none', color: '#FFFFFF' },
      systemBg: '#1E293B',
      systemBorder: '1px solid rgba(148,163,184,0.22)',
      systemColor: '#94A3B8',
      authorLabel: '#94A3B8',
      replyBorderContact: '#64748B',
      replyBorderSent: 'rgba(255,255,255,0.5)',
      replyBgContact: 'rgba(148,163,184,0.14)',
      replyBgSent: 'rgba(255,255,255,0.12)',
      replyNameContact: '#CBD5E1',
      replyNameSent: 'rgba(255,255,255,0.9)',
      replySnippet: '#94A3B8',
      loadingText: '#94A3B8',
      replyBtn: '#64748B',
    };
  }
  return {
    received: { background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.07)', color: '#111118' },
    sent: { background: '#4F46E5', border: 'none', color: '#FFFFFF' },
    systemBg: '#EEF2FF',
    systemBorder: '1px solid #C7D2FE',
    systemColor: '#4338CA',
    authorLabel: '#6B6B80',
    replyBorderContact: '#C7D2FE',
    replyBorderSent: 'rgba(255,255,255,0.55)',
    replyBgContact: 'rgba(79,70,229,0.07)',
    replyBgSent: 'rgba(255,255,255,0.15)',
    replyNameContact: '#4F46E5',
    replyNameSent: 'rgba(255,255,255,0.9)',
    replySnippet: '#6B6B80',
    loadingText: '#6B6B80',
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
  const bubbleMedia = resolveBubbleMediaKind(m);
  const showMedia = bubbleMedia !== null;
  const mediaLoading = showMedia && !resolvedMediaSrc && !m._optimistic;
  const hidePlaceholderCaption =
    !!resolvedMediaSrc &&
    (m.content === '📷 Imagem' ||
      m.content === '🎤 Áudio' ||
      m.content === '📹 Vídeo' ||
      m.content === '📎 Documento');
  const showCaption = !!(m.content && !hidePlaceholderCaption);

  const bubbleMax = density === 'compact' ? 580 : 520;
  const bubbleMaxCss = `min(100%, ${bubbleMax}px)`;
  const marginTop = sameAuthorAsPrev ? (density === 'compact' ? 2 : 4) : density === 'compact' ? 8 : 12;
  const authorLabelText = String(
    m.authorName ?? (m as { author_name?: string }).author_name ?? '',
  ).trim();
  const showAuthorLabel =
    !isSystem &&
    !sameAuthorAsPrev &&
    (isContact || m.authorType === 'user') &&
    authorLabelText.length > 0;
  const showAvatar = density === 'normal' && isContact && !sameAuthorAsNext;
  const avatarColWidth = density === 'normal' && isContact ? 36 : 0;

  const padding = density === 'compact' ? '6px 10px' : '8px 12px';
  const hPad = density === 'compact' ? 20 : 24;
  /** Largura útil máxima dentro da bolha (padding horizontal). Texto/reply/mídia usam isto; meta fica numa linha própria para não roubar largura. */
  const innerContentMax = bubbleMax - hPad;
  /** Alias para JSX legado / hot-reload parcial (equivale a `innerContentMax`). */
  const textMaxWidth = innerContentMax;

  const fontSize = density === 'compact' ? 13 : 14;
  const lineHeight = density === 'compact' ? 1.3 : 1.35;
  const borderRadius = bubbleBorderRadius(density, isContact, sameAuthorAsPrev, sameAuthorAsNext);

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
            display: 'inline-flex',
            alignItems: 'center',
            gap: density === 'compact' ? 4 : 6,
            maxWidth: '92%',
            padding: density === 'compact' ? '3px 10px' : '5px 14px',
            borderRadius: density === 'compact' ? 6 : 8,
            background: P.systemBg,
            border: P.systemBorder,
            color: P.systemColor,
            fontSize: density === 'compact' ? 11 : 11,
            fontWeight: 500,
            lineHeight: 1.35,
            boxShadow: 'none',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
          </svg>
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
            fontWeight: m.authorType === 'user' ? 700 : 500,
            color: P.authorLabel,
            marginBottom: density === 'compact' ? 1 : 2,
            paddingLeft: isContact ? (avatarColWidth > 0 ? 4 : 2) : 0,
            paddingRight: isContact ? 0 : 2,
            alignSelf: isContact ? 'flex-start' : 'flex-end',
            textAlign: isContact ? 'left' : 'right',
            maxWidth: '100%',
          }}
        >
          {authorLabelText}
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
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            width: 'fit-content',
            maxWidth: bubbleMaxCss,
            flexShrink: 0,
            minWidth: 0,
            boxSizing: 'border-box',
            padding,
            fontSize,
            lineHeight,
            position: 'relative',
            ...bubbleBase,
            borderRadius,
            boxShadow: isContact ? '0 1px 2px rgba(0,0,0,0.04)' : '0 1px 6px rgba(79,70,229,0.25)',
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
                maxWidth: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 1, color: replyNameColor, fontSize: replyFont }}>{m.replyTo.authorName}</div>
              <div
                style={{
                  color: replySnippetColor,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {m.replyTo.mediaKind === 'image'
                  ? '📷 Imagem'
                  : m.replyTo.mediaKind === 'audio'
                    ? '🎤 Áudio'
                    : m.replyTo.mediaKind === 'video'
                      ? '📹 Vídeo'
                      : m.replyTo.mediaKind === 'file'
                        ? '📎 Documento'
                        : m.replyTo.content}
              </div>
            </div>
          )}

          {bubbleMedia === 'image' && resolvedMediaSrc && (
            <div style={{ maxWidth: '100%', minWidth: 0 }}>
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
          {bubbleMedia === 'audio' && resolvedMediaSrc && (
            <div
              style={{
                marginBottom: showCaption ? replyMb : 0,
                width: '100%',
                maxWidth: innerContentMax,
                minWidth: 0,
                alignSelf: 'stretch',
              }}
            >
              <AudioMessagePlayer src={resolvedMediaSrc} variant={isContact ? 'received' : 'sent'} density={density} />
            </div>
          )}
          {bubbleMedia === 'video' && resolvedMediaSrc && (
            <div style={{ maxWidth: '100%', minWidth: 0 }}>
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
          {bubbleMedia === 'file' && resolvedMediaSrc && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: density === 'compact' ? 5 : 6,
                marginBottom: showCaption ? replyMb : 0,
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: density === 'compact' ? 12 : 13, fontWeight: 600, color: bubbleBase.color }}>
                {bubbleFileTypeLabel(String(m.mediaMime || ''))}
              </span>
              <span style={{ fontSize: 11, color: P.loadingText }}>—</span>
              <a
                href={resolvedMediaSrc}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: density === 'compact' ? 12 : 13,
                  fontWeight: 700,
                  color: isContact ? '#0D9488' : 'rgba(255,255,255,0.9)',
                  textDecoration: 'none',
                }}
              >
                Abrir
              </a>
              <span style={{ fontSize: 11, color: P.loadingText }}>•</span>
              <a
                href={resolvedMediaSrc}
                download={bubbleFileDownloadName(m)}
                rel="noopener"
                style={{
                  fontSize: density === 'compact' ? 12 : 13,
                  fontWeight: 700,
                  color: isContact ? '#0D9488' : 'rgba(255,255,255,0.9)',
                  textDecoration: 'none',
                }}
              >
                Baixar
              </a>
            </div>
          )}
          {mediaLoading && (
            <p style={{ margin: `0 0 ${replyMb}px`, fontSize: density === 'compact' ? 11 : 12, opacity: 0.85, color: P.loadingText }}>A carregar…</p>
          )}

          {(showCaption || showMedia || mediaLoading) &&
            (showCaption ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: density === 'compact' ? 3 : 4,
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxWidth: textMaxWidth,
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                  <ChatMessageMeta
                    timeLabel={t}
                    isContact={isContact}
                    isWhatsapp={isWhatsapp}
                    whatsappStatus={m.whatsappStatus}
                    density={density}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                <ChatMessageMeta
                  timeLabel={t}
                  isContact={isContact}
                  isWhatsapp={isWhatsapp}
                  whatsappStatus={m.whatsappStatus}
                  density={density}
                />
              </div>
            ))}

          {!showCaption && !showMedia && !mediaLoading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignSelf: 'flex-end' }}>
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
