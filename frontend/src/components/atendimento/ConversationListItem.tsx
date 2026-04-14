'use client';

import { MessageSquare } from 'lucide-react';

/** Lê contador de não lidas: API (se existir) tem prioridade sobre mapa local do realtime. */
export function getConversationListUnreadCount(
  item: { id?: string; unreadCount?: unknown; unreadMessages?: unknown; unreadMessagesCount?: unknown },
  unreadMap: Record<string, number>,
): number {
  const raw = item?.unreadCount ?? item?.unreadMessages ?? item?.unreadMessagesCount;
  const fromApi = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(fromApi) && fromApi > 0) return Math.min(99, Math.floor(fromApi));
  const id = String(item?.id ?? '');
  const local = id ? unreadMap[id] : undefined;
  if (typeof local === 'number' && local > 0) return Math.min(99, local);
  return 0;
}

function formatDurationLabel(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function ChannelDot({ channel }: { channel: string }) {
  const isWa = channel === 'whatsapp';
  return (
    <span
      style={{
        position: 'absolute',
        bottom: -1,
        right: -1,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: isWa ? '#25D366' : '#4F46E5',
        border: '2px solid #fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isWa ? (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="#fff">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ) : (
        <GlobeMini />
      )}
    </span>
  );
}

function GlobeMini() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

export type InboxListAlertMeta = {
  kind: 'queue' | 'firstReply';
  severity: 'critical' | 'warning' | 'fresh';
  waitingMs: number;
  shouldPulse?: boolean;
} | null;

const LIST_TXT = '#0F172A';
const LIST_TXT2 = '#64748B';
const LIST_TXT3 = '#94A3B8';
const ACCENT = '#4F46E5';

export type ConversationListItemProps = {
  contactName: string;
  initialsText: string;
  avatarBg: string;
  channel: string;
  timeLabel: string;
  preview: string | null;
  ticketNumber: string | null;
  companyName: string | null;
  isClosed: boolean;
  isSelected: boolean;
  noTicket: boolean;
  escalated: boolean;
  alertMeta: InboxListAlertMeta;
  unreadCount: number;
  onSelect: () => void;
};

export default function ConversationListItem({
  contactName,
  initialsText,
  avatarBg,
  channel,
  timeLabel,
  preview,
  ticketNumber,
  companyName,
  isClosed,
  isSelected,
  noTicket,
  escalated,
  alertMeta,
  unreadCount,
  onSelect,
}: ConversationListItemProps) {
  const alertAccent =
    alertMeta?.severity === 'critical'
      ? '#DC2626'
      : alertMeta?.severity === 'warning'
        ? '#EA580C'
        : alertMeta?.severity === 'fresh'
          ? '#16A34A'
          : null;

  const alertBgSoft =
    alertMeta?.severity === 'critical'
      ? 'rgba(254, 242, 242, 0.65)'
      : alertMeta?.severity === 'warning'
        ? 'rgba(255, 247, 237, 0.65)'
        : alertMeta?.severity === 'fresh'
          ? 'rgba(240, 253, 244, 0.65)'
          : null;

  const selectedBg = 'linear-gradient(90deg, rgba(239,246,255,0.95) 0%, rgba(255,255,255,0.98) 12%, #FFFFFF 100%)';
  const idleBg = alertBgSoft || 'rgba(255,255,255,0.82)';

  const leftBar = isSelected ? ACCENT : alertAccent && !isSelected ? `${alertAccent}88` : 'transparent';

  const metaParts: string[] = [];
  if (ticketNumber) metaParts.push(ticketNumber);
  if (companyName) metaParts.push(companyName);
  const metaLine = metaParts.join(' · ');

  const alertChip =
    alertMeta == null
      ? null
      : (() => {
          const compactLabel = formatDurationLabel(alertMeta.waitingMs);
          const label =
            alertMeta.severity === 'critical'
              ? 'Crítico'
              : alertMeta.severity === 'warning'
                ? 'Aguardando'
                : 'Novo';
          return { label, sub: compactLabel };
        })();

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        position: 'relative',
        width: '100%',
        padding: '10px 10px 10px 11px',
        borderRadius: 12,
        border: isSelected
          ? `1px solid ${alertAccent || ACCENT}`
          : alertAccent
            ? `1px solid ${alertAccent}40`
            : '1px solid rgba(15,23,42,0.06)',
        background: isSelected ? selectedBg : idleBg,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        marginBottom: 6,
        fontFamily: 'inherit',
        boxShadow: isSelected
          ? '0 1px 2px rgba(15,23,42,0.06), 0 4px 14px rgba(79,70,229,0.12)'
          : '0 1px 2px rgba(15,23,42,0.04)',
        animation: alertMeta?.shouldPulse ? 'atendimentoPulse 1.4s ease-in-out infinite' : undefined,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: '0 3px 3px 0',
          background: leftBar,
        }}
      />
      <div style={{ position: 'relative', flexShrink: 0, marginLeft: 2 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: isClosed ? '#E2E8F0' : avatarBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {initialsText ? initialsText : <MessageSquare size={14} />}
        </div>
        <ChannelDot channel={channel} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 999,
              background: ACCENT,
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              lineHeight: '18px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(15,23,42,0.25)',
              border: '2px solid #fff',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: isClosed ? LIST_TXT3 : LIST_TXT,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              letterSpacing: '-0.01em',
              minWidth: 0,
            }}
          >
            {contactName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: LIST_TXT3,
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            {timeLabel}
          </span>
        </div>
        {preview ? (
          <p
            style={{
              fontSize: 12,
              color: LIST_TXT2,
              margin: '0 0 6px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.35,
            }}
          >
            {preview}
          </p>
        ) : (
          <div style={{ height: 4 }} />
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '4px 8px',
            fontSize: 10,
            color: LIST_TXT3,
            lineHeight: 1.3,
          }}
        >
          {metaLine ? (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {metaLine}
            </span>
          ) : null}
          {escalated && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#B91C1C',
                flexShrink: 0,
              }}
            >
              Urgente
            </span>
          )}
          {alertChip && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color:
                  alertMeta?.severity === 'critical'
                    ? '#B91C1C'
                    : alertMeta?.severity === 'warning'
                      ? '#C2410C'
                      : '#15803D',
                background:
                  alertMeta?.severity === 'critical'
                    ? '#FEE2E2'
                    : alertMeta?.severity === 'warning'
                      ? '#FFEDD5'
                      : '#DCFCE7',
                padding: '2px 6px',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              {alertChip.label} · {alertChip.sub}
            </span>
          )}
          {!alertMeta && noTicket && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: LIST_TXT2,
                background: '#F1F5F9',
                padding: '2px 6px',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              Sem ticket
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
