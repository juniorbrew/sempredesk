'use client';

import { Check, CheckCircle2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { DEFAULT_CHAT_DENSITY_MODE, type ChatDensityMode } from '@/components/chat/chatDensity';

/** Ícones de status (cores adaptáveis a tema claro/escuro). */
function MessageStatusIcon({
  status,
  isWhatsapp,
  iconColor,
  readColor,
  iconSize,
}: {
  status?: string | null;
  isWhatsapp?: boolean;
  iconColor: string;
  readColor: string;
  iconSize: number;
}) {
  if (!isWhatsapp) return <CheckCircle2 size={iconSize} style={{ color: iconColor }} />;
  if (!status || status === 'pending' || status === 'sending' || status === 'queued') {
    return (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (status === 'failed' || status === 'error') {
    return (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (status === 'sent') {
    return <Check size={iconSize} style={{ color: iconColor }} />;
  }
  if (status === 'delivered') {
    const fs = iconSize >= 11 ? 10 : 9;
    return <span style={{ fontSize: fs, color: iconColor, letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>;
  }
  if (status === 'read') {
    const fs = iconSize >= 11 ? 10 : 9;
    return <span style={{ fontSize: fs, color: readColor, letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>;
  }
  return <Check size={iconSize} style={{ color: iconColor }} />;
}

type Props = {
  timeLabel: string;
  isContact: boolean;
  isWhatsapp: boolean;
  whatsappStatus?: string | null;
  density?: ChatDensityMode;
};

export default function ChatMessageMeta({
  timeLabel,
  isContact,
  isWhatsapp,
  whatsappStatus,
  density = DEFAULT_CHAT_DENSITY_MODE,
}: Props) {
  const { theme } = useTheme();
  const iconColor = theme === 'dark' ? '#CBD5E1' : '#64748B';
  const readColor = theme === 'dark' ? '#60A5FA' : '#2563EB';
  const compact = density === 'compact';
  const timeColor = compact ? '#CBD5E1' : '#94A3B8';
  const timeOpacity = compact ? 0.92 : 1;
  const fontSize = compact ? 10 : 11;
  const gap = compact ? 2 : 3;
  const iconSize = compact ? 10 : 11;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        flexShrink: 0,
        alignSelf: 'flex-end',
        whiteSpace: 'nowrap',
        fontSize,
        lineHeight: 1,
        fontWeight: 400,
        color: timeColor,
        opacity: timeOpacity,
      }}
    >
      <span>{timeLabel}</span>
      {!isContact && (
        <MessageStatusIcon
          status={whatsappStatus}
          isWhatsapp={isWhatsapp}
          iconColor={iconColor}
          readColor={readColor}
          iconSize={iconSize}
        />
      )}
    </span>
  );
}
