'use client';

import { Check, CheckCircle2 } from 'lucide-react';

/** Ícone de status de mensagem estilo WhatsApp */
function MessageStatusIcon({ status, isWhatsapp }: { status?: string | null; isWhatsapp?: boolean }) {
  if (!isWhatsapp) return <CheckCircle2 size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
  if (!status || status === 'pending' || status === 'sending' || status === 'queued') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (status === 'failed' || status === 'error') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (status === 'sent') {
    return <Check size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
  }
  if (status === 'delivered') {
    return <span style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>;
  }
  if (status === 'read') {
    return <span style={{ fontSize: 10, color: '#93C5FD', letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>;
  }
  return <Check size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
}

type Props = {
  timeLabel: string;
  isContact: boolean;
  isWhatsapp: boolean;
  /** Somente mensagens do agente */
  whatsappStatus?: string | null;
};

export default function ChatMessageMeta({ timeLabel, isContact, isWhatsapp, whatsappStatus }: Props) {
  const mutedContact = '#8690A0';
  const mutedSent = 'rgba(255,255,255,0.62)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        fontSize: 10,
        lineHeight: 1,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color: isContact ? mutedContact : mutedSent,
      }}
    >
      <span>{timeLabel}</span>
      {!isContact && <MessageStatusIcon status={whatsappStatus} isWhatsapp={isWhatsapp} />}
    </span>
  );
}
