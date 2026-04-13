'use client';
import { Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { api } from '@/lib/api';
import {
  ATENDIMENTO_OPEN_TICKET_EVENT,
  ATENDIMENTO_OPEN_TICKET_QUERY,
  type AtendimentoOpenTicketDetail,
} from '@/lib/atendimento-ticket-bridge';
import { DEFAULT_PRIORITY, PRIORITY_OPTIONS, type SystemPriority } from '@/lib/priorities';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRealtimeConversation, useRealtimeTicket, useRealtimeTenantNewMessages, useRealtimeConversationClosed, useRealtimeTicketAssigned, useRealtimeContactTyping, emitTypingPresence, subscribeContactPresence } from '@/lib/realtime';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import {
  MessageSquare, Send, Phone, RefreshCw, Lock, PanelRight, Plus, Link2, Globe, Ticket,
  Check, Search, X, CheckCircle2, User, Mail, MapPin, Building2, Hash, Tag, Edit2, Save,
  Paperclip, Mic, StopCircle, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import ContactValidationBanner, { type ResolvedData } from '@/components/atendimento/ContactValidationBanner';
import { TagMultiSelect } from '@/components/ui/TagMultiSelect';
import ConversationMessageList from '@/components/chat/ConversationMessageList';
import ChatDensityToggle from '@/components/chat/ChatDensityToggle';
import {
  DEFAULT_CHAT_DENSITY_MODE,
  readChatDensityFromStorage,
  writeChatDensityToStorage,
  type ChatDensityMode,
} from '@/components/chat/chatDensity';
import { invalidateMyOpenTicketsCount } from '@/hooks/useMyOpenTicketsCount';
import { getTicketPriorityDisplay, isTicketCriticalUrgent, ticketPriorityChipStyle } from '@/lib/ticket-priority-ui';

/** Rótulos de status alinhados à página do ticket (painel lateral). */
const TICKET_STATUS_PANEL: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  open: { label: 'Aberto', bg: '#EEF2FF', color: '#3730A3', dot: '#4F46E5' },
  in_progress: { label: 'Em andamento', bg: '#FEF3C7', color: '#92400E', dot: '#D97706' },
  waiting_client: { label: 'Aguardando cliente', bg: '#F0F9FF', color: '#0369A1', dot: '#0284C7' },
  resolved: { label: 'Resolvido', bg: '#F0FDF4', color: '#166534', dot: '#16A34A' },
  closed: { label: 'Fechado', bg: '#F9FAFB', color: '#374151', dot: '#374151' },
  cancelled: { label: 'Cancelado', bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444' },
};

const TICKET_STATUS_SELECT_OPTIONS: { value: string; label: string }[] = [
  { value: 'open', label: 'Aberto' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'waiting_client', label: 'Aguardando cliente' },
  { value: 'resolved', label: 'Resolvido' },
  { value: 'closed', label: 'Fechado' },
  { value: 'cancelled', label: 'Cancelado' },
];

function formatTicketDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Formata número de WhatsApp para exibição: remove prefixo 55 e aplica máscara BR */
function formatWhatsApp(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  // LID: identificador interno do WhatsApp (14+ dígitos) — não é número de telefone real
  if (digits.length >= 14) return '';
  // Brasil: remove prefixo 55 e formata com DDI
  if (digits.startsWith('55') && digits.length >= 12) {
    const local = digits.slice(2);
    if (local.length === 11) return `+55 (${local.slice(0,2)}) ${local.slice(2,3)} ${local.slice(3,7)}-${local.slice(7)}`;
    if (local.length === 10) return `+55 (${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  }
  // Número local BR sem DDI (10-11 dígitos)
  if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,3)} ${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  // Outro: retorna com + se parece internacional
  return digits.length > 11 ? `+${digits}` : digits;
}

function timeAgo(date: string | Date) {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const dy = Math.floor(h / 24);
  if (dy > 0) return `${dy}d`;
  if (h > 0) return `${h}h`;
  return m < 1 ? 'agora' : `${m}min`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string) {
  const COLORS = ['#16A34A','#2563EB','#EA580C','#7C3AED','#E11D48','#0891B2','#4F46E5','#B45309'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

/** Accept do composer + validação alinhada ao backend (conversations POST). */
const CHAT_DOCUMENT_ACCEPT =
  '.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.zip,.rar,application/pdf,text/plain,text/csv,application/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/vnd.rar';
const CHAT_FULL_FILE_ACCEPT = `image/*,audio/*,video/mp4,${CHAT_DOCUMENT_ACCEPT}`;
const CHAT_DOC_EXT = new Set(['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip', 'rar']);
const CHAT_DOC_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
]);

function isAllowedChatAttachmentFile(f: File): boolean {
  if (f.type.startsWith('image/') || f.type.startsWith('audio/')) return true;
  if (f.type === 'video/mp4' || f.type.startsWith('video/mp4;')) return true;
  const t = f.type.split(';')[0].trim().toLowerCase();
  if (t && CHAT_DOC_MIME.has(t)) return true;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return CHAT_DOC_EXT.has(ext);
}

const CLIPBOARD_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function clipboardImageMimeToExt(mimeRaw: string): string {
  const m = mimeRaw.split(';')[0].trim().toLowerCase();
  if (m === 'image/png' || m === 'image/x-png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg') return 'jpg';
  if (m === 'image/bmp' || m === 'image/x-ms-bmp') return 'bmp';
  return 'png';
}

/** Extrai um único ficheiro de imagem do paste (Chrome/Edge no Windows usa muitas vezes `files`, não só `items`). */
function extractClipboardImageFile(e: React.ClipboardEvent<HTMLTextAreaElement>): File | null {
  const cd = e.clipboardData;
  if (!cd) return null;

  if (cd.files && cd.files.length > 0) {
    for (let i = 0; i < cd.files.length; i++) {
      const raw = cd.files[i];
      if (!raw || !raw.size) continue;
      let mt = (raw.type || '').split(';')[0].trim().toLowerCase();
      const rawName = raw.name?.trim() ?? '';
      const extGuess = rawName.includes('.') ? (rawName.split('.').pop()?.toLowerCase() ?? '') : '';
      if (!mt.startsWith('image/')) {
        if (CLIPBOARD_IMAGE_EXT.has(extGuess)) {
          const byExt: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
          };
          mt = byExt[extGuess] ?? 'image/png';
        } else if (!mt || mt === 'application/octet-stream') {
          mt = 'image/png';
        } else {
          continue;
        }
      }
      const ext = clipboardImageMimeToExt(mt);
      const name =
        rawName && rawName.length > 0 && /\.[a-z0-9]{2,8}$/i.test(rawName) ? rawName : `print-${Date.now()}.${ext}`;
      return new File([raw], name, { type: raw.type || mt || 'image/png' });
    }
  }

  const items = cd.items;
  if (!items?.length) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'file') continue;
    const blob = it.getAsFile();
    if (!blob || blob.size <= 0) continue;
    let mimeRaw = (it.type || blob.type || '').split(';')[0].trim().toLowerCase();
    if (mimeRaw === 'image/x-png') mimeRaw = 'image/png';
    if (!mimeRaw.startsWith('image/')) {
      const n = blob.name?.trim() ?? '';
      const extGuess = n.includes('.') ? (n.split('.').pop()?.toLowerCase() ?? '') : '';
      if (CLIPBOARD_IMAGE_EXT.has(extGuess)) {
        const byExt: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          bmp: 'image/bmp',
        };
        mimeRaw = byExt[extGuess] ?? 'image/png';
      } else if (!mimeRaw || mimeRaw === 'application/octet-stream') {
        // Recorte/Print Screen: tipo vazio é comum — assumir PNG para passar validação e backend (sniff).
        mimeRaw = 'image/png';
      } else {
        continue;
      }
    }
    const ext = clipboardImageMimeToExt(mimeRaw);
    const rawName = blob.name?.trim();
    const name =
      rawName && rawName.length > 0 && /\.[a-z0-9]{2,8}$/i.test(rawName) ? rawName : `print-${Date.now()}.${ext}`;
    return new File([blob], name, { type: blob.type || mimeRaw || 'image/png' });
  }

  return null;
}

/** Normaliza corpos `{ success, message }`, `{ success, data }` e entidades cruas após o interceptor Axios. */
function extractSavedMessageFromSendResponse(res: any): any | null {
  if (res == null || typeof res !== 'object') return null;
  if (res.success === false) return null;
  const wrap = res.message;
  if (wrap && typeof wrap === 'object' && wrap.id) return wrap;
  if (res.id) return res;
  const d = res.data;
  if (d && typeof d === 'object') {
    if (d.id) return d;
    if (d.message && typeof d.message === 'object' && d.message.id) return d.message;
  }
  return null;
}

// ── sub-components ────────────────────────────────────────────────────────────

function formatDurationLabel(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}


function getQueueStartedAt(conv: any) {
  return conv?.queuedAt || conv?.createdAt || null;
}

function getAttendanceStartedAt(conv: any) {
  return conv?.attendanceStartedAt || null;
}

function getFirstAgentReplyAt(conv: any) {
  return conv?.firstAgentReplyAt || conv?.slaFirstResponseAt || null;
}

function getConversationMetrics(conv: any) {
  const queuedAt = getQueueStartedAt(conv);
  const attendanceStartedAt = getAttendanceStartedAt(conv);
  const firstAgentReplyAt = getFirstAgentReplyAt(conv);
  const closedAt = conv?.conversationClosedAt || (conv?.status === 'closed' ? conv?.updatedAt : null);

  const waitToStartMs =
    queuedAt && attendanceStartedAt
      ? Math.max(0, new Date(attendanceStartedAt).getTime() - new Date(queuedAt).getTime())
      : null;
  const firstReplyMs =
    attendanceStartedAt && firstAgentReplyAt
      ? Math.max(0, new Date(firstAgentReplyAt).getTime() - new Date(attendanceStartedAt).getTime())
      : null;
  const durationMs =
    attendanceStartedAt && closedAt
      ? Math.max(0, new Date(closedAt).getTime() - new Date(attendanceStartedAt).getTime())
      : null;

  return { queuedAt, attendanceStartedAt, firstAgentReplyAt, closedAt, waitToStartMs, firstReplyMs, durationMs };
}

function ConvWaitMetricsInfo({ conv }: { conv: any }) {
  const metrics = getConversationMetrics(conv);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!metrics.queuedAt || metrics.attendanceStartedAt) return;
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, [metrics.queuedAt, metrics.attendanceStartedAt]);

  if (!metrics.queuedAt || metrics.attendanceStartedAt) return null;
  const waitingMs = Math.max(0, Date.now() - new Date(metrics.queuedAt).getTime());
  const label = formatDurationLabel(waitingMs);
  const highWait = waitingMs >= 60 * 60000;
  const atRisk = !highWait && waitingMs >= 15 * 60000;
  const dotStyle = { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0 } as const;

  if (highWait) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6, background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'6px 12px' }}>
        <span style={{ ...dotStyle, background:'#DC2626' }} />
        <span style={{ fontSize:12, fontWeight:700, color:'#DC2626' }}>Chat na fila há {label}</span>
      </div>
    );
  }
  if (atRisk) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:6, background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:8, padding:'6px 12px' }}>
        <span style={{ ...dotStyle, background:'#EA580C' }} />
        <span style={{ fontSize:12, fontWeight:700, color:'#EA580C' }}>Chat na fila há {label}</span>
      </div>
    );
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'6px 12px' }}>
      <span style={{ ...dotStyle, background:'#16A34A' }} />
      <span style={{ fontSize:12, fontWeight:600, color:'#15803D' }}>Chat na fila há {label}</span>
    </div>
  );
}

function ChannelDot({ channel }: { channel: string }) {
  const isWa = channel === 'whatsapp';
  return (
    <span style={{
      position: 'absolute', bottom: -2, right: -2,
      width: 15, height: 15, borderRadius: '50%',
      background: isWa ? '#25D366' : '#4F46E5',
      border: '2px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {isWa
        ? <svg width="8" height="8" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        : <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>
      }
    </span>
  );
}

// ── main component ────────────────────────────────────────────────────────────
type ChatComposerProps = {
  accentColor: string;
  borderColor: string;
  backgroundColor: string;
  inputBackgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  canSend: boolean;
  isSending: boolean;
  isWhatsapp: boolean;
  conversationScopeKey: string;
  inputValue: string;
  pendingFile: File | null;
  attachFileInputRef: React.RefObject<HTMLInputElement>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onSubmit: (e: React.FormEvent) => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onPendingFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRecordedAudio: (file: File) => void;
  onRemovePendingFile: () => void;
  onInsertEmoji: (emoji: string) => void;
  replyingTo?: any | null;
  onCancelReply?: () => void;
};

function ChatComposer({
  accentColor,
  borderColor,
  backgroundColor,
  inputBackgroundColor,
  textColor,
  mutedTextColor,
  canSend,
  isSending,
  isWhatsapp,
  conversationScopeKey,
  inputValue,
  pendingFile,
  attachFileInputRef,
  inputRef,
  onSubmit,
  onInputChange,
  onInputKeyDown,
  onComposerPaste,
  onPendingFileChange,
  onRecordedAudio,
  onRemovePendingFile,
  onInsertEmoji,
  replyingTo,
  onCancelReply,
}: ChatComposerProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldSaveRecordingRef = useRef(false);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const resetRecordingState = useCallback(() => {
    clearRecordingTimer();
    setIsRecording(false);
    setRecordingSeconds(0);
  }, [clearRecordingTimer]);

  const disposeRecorder = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    shouldSaveRecordingRef.current = false;
    audioChunksRef.current = [];
    resetRecordingState();
    stopMediaStream();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      disposeRecorder();
    }
  }, [disposeRecorder, resetRecordingState, stopMediaStream]);

  useEffect(() => {
    shouldSaveRecordingRef.current = false;
    audioChunksRef.current = [];
    resetRecordingState();
    stopMediaStream();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      disposeRecorder();
    }
  }, [conversationScopeKey, disposeRecorder, resetRecordingState, stopMediaStream]);

  const openAttachmentPicker = useCallback(() => {
    const input = attachFileInputRef.current;
    if (!input) return;
    input.accept = CHAT_FULL_FILE_ACCEPT;
    input.click();
  }, [attachFileInputRef]);

  const finalizeRecording = useCallback((saveRecording: boolean) => {
    shouldSaveRecordingRef.current = saveRecording;
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      audioChunksRef.current = [];
      resetRecordingState();
      stopMediaStream();
      disposeRecorder();
      return;
    }
    mediaRecorderRef.current.stop();
  }, [disposeRecorder, resetRecordingState, stopMediaStream]);

  const stopRecording = useCallback(() => {
    finalizeRecording(true);
  }, [finalizeRecording]);

  const startRecording = useCallback(async () => {
    if (isRecording || !canSend || isSending || pendingFile) return;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingError('O navegador atual nao suporta gravacao de audio.');
      return;
    }

    try {
      setRecordingError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const shouldSave = shouldSaveRecordingRef.current;
        shouldSaveRecordingRef.current = false;
        resetRecordingState();
        stopMediaStream();
        disposeRecorder();

        const audioBlob = audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null;
        audioChunksRef.current = [];

        if (!shouldSave) return;

        if (!audioBlob || audioBlob.size === 0) {
          setRecordingError('Nao foi possivel capturar o audio gravado.');
          return;
        }

        const extension = recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([audioBlob], `gravacao-${Date.now()}.${extension}`, {
          type: recorder.mimeType || audioBlob.type || 'audio/webm',
        });
        onRecordedAudio(file);
      };

      recorder.onerror = () => {
        shouldSaveRecordingRef.current = false;
        setRecordingError('Ocorreu um erro durante a gravacao do audio.');
        audioChunksRef.current = [];
        resetRecordingState();
        stopMediaStream();
        disposeRecorder();
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
    } catch {
      shouldSaveRecordingRef.current = false;
      audioChunksRef.current = [];
      resetRecordingState();
      stopMediaStream();
      disposeRecorder();
      setRecordingError('Nao foi possivel acessar o microfone.');
    }
  }, [canSend, disposeRecorder, isRecording, isSending, onRecordedAudio, pendingFile, resetRecordingState, stopMediaStream]);

  const recordingLabel = `${String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:${String(recordingSeconds % 60).padStart(2, '0')}`;
  const showMicButton = canSend && !isSending && !inputValue.trim() && !pendingFile && !isRecording;

  return (
    <div style={{ borderTop: borderColor, background: backgroundColor, padding: 0, flexShrink: 0 }}>
      <input
        ref={attachFileInputRef}
        type="file"
        accept={CHAT_FULL_FILE_ACCEPT}
        style={{ display: 'none' }}
        onChange={onPendingFileChange}
      />
      <form onSubmit={onSubmit}>
        {/* Preview da mensagem sendo respondida */}
        {replyingTo && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px 0',
            borderTop: '1px solid rgba(0,0,0,.06)',
          }}>
            <div style={{
              flex: 1, borderLeft: '3px solid #4F46E5', background: '#EEF2FF',
              borderRadius: 6, padding: '5px 10px', fontSize: 12, minWidth: 0,
            }}>
              <div style={{ fontWeight: 600, color: '#4F46E5', marginBottom: 2 }}>
                {replyingTo.authorName}
              </div>
              <div style={{ color: '#6B6B80', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {replyingTo.mediaKind === 'image' ? '📷 Imagem'
                  : replyingTo.mediaKind === 'audio' ? '🎤 Áudio'
                  : replyingTo.mediaKind === 'video' ? '📹 Vídeo'
                  : replyingTo.mediaKind === 'file' ? '📎 Documento'
                  : replyingTo.content}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              title="Cancelar resposta"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '12px 16px' }}>
          <button
            type="button"
            onClick={() => {
              if (!canSend || isSending || isRecording) return;
              openAttachmentPicker();
            }}
            disabled={!canSend || isSending || isRecording}
            title="Anexar arquivo (imagem, audio, video MP4, documentos)"
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              border: '1px solid rgba(0,0,0,.08)',
              background: !canSend || isSending || isRecording ? '#F1F5F9' : '#F8FAFC',
              color: !canSend || isSending || isRecording ? '#94A3B8' : mutedTextColor,
              cursor: !canSend || isSending || isRecording ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background .15s, border-color .15s',
            }}
          >
            <Paperclip size={16} strokeWidth={2} />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            {recordingError && (
              <div style={{ padding: '0 0 8px', fontSize: 12, color: '#DC2626' }}>
                {recordingError}
              </div>
            )}
            {isRecording && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 0 8px',
                fontSize: 12,
                color: textColor,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>Gravando audio</span>
                <span style={{ color: mutedTextColor }}>{recordingLabel}</span>
              </div>
            )}
            {pendingFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 8px', fontSize: 12, color: mutedTextColor }}>
                <span
                  style={{
                    maxWidth: 'calc(100% - 90px)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                    color: textColor,
                  }}
                >
                  {pendingFile.name}
                </span>
                <span>{pendingFile.type.startsWith('audio/') ? 'Audio gravado' : `(${((pendingFile?.size ?? 0) / 1024).toFixed(0)} KB)`}</span>
                <button
                  type="button"
                  onClick={onRemovePendingFile}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#DC2626',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    padding: '0 4px',
                    marginLeft: 'auto',
                  }}
                >
                  remover
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={onInputChange}
                onKeyDown={onInputKeyDown}
                onPaste={onComposerPaste}
                placeholder={canSend ? (isWhatsapp ? 'Mensagem WhatsApp... (Enter para enviar)' : 'Digite sua mensagem...') : 'Conversa indisponivel para envio'}
                disabled={!canSend || isRecording}
                rows={1}
                style={{
                  flex: 1,
                  background: canSend && !isRecording ? inputBackgroundColor : '#F8F8FB',
                  border: '1px solid rgba(0,0,0,.12)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: textColor,
                  outline: 'none',
                  resize: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  minHeight: 44,
                  maxHeight: 120,
                  opacity: canSend && !isRecording ? 1 : 0.6,
                  transition: 'border-color .15s',
                }}
              />
              <EmojiPicker onSelect={onInsertEmoji} position="top" />
              {/* Botão dinâmico: Mic (campo vazio) | Stop (gravando) | Send (tem texto/arquivo) */}
              {isRecording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  title="Parar gravacao"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    border: '1px solid rgba(220,38,38,.25)',
                    background: '#FEE2E2',
                    color: '#DC2626',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background .15s',
                  }}
                >
                  <StopCircle size={16} strokeWidth={2} />
                </button>
              ) : showMicButton ? (
                <button
                  type="button"
                  onClick={startRecording}
                  title="Gravar audio"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    border: '1px solid rgba(0,0,0,.08)',
                    background: '#F8FAFC',
                    color: mutedTextColor,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background .15s',
                  }}
                >
                  <Mic size={16} strokeWidth={2} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSending || !canSend || (!inputValue.trim() && !pendingFile)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    border: 'none',
                    background: isSending || !canSend || (!inputValue.trim() && !pendingFile) ? '#E2E8F0' : accentColor,
                    cursor: isSending || !canSend || (!inputValue.trim() && !pendingFile) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background .15s',
                  }}
                >
                  <Send size={16} color="#fff" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function AtendimentoPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [rootCauseOptions, setRootCauseOptions] = useState<string[]>([]);
  const [conversationTags, setConversationTags] = useState<string[]>([]);
  const [savingConversationTags, setSavingConversationTags] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'no_ticket' | 'linked' | 'closed'>(() => {
    try { return (localStorage.getItem('atend_filter') as any) || 'all'; } catch { return 'all'; }
  });
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp'>(() => {
    try {
      const saved = localStorage.getItem('atend_channel');
      return saved === 'whatsapp' ? 'whatsapp' : 'all';
    } catch { return 'all'; }
  });
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => {
    try { return localStorage.getItem('atend_panel_open') !== 'false'; } catch { return true; }
  });
  /** Fallback SSR/hidratação: `normal`; depois lê `CHAT_DENSITY_STORAGE_KEY`. */
  const [chatDensity, setChatDensity] = useState<ChatDensityMode>(DEFAULT_CHAT_DENSITY_MODE);
  const [chatDensityHydrated, setChatDensityHydrated] = useState(false);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const [messageMediaUrls, setMessageMediaUrls] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTicketSearch, setLinkTicketSearch] = useState('');
  const [linkTickets, setLinkTickets] = useState<any[]>([]);
  const [linkSelectedId, setLinkSelectedId] = useState<string | null>(null);
  const [linkReason, setLinkReason] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tenantPriorities, setTenantPriorities] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState({
    subject:'', description:'', priority: DEFAULT_PRIORITY, priorityId: '' as string,
    department:'', category:'', subcategory:'', assignedTo:'', networkId:'', clientId:'',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [ticketSettingsTree, setTicketSettingsTree] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const loadChatErrorShownRef = useRef(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [startingAttendance, setStartingAttendance] = useState(false);
  const startingAttendanceRef = useRef(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [startMode, setStartMode] = useState<'contact' | 'phone'>('contact');
  const [startClientId, setStartClientId] = useState('');
  const [startClientName, setStartClientName] = useState('');
  const [startContactId, setStartContactId] = useState('');
  const [startContacts, setStartContacts] = useState<any[]>([]);
  const [startContactSearch, setStartContactSearch] = useState('');
  const [startingConv, setStartingConv] = useState(false);
  const [loadingStartContacts, setLoadingStartContacts] = useState(false);
  // Busca de cliente no modal
  const [startClientInput, setStartClientInput] = useState('');
  const [startClientResults, setStartClientResults] = useState<any[]>([]);
  const [startClientSearching, setStartClientSearching] = useState(false);
  const [startClientDropdown, setStartClientDropdown] = useState(false);
  // Modo "Por número"
  const [startPhone, setStartPhone] = useState('');
  const [startPhoneChecking, setStartPhoneChecking] = useState(false);
  const [startPhoneResult, setStartPhoneResult] = useState<{ exists: boolean; jid: string | null; normalized: string } | null>(null);
  // Mensagem inicial (ambos os modos)
  const [startFirstMessage, setStartFirstMessage] = useState('');
  const [startMsgMode, setStartMsgMode] = useState<'text' | 'template'>('text');
  const [startTemplateName, setStartTemplateName] = useState('');
  const [startTemplateLang, setStartTemplateLang] = useState('pt_BR');
  const [startTemplateParams, setStartTemplateParams] = useState<string[]>([]);
  const [metaTemplates, setMetaTemplates] = useState<{ name: string; language: string; status: string; body: string; paramCount: number }[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [createCustomers, setCreateCustomers] = useState<any[]>([]);
  const [createClientSearch, setCreateClientSearch] = useState('');
  const [createClientName, setCreateClientName] = useState('');
  const [createClientResults, setCreateClientResults] = useState<any[]>([]);
  const [createClientLoading, setCreateClientLoading] = useState(false);
  const [showCreateClientDropdown, setShowCreateClientDropdown] = useState(false);
  const createClientSearchTimer = useRef<any>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showKeepOpenModal, setShowKeepOpenModal] = useState(false);
  const [keepOpenReason, setKeepOpenReason] = useState('');
  const [keepOpenSolution, setKeepOpenSolution] = useState('');
  const [showCloseForm, setShowCloseForm] = useState(false);
  const COMPLEXITY_LABELS: Record<number,string> = { 1:'Muito simples', 2:'Simples', 3:'Moderado', 4:'Complexo', 5:'Muito complexo' };
  const [closeForm, setCloseForm] = useState({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const ticketPanelRef = useRef<HTMLDivElement>(null);
  const [ticketPanelStatusDraft, setTicketPanelStatusDraft] = useState('');
  const [ticketPanelSubjectDraft, setTicketPanelSubjectDraft] = useState('');
  const [ticketPanelDescDraft, setTicketPanelDescDraft] = useState('');
  const [ticketPanelStatusSaving, setTicketPanelStatusSaving] = useState(false);
  const [ticketPanelSubjectSaving, setTicketPanelSubjectSaving] = useState(false);
  const [ticketPanelDescSaving, setTicketPanelDescSaving] = useState(false);
  const [ticketPanelPriorityIdDraft, setTicketPanelPriorityIdDraft] = useState('');
  const [ticketPanelDeptDraft, setTicketPanelDeptDraft] = useState('');
  const [ticketPanelCatDraft, setTicketPanelCatDraft] = useState('');
  const [ticketPanelSubDraft, setTicketPanelSubDraft] = useState('');
  const [ticketPanelPrioritySaving, setTicketPanelPrioritySaving] = useState(false);
  const [ticketPanelClassSaving, setTicketPanelClassSaving] = useState(false);
  const [ticketInfoExpanded, setTicketInfoExpanded] = useState(false);
  const [clientTickets, setClientTickets] = useState<any[]>([]);
  /** Painel deslizante (Zenvia-style): detalhe de ticket sem sair do atendimento */
  const [ticketDetailSheetOpen, setTicketDetailSheetOpen] = useState(false);
  const [ticketDetailSheetTicket, setTicketDetailSheetTicket] = useState<any>(null);
  const [ticketDetailSheetLoading, setTicketDetailSheetLoading] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [showEditContactModal, setShowEditContactModal] = useState(false);
  const [loadingEditContact, setLoadingEditContact] = useState(false);
  const [savingEditContact, setSavingEditContact] = useState(false);
  const [editContactForm, setEditContactForm] = useState({
    id: '',
    clientId: '',
    name: '',
    email: '',
    phone: '',
    whatsapp: '',
  });

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [isContactTyping, setIsContactTyping] = useState(false);
  const contactTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentIsTypingRef = useRef(false);
  // ── busca dentro da conversa ──
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [msgSearchIdx, setMsgSearchIdx] = useState(0);
  const msgSearchInputRef = useRef<HTMLInputElement>(null);

  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const selectedRef = useRef<any>(null);
  selectedRef.current = selected;
  // Espelho de conversations para acesso em callbacks sem criar dependência de closure
  const conversationsRef = useRef<any[]>([]);
  conversationsRef.current = conversations;
  // Guard contra burst de reloads quando várias mensagens chegam para conversa nova
  const reloadPendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageMediaUrlsRef = useRef<Record<string, string>>({});
  messageMediaUrlsRef.current = messageMediaUrls;
  const mediaInFlightRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // true = usuário está perto do fim da lista

  // ── paginação de mensagens ──
  const hasMoreMsgsRef = useRef(false);      // espelho de hasMoreMsgs para uso em callbacks
  const loadingMoreMsgsRef = useRef(false);  // espelho de loadingMoreMsgs para uso em callbacks
  const oldestMsgIdRef = useRef<string | null>(null); // cursor: ID da mensagem mais antiga carregada
  const prevScrollHeightRef = useRef(0);     // scrollHeight antes de prepend (para restaurar posição)
  const shouldRestoreScrollRef = useRef(false);
  hasMoreMsgsRef.current = hasMoreMsgs;
  loadingMoreMsgsRef.current = loadingMoreMsgs;

  // ── cache de dados estáveis + guard de race condition ──
  const loadIdRef = useRef(0);          // incrementado a cada loadChat; respostas velhas são descartadas
  const customersRef = useRef<any[]>([]); // cache de clientes — não rebusca a cada troca de conversa
  const teamRef = useRef<any[]>([]);      // cache de equipe — idem
  const customersCachedAtRef = useRef<number>(0);      // timestamp do último fetch completo de customers
  const teamCachedAtRef = useRef<number>(0);           // timestamp do último fetch completo de team
  // cache de contatos por clientId → evita refetch a cada troca de contato
  const contactsCacheRef = useRef<Record<string, { data: any[]; ts: number }>>({});
  // cache de contato individual por contactId (convs sem clientId)
  const singleContactCacheRef = useRef<Record<string, { data: any; ts: number }>>({});
  const PHASE2_CACHE_TTL = 2 * 60 * 1000; // 2 minutos

  // ── helpers ──
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  /** Abre o painel direito e rola até o bloco de detalhes do ticket (sem navegar para outra página). */
  const openTicketPanelAndScroll = useCallback(() => {
    setPanelOpen(true);
    try { localStorage.setItem('atend_panel_open', 'true'); } catch {}
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        ticketPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 240);
    });
  }, []);

  const closeTicketDetailSheet = useCallback(() => {
    setTicketDetailSheetOpen(false);
    setTicketDetailSheetTicket(null);
    setTicketDetailSheetLoading(false);
  }, []);

  /** Abre drawer lateral com outro ticket; se for o da conversa atual, só foca o painel fixo. */
  const openTicketDetailSheet = useCallback(
    async (ticketId: string) => {
      const currentId = String(currentTicket?.id || selected?.ticketId || '');
      if (ticketId && String(ticketId) === currentId) {
        openTicketPanelAndScroll();
        return;
      }
      setTicketDetailSheetOpen(true);
      setTicketDetailSheetLoading(true);
      setTicketDetailSheetTicket(null);
      try {
        const res: any = await api.getTicket(ticketId);
        const t = res?.data ?? res;
        setTicketDetailSheetTicket(t);
      } catch {
        showToast('Não foi possível carregar o ticket', 'error');
        closeTicketDetailSheet();
      } finally {
        setTicketDetailSheetLoading(false);
      }
    },
    [currentTicket?.id, selected?.ticketId, openTicketPanelAndScroll, closeTicketDetailSheet, showToast],
  );

  const openTicketDetailSheetRef = useRef(openTicketDetailSheet);
  openTicketDetailSheetRef.current = openTicketDetailSheet;

  useEffect(() => {
    if (!ticketDetailSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTicketDetailSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticketDetailSheetOpen, closeTicketDetailSheet]);

  /** Busca global / notificações: abrir ticket no painel/drawer sem sair do atendimento. */
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<AtendimentoOpenTicketDetail>).detail;
      const id = detail?.ticketId?.trim();
      if (!id) return;
      setPanelOpen(true);
      try { localStorage.setItem('atend_panel_open', 'true'); } catch {}
      void openTicketDetailSheet(id);
    };
    window.addEventListener(ATENDIMENTO_OPEN_TICKET_EVENT, onOpen);
    return () => window.removeEventListener(ATENDIMENTO_OPEN_TICKET_EVENT, onOpen);
  }, [openTicketDetailSheet]);

  /**
   * `?openTicket=` na URL: abre painel/drawer.
   * Não depender de `openTicketDetailSheet` nas deps — a identidade dele muda com conversa/ticket atual
   * e o re-run + cleanup pode atrapalhar o `router.replace` ou disparar abertura duplicada.
   */
  useEffect(() => {
    const id = searchParams.get(ATENDIMENTO_OPEN_TICKET_QUERY)?.trim();
    if (!id) return;
    setPanelOpen(true);
    try { localStorage.setItem('atend_panel_open', 'true'); } catch {}
    void openTicketDetailSheetRef.current(id);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(ATENDIMENTO_OPEN_TICKET_QUERY);
    const qs = nextParams.toString();
    const url = `${pathname}${qs ? `?${qs}` : ''}`;
    queueMicrotask(() => {
      router.replace(url, { scroll: false });
    });
  }, [searchParams, pathname, router]);

  const handlePanelTicketStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    if (!currentTicket?.id) return;
    if (newStatus === currentTicket.status) return;
    setTicketPanelStatusDraft(newStatus);
    setTicketPanelStatusSaving(true);
    try {
      const body: Record<string, string> = { status: newStatus };
      if (newStatus === 'cancelled') body.cancelReason = 'Cancelado pelo agente no atendimento';
      const updated: any = await api.updateTicket(currentTicket.id, body);
      setCurrentTicket((prev: any) => (prev ? { ...prev, ...updated } : prev));
      setTicketPanelStatusDraft(String(updated?.status ?? newStatus));
      showToast('Status atualizado');
    } catch (err: any) {
      setTicketPanelStatusDraft(String(currentTicket.status ?? 'open'));
      showToast(err?.response?.data?.message || 'Erro ao atualizar status', 'error');
    }
    setTicketPanelStatusSaving(false);
  };

  const handlePanelTicketSubjectSave = async () => {
    if (!currentTicket?.id) return;
    const s = ticketPanelSubjectDraft.trim();
    if (s.length < 3) {
      showToast('Assunto deve ter pelo menos 3 caracteres', 'error');
      return;
    }
    const prevSub = String(currentTicket.subject ?? '').trim();
    if (s === prevSub) return;
    setTicketPanelSubjectSaving(true);
    try {
      const updated: any = await api.updateTicketContent(currentTicket.id, { subject: s });
      setCurrentTicket((prev: any) =>
        prev ? { ...prev, subject: updated?.subject ?? s } : prev,
      );
      setTicketPanelSubjectDraft(String(updated?.subject ?? s));
      showToast('Assunto atualizado');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Erro ao salvar assunto', 'error');
    }
    setTicketPanelSubjectSaving(false);
  };

  const handlePanelTicketDescriptionSave = async () => {
    if (!currentTicket?.id) return;
    const d = ticketPanelDescDraft.trim();
    const prevDesc = String(currentTicket.description ?? '').trim();
    if (d === prevDesc) return;
    if (d.length > 0 && d.length < 3) {
      showToast('Descrição deve ter pelo menos 3 caracteres', 'error');
      return;
    }
    setTicketPanelDescSaving(true);
    try {
      const subject = String(currentTicket.subject ?? '').trim();
      if (!subject) {
        showToast('Defina o assunto do ticket antes de salvar a descrição.', 'error');
        setTicketPanelDescSaving(false);
        return;
      }
      const updated: any = await api.updateTicketContent(currentTicket.id, {
        subject,
        description: d,
      });
      setCurrentTicket((prev: any) =>
        prev ? { ...prev, description: updated?.description ?? d } : prev,
      );
      setTicketPanelDescDraft(String(updated?.description ?? d));
      showToast('Descrição atualizada');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Erro ao salvar descrição', 'error');
    }
    setTicketPanelDescSaving(false);
  };

  const handlePanelTicketPriorityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const priorityId = e.target.value;
    if (!currentTicket?.id) return;
    if (String(priorityId || '') === String(currentTicket.priorityId ?? '')) return;
    const sel = tenantPriorities.find((p: any) => p.id === priorityId);
    setTicketPanelPriorityIdDraft(priorityId);
    setTicketPanelPrioritySaving(true);
    try {
      const body: Record<string, unknown> = { priorityId: priorityId || null };
      if (sel && ['low', 'medium', 'high', 'critical'].includes(sel.slug)) body.priority = sel.slug;
      const updated: any = await api.updateTicket(currentTicket.id, body);
      setCurrentTicket((prev: any) => (prev ? { ...prev, ...updated } : prev));
      setTicketPanelPriorityIdDraft(String(updated?.priorityId ?? priorityId ?? ''));
      showToast('Prioridade atualizada');
    } catch (err: any) {
      setTicketPanelPriorityIdDraft(String(currentTicket.priorityId ?? ''));
      showToast(err?.response?.data?.message || 'Erro ao atualizar prioridade', 'error');
    }
    setTicketPanelPrioritySaving(false);
  };

  const handlePanelTicketClassificationSave = async () => {
    if (!currentTicket?.id) return;
    const d = ticketPanelDeptDraft.trim();
    const c = ticketPanelCatDraft.trim();
    const s = ticketPanelSubDraft.trim();
    const curD = String(currentTicket.department ?? '').trim();
    const curC = String(currentTicket.category ?? '').trim();
    const curS = String(currentTicket.subcategory ?? '').trim();
    if (d === curD && c === curC && s === curS) return;
    setTicketPanelClassSaving(true);
    try {
      const updated: any = await api.updateTicket(currentTicket.id, {
        department: d || undefined,
        category: c || undefined,
        subcategory: s || undefined,
      });
      setCurrentTicket((prev: any) => (prev ? { ...prev, ...updated } : prev));
      setTicketPanelDeptDraft(String(updated?.department ?? d));
      setTicketPanelCatDraft(String(updated?.category ?? c));
      setTicketPanelSubDraft(String(updated?.subcategory ?? s));
      showToast('Classificação atualizada');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'Erro ao salvar classificação', 'error');
    }
    setTicketPanelClassSaving(false);
  };

  const applyUpdatedContactLocally = useCallback((updatedContact: any, clientId: string) => {
    if (!updatedContact?.id) return;

    setContacts((prev) => {
      const exists = prev.some((contact: any) => contact.id === updatedContact.id);
      if (!exists) return prev;
      return prev.map((contact: any) => contact.id === updatedContact.id ? { ...contact, ...updatedContact } : contact);
    });

    if (clientId && contactsCacheRef.current[clientId]) {
      contactsCacheRef.current[clientId] = {
        ...contactsCacheRef.current[clientId],
        data: contactsCacheRef.current[clientId].data.map((contact: any) =>
          contact.id === updatedContact.id ? { ...contact, ...updatedContact } : contact,
        ),
        ts: Date.now(),
      };
    }

    singleContactCacheRef.current[updatedContact.id] = {
      data: {
        ...(singleContactCacheRef.current[updatedContact.id]?.data ?? {}),
        ...updatedContact,
      },
      ts: Date.now(),
    };

    setConversations((prev) => prev.map((conversation: any) =>
      conversation.contactId === updatedContact.id
        ? { ...conversation, contactName: updatedContact.name || conversation.contactName }
        : conversation,
    ));

    setSelected((prev: any) => prev && prev.contactId === updatedContact.id
      ? { ...prev, contactName: updatedContact.name || prev.contactName }
      : prev,
    );
  }, []);

  const openEditContactModal = useCallback(async () => {
    const contactId = selected?.contactId || currentTicket?.contactId;
    if (!contactId) {
      showToast('Nenhum contato encontrado para este atendimento.', 'error');
      return;
    }

    setLoadingEditContact(true);
    try {
      let sourceContact = contacts.find((contact: any) => contact.id === contactId) || null;
      if (!sourceContact) {
        const fetched: any = await api.getContactById(contactId);
        sourceContact = fetched?.data ?? fetched;
      }

      if (!sourceContact?.id) {
        showToast('Nao foi possivel carregar os dados do contato.', 'error');
        return;
      }

      setEditContactForm({
        id: sourceContact.id,
        clientId: sourceContact.clientId || selected?.clientId || currentTicket?.clientId || '',
        name: sourceContact.name || '',
        email: sourceContact.email || '',
        phone: sourceContact.phone || '',
        whatsapp: sourceContact.whatsapp || '',
      });
      setShowEditContactModal(true);
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Erro ao carregar contato', 'error');
    } finally {
      setLoadingEditContact(false);
    }
  }, [contacts, currentTicket?.clientId, currentTicket?.contactId, selected?.clientId, selected?.contactId]);

  const saveEditedContact = useCallback(async () => {
    if (!editContactForm.id) return;
    const trimmedName = editContactForm.name.trim();
    if (!trimmedName) {
      showToast('Nome do contato é obrigatório.', 'error');
      return;
    }

    setSavingEditContact(true);
    try {
      let resolvedClientId = editContactForm.clientId;
      if (!resolvedClientId) {
        const fetched: any = await api.getContactById(editContactForm.id);
        const fetchedContact = fetched?.data ?? fetched;
        resolvedClientId = fetchedContact?.clientId || '';
      }

      if (!resolvedClientId) {
        showToast('Nao foi possivel identificar o cliente do contato.', 'error');
        return;
      }

      const payload = {
        name: trimmedName,
        email: editContactForm.email.trim(),
        phone: editContactForm.phone.trim(),
        whatsapp: editContactForm.whatsapp.trim(),
      };

      const updated: any = await api.updateContact(resolvedClientId, editContactForm.id, payload);
      const updatedContact = {
        ...(contacts.find((contact: any) => contact.id === editContactForm.id) || {}),
        ...(updated?.data ?? updated),
        clientId: resolvedClientId,
      };

      applyUpdatedContactLocally(updatedContact, resolvedClientId);
      setShowEditContactModal(false);
      showToast('Contato atualizado com sucesso.');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Erro ao salvar contato', 'error');
    } finally {
      setSavingEditContact(false);
    }
  }, [applyUpdatedContactLocally, contacts, editContactForm]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    atBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    if (nearBottom) setShowScrollBtn(false);
    // Próximo do topo → carrega mensagens mais antigas
    if (el.scrollTop < 80 && hasMoreMsgsRef.current && !loadingMoreMsgsRef.current) {
      loadMoreMsgsRef.current();
    }
  }, []);

  // Carrega mensagens mais antigas (scroll para cima). Preserva posição de scroll via useLayoutEffect.
  const loadMoreMsgsRef = useRef<() => void>(() => {});
  const loadMoreMessages = useCallback(async () => {
    const conv = selectedRef.current;
    if (!conv || !oldestMsgIdRef.current || loadingMoreMsgsRef.current || !hasMoreMsgsRef.current) return;
    const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
    if (isTicket) return; // tickets carregam tudo de uma vez
    setLoadingMoreMsgs(true);
    loadingMoreMsgsRef.current = true;
    try {
      const paged: any = await api.getConversationMessages(conv.id, {
        limit: 50,
        before: oldestMsgIdRef.current,
      });
      const older: any[] = paged?.messages ?? [];
      if (older.length > 0) {
        const el = scrollContainerRef.current;
        if (el) prevScrollHeightRef.current = el.scrollHeight;
        shouldRestoreScrollRef.current = true;
        oldestMsgIdRef.current = older[0]?.id ?? oldestMsgIdRef.current;
        setMessages((m) => [...older, ...m]);
      }
      setHasMoreMsgs(paged?.hasMore === true);
    } catch {}
    setLoadingMoreMsgs(false);
    loadingMoreMsgsRef.current = false;
  }, []);
  loadMoreMsgsRef.current = loadMoreMessages;

  // Restaura posição de scroll após prepend de mensagens antigas (sem pular)
  useLayoutEffect(() => {
    if (shouldRestoreScrollRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTop = el.scrollTop + (el.scrollHeight - prevScrollHeightRef.current);
      shouldRestoreScrollRef.current = false;
    }
  });

  const sameItem = (a: any, b: any) => {
    if (!a || !b) return false;
    if (String(a.id) === String(b.id)) return true;
    if (a.ticketId && b.ticketId && String(a.ticketId) === String(b.ticketId)) return true;
    return false;
  };

  const customerName = (cid: string) => {
    const c = customers.find((x: any) => x.id === cid);
    return c ? (c.tradeName || c.companyName) : '—';
  };

  const contactName = (cid: string) => {
    const c = contacts.find((x: any) => x.id === cid);
    return c?.name || '—';
  };

  const canEditConversationTags = hasPermission(user, 'ticket.edit');
  const canEditTicketPanelFields = hasPermission(user, 'ticket.edit');
  const canEditTicketPanelContent = hasPermission(user, 'ticket.edit_content');
  const canManageCustomerLink = hasPermission(user, 'customer.edit');
  const canCloseTicket = hasPermission(user, 'ticket.close');
  const [customerLinkRequired, setCustomerLinkRequired] = useState(false);

  useEffect(() => {
    setCustomerLinkRequired(false);
  }, [currentTicket?.id]);

  useEffect(() => {
    if (!currentTicket?.id) return;
    setTicketPanelSubjectDraft(String(currentTicket.subject ?? ''));
    setTicketPanelDescDraft(String(currentTicket.description ?? ''));
    setTicketPanelStatusDraft(String(currentTicket.status ?? 'open'));
    setTicketPanelPriorityIdDraft(String(currentTicket.priorityId ?? ''));
    setTicketPanelDeptDraft(String(currentTicket.department ?? ''));
    setTicketPanelCatDraft(String(currentTicket.category ?? ''));
    setTicketPanelSubDraft(String(currentTicket.subcategory ?? ''));
    setTicketInfoExpanded(false);
  }, [currentTicket?.id]);

  useEffect(() => {
    if (!currentTicket?.id || !canEditTicketPanelFields) return;
    if (ticketSettingsTree.length > 0) return;
    void (async () => {
      try {
        const r: any = await api.getTicketSettingsTree();
        const depts = Array.isArray(r) ? r : r?.departments ?? r?.data?.departments ?? [];
        setTicketSettingsTree(depts);
      } catch {
        /* mantém vazio */
      }
    })();
  }, [currentTicket?.id, canEditTicketPanelFields, ticketSettingsTree.length]);

  // ── data loading ──
  const loadConversations = useCallback(async (resetSelection = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (channelFilter !== 'all') params.channel = channelFilter;
      if (filter === 'no_ticket') { params.hasTicket = 'no'; params.status = 'active'; }
      else if (filter === 'linked') { params.hasTicket = 'yes'; params.status = 'active'; }
      else if (filter === 'closed') { params.status = 'closed'; params.hasTicket = 'all'; }
      else { params.status = 'active'; params.hasTicket = 'all'; }
      const [convList, ticketConvList] = await Promise.all([
        api.getConversations(params),
        (channelFilter === 'whatsapp' || channelFilter === 'all')
          ? api.getTicketConversations({ origin: 'whatsapp', status: filter === 'closed' ? 'closed' : 'active', perPage: 50 }).catch(() => [] as any)
          : Promise.resolve([]),
      ]);
      const convArr = (Array.isArray(convList) ? convList : (convList as any)?.data ?? []).filter((c: any) => c?.channel !== 'portal');
      const ticketArr = Array.isArray(ticketConvList) ? ticketConvList : (ticketConvList as any)?.data ?? [];
      const sorted = [...convArr.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ticketArr]
        .sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
      // Deduplica por contactId — 1 chat ativo por contato (mantém o mais recente)
      const seenContacts = new Set<string>();
      const merged = sorted.filter((c: any) => {
        if (!c.contactId) return true;
        if (seenContacts.has(c.contactId)) return false;
        seenContacts.add(c.contactId);
        return true;
      });
      setConversations(merged);
      const currentSelected = selectedRef.current;
      if (resetSelection) {
        setSelected(merged.length ? merged[0] : null);
      } else if (!currentSelected) {
        setSelected(merged.length ? merged[0] : null);
      } else {
        const found = merged.find((c: any) => sameItem(c, currentSelected));
        // Mantém seleção atual se ainda existe; só atualiza o objeto (dados frescos)
        if (found) setSelected(found);
        // else: conversa não encontrada na lista (filtro mudou) → não força primeiro item
      }
    } catch (e) { console.error(e); setConversations([]); }
    setLoading(false);
  }, [filter, channelFilter]);

  const loadChat = async (conv: any) => {
    if (!conv) return;
    const myId = ++loadIdRef.current; // guard de race condition
    setLoadingChat(true);
    setCurrentTicket(null);
    setConversationTags(Array.isArray(conv?.tags) ? conv.tags : []);
    atBottomRef.current = true; // sempre vai para o fim ao trocar de conversa
    setShowScrollBtn(false);
    setHasMoreMsgs(false);
    oldestMsgIdRef.current = null;
    // Limpa estado de "digitando..." ao trocar de conversa
    setIsContactTyping(false);
    if (contactTypingTimeoutRef.current) { clearTimeout(contactTypingTimeoutRef.current); contactTypingTimeoutRef.current = null; }
    // Cancela "agente digitando" pendente
    if (agentIsTypingRef.current && conv?.channel === 'whatsapp') {
      agentIsTypingRef.current = false;
    }
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      const tid = ticketId || conv.ticketId;

      // ── FASE 1: essencial — ticket + mensagens em paralelo ──────────────
      // Spinner some assim que estes dois chegarem (~150ms vs ~700ms antes)
      const [ticketRes, msgsRaw] = await Promise.all([
        tid ? api.getTicket(tid).catch(() => null) : Promise.resolve(null),
        isTicket && ticketId
          ? api.getMessages(ticketId, false)
          : api.getConversationMessages(conv.id, { limit: 50 }),
      ]);

      if (myId !== loadIdRef.current) return; // conversa já mudou, descarta

      if (ticketRes) setCurrentTicket(ticketRes);
      // Ambos retornam { messages, hasMore } — getMessages sempre passa limit=200
      {
        const paged = msgsRaw as any;
        const arr: any[] = paged?.messages ?? [];
        setMessages(arr);
        setHasMoreMsgs(paged?.hasMore === true);
        oldestMsgIdRef.current = arr[0]?.id ?? null;
      }
      loadChatErrorShownRef.current = false;
      setLoadingChat(false); // ← conteúdo visível aqui; fase 2 roda em background

      // Envia read receipts para mensagens do contato via Baileys (best-effort, não bloqueia)
      if (!isTicket && conv.channel === 'whatsapp' && conv.id) {
        api.markConversationRead(conv.id).catch(() => {});
      }

      // ── FASE 2: dados de suporte — sem bloquear a UI ─────────────────────
      const clientId = conv.clientId;
      const contactId = conv.contactId || (ticketRes as any)?.contactId;
      const now = Date.now();

      const needCustomers = customersRef.current.length === 0 || (now - customersCachedAtRef.current) > PHASE2_CACHE_TTL;
      const needTeam = teamRef.current.length === 0 || (now - teamCachedAtRef.current) > PHASE2_CACHE_TTL;

      // Verifica cache de contatos — evita refetch a cada troca de contato
      const cachedClientContacts = clientId ? contactsCacheRef.current[clientId] : null;
      const cachedSingleContact = (!clientId && contactId) ? singleContactCacheRef.current[contactId] : null;
      const needContacts = clientId
        ? !cachedClientContacts || (now - cachedClientContacts.ts) > PHASE2_CACHE_TTL
        : (!clientId && contactId)
          ? !cachedSingleContact || (now - cachedSingleContact.ts) > PHASE2_CACHE_TTL
          : false;

      // Customers + team + contacts todos em paralelo (somente o que não está cacheado)
      const [customersRes, teamRes, contactsRaw] = await Promise.all([
        needCustomers ? api.getCustomers({ perPage: 200 }).catch(() => null) : Promise.resolve(null),
        needTeam ? api.getTeam().catch(() => null) : Promise.resolve(null),
        needContacts
          ? (clientId
              ? api.getContacts(clientId).catch(() => null)
              : contactId ? api.getContactById(contactId).catch(() => null) : Promise.resolve(null))
          : Promise.resolve(null),
      ]);

      if (myId !== loadIdRef.current) return;

      // Customers — atualiza cache e estado
      if (customersRes) {
        const arr: any[] = Array.isArray(customersRes)
          ? customersRes
          : Array.isArray((customersRes as any)?.data)
            ? (customersRes as any).data
            : (customersRes as any) || [];
        // Cliente desta conversa fora da lista paginada → busca individual
        if (clientId && !arr.find((c: any) => c.id === clientId)) {
          try { const r: any = await api.getCustomer(clientId); if (r) arr.push(r?.data ?? r); } catch {}
        }
        customersRef.current = arr;
        customersCachedAtRef.current = now;
        if (myId === loadIdRef.current) setCustomers(arr);
      } else if (clientId && !customersRef.current.find((c: any) => c.id === clientId)) {
        // Cache existente mas sem este cliente específico → busca individual
        try {
          const r: any = await api.getCustomer(clientId);
          if (r && myId === loadIdRef.current) {
            const arr = [...customersRef.current, r?.data ?? r];
            customersRef.current = arr;
            setCustomers(arr);
          }
        } catch {}
      }

      // Team — atualiza cache e estado
      if (teamRes) {
        let arr: any[] = Array.isArray(teamRes)
          ? teamRes
          : Array.isArray((teamRes as any)?.data)
            ? (teamRes as any).data
            : [];
        teamRef.current = arr;
        teamCachedAtRef.current = now;
        if (myId === loadIdRef.current) setTeam(arr);
      }
      // Garante que o agente responsável pelo ticket esteja na lista
      const ticketForAssign = ticketRes as { assignedTo?: string } | null;
      if (ticketForAssign?.assignedTo) {
        const cur = teamRef.current;
        if (!cur.find((u: any) => String(u.id) === String(ticketForAssign.assignedTo))) {
          try {
            const m: any = await api.getTeamMember(ticketForAssign.assignedTo);
            const member = m?.data ?? m;
            if (member?.id && myId === loadIdRef.current) {
              const arr = [...teamRef.current, member];
              teamRef.current = arr;
              teamCachedAtRef.current = now;
              setTeam(arr);
            }
          } catch {}
        }
      }

      if (myId !== loadIdRef.current) return;

      // Contacts — usa cache quando disponível, evita refetch a cada troca
      if (clientId) {
        let ctArr: any[];
        if (contactsRaw) {
          // Dados frescos da API — popula cache
          ctArr = Array.isArray(contactsRaw) ? contactsRaw : (contactsRaw as any)?.data ?? [];
          // Contato específico fora da lista do cliente → busca individual (com cache)
          if (contactId && !ctArr.find((c: any) => c.id === contactId)) {
            const cachedInd = singleContactCacheRef.current[contactId];
            if (cachedInd && (now - cachedInd.ts) < PHASE2_CACHE_TTL) {
              ctArr = [...ctArr, cachedInd.data];
            } else {
              try {
                const ind: any = await api.getContactById(contactId);
                if (ind) {
                  const ct = ind?.data ?? ind;
                  singleContactCacheRef.current[contactId] = { data: ct, ts: now };
                  ctArr = [...ctArr, ct];
                }
              } catch {}
            }
          }
          contactsCacheRef.current[clientId] = { data: ctArr, ts: now };
        } else {
          // Cache válido — reutiliza sem nenhuma requisição
          ctArr = cachedClientContacts?.data ?? [];
        }
        if (myId === loadIdRef.current) {
          setContacts(ctArr);
          // Assina presença do contato WhatsApp para receber "digitando..."
          if (conv.channel === 'whatsapp') {
            const phone = ctArr.find((c: any) => c.whatsapp)?.whatsapp;
            if (phone && user?.tenantId) {
              const digits = phone.replace(/\D/g, '');
              const jid = digits.length >= 14 ? `${digits}@lid` : `${digits}@s.whatsapp.net`;
              subscribeContactPresence(jid, user.tenantId);
            }
          }
        }
      } else if (!clientId && contactId) {
        let ct: any;
        if (contactsRaw) {
          // Dados frescos da API — popula cache
          ct = (contactsRaw as any)?.data ?? contactsRaw;
          if (ct) singleContactCacheRef.current[contactId] = { data: ct, ts: now };
        } else if (cachedSingleContact) {
          // Cache válido — reutiliza
          ct = cachedSingleContact.data;
        } else {
          ct = null;
        }
        if (myId === loadIdRef.current) setContacts(ct ? [ct] : []);
      }

    } catch (e) {
      console.error(e);
      if (!loadChatErrorShownRef.current) {
        loadChatErrorShownRef.current = true;
        showToast('Não foi possível carregar o histórico deste atendimento. Tente atualizar.', 'error');
      }
      if (myId === loadIdRef.current) setLoadingChat(false);
    }
  };

  const reloadMessages = async (conv: any) => {
    if (!conv) return;
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      const msgsEndpoint = isTicket && ticketId
        ? api.getMessages(ticketId, false)
        : api.getConversationMessages(conv.id, { limit: 50 });
      const paged: any = await msgsEndpoint;
      const arr: any[] = paged?.messages ?? [];
      setMessages(arr);
      setHasMoreMsgs(paged?.hasMore === true);
      oldestMsgIdRef.current = arr[0]?.id ?? null;
      loadChatErrorShownRef.current = false;
    } catch (e) {
      console.error(e);
      if (!loadChatErrorShownRef.current) {
        loadChatErrorShownRef.current = true;
        showToast('Não foi possível atualizar as mensagens deste atendimento.', 'error');
      }
    }
  };

  const searchTicketsForLink = useCallback(async () => {
    const clientId = selected?.clientId;
    const contactId = selected?.contactId;
    try {
      const params: any = { perPage: 100 };
      if (linkTicketSearch?.trim()) params.search = linkTicketSearch.trim();
      if (clientId) params.clientId = clientId;
      else if (contactId) params.contactId = contactId;
      const res: any = await api.getTickets(params);
      const inner = res?.data ?? res;
      const data = Array.isArray(inner) ? inner : inner?.data ?? [];
      setLinkTickets(data);
    } catch { setLinkTickets([]); }
  }, [selected?.clientId, selected?.contactId, linkTicketSearch]);

  useEffect(() => {
    void (async () => {
      try {
        const r: any = await api.getTenantPrioritiesForTickets();
        setTenantPriorities(Array.isArray(r) ? r : r?.data ?? []);
      } catch {
        setTenantPriorities([]);
      }
    })();
  }, []);

  // ── end flow ──
  const openEndFlow = () => {
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowEndModal(true);
  };
  const handleKeepOpen = () => { setShowEndModal(false); setKeepOpenReason(''); setKeepOpenSolution(''); setShowKeepOpenModal(true); };
  const handleCloseTicket = () => {
    if (customerLinkRequired) {
      showToast(
        canManageCustomerLink
          ? 'Defina a empresa deste atendimento antes de encerrar o ticket.'
          : 'Este atendimento ainda precisa de uma empresa vinculada antes do encerramento.',
        'error',
      );
      return;
    }
    setShowEndModal(false);
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowCloseForm(true);
  };

  const confirmKeepOpen = async () => {
    if (!keepOpenReason.trim()) { showToast('Informe o motivo para manter o ticket aberto', 'error'); return; }
    try {
      const isTicket = selected?.type === 'ticket' || selected?.id?.startsWith?.('ticket:');
      const tid = isTicket ? (selected.ticketId || selected.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
      const solution = keepOpenSolution.trim();
      const parts: string[] = ['Atendimento encerrado. Ticket mantido em aberto.'];
      if (solution) parts.push(`Descrição: ${solution}`);
      parts.push(`Motivo: ${keepOpenReason.trim()}`);
      const systemContent = parts.join('\n');
      if (isTicket && tid) {
        await api.addMessage(tid, { content: systemContent, messageType: 'system' });
      } else if (selected?.id && !isTicket) {
        await api.closeConversation(selected.id, { keepTicketOpen: true, solution: solution || undefined });
        if (tid) await api.addMessage(tid, { content: systemContent, messageType: 'system' });
      }
      setShowKeepOpenModal(false);
      setKeepOpenReason('');
      setKeepOpenSolution('');
      showToast('Atendimento encerrado. Ticket mantido aberto.');
      loadConversations(true, true);
      invalidateMyOpenTicketsCount();
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao encerrar', 'error'); }
  };

  const isTicketType = selected?.type === 'ticket' || selected?.id?.startsWith?.('ticket:');

  const confirmCloseTicket = async () => {
    if (customerLinkRequired) {
      showToast(
        canManageCustomerLink
          ? 'Defina a empresa deste atendimento antes de encerrar o ticket.'
          : 'Este atendimento ainda precisa de uma empresa vinculada antes do encerramento.',
        'error',
      );
      return;
    }
    if (!closeForm.solution.trim()) { showToast('Solução aplicada é obrigatória', 'error'); return; }
    const tid = selected?.ticketId || (isTicketType ? selected?.id?.replace?.(/^ticket:/, '') : null);
    try {
      const timeSpentMin = closeForm.timeSpent ? parseInt(closeForm.timeSpent) : 0;
      if (!isTicketType && selected?.id) {
        await api.closeConversation(selected.id, { keepTicketOpen: false, solution: closeForm.solution, rootCause: closeForm.rootCause || undefined, timeSpentMin: timeSpentMin || undefined, internalNote: closeForm.internalNote?.trim() || undefined, complexity: closeForm.complexity || undefined });
      } else if (tid) {
        await api.resolveTicket(tid, { resolutionSummary: closeForm.solution, timeSpentMin, rootCause: closeForm.rootCause || undefined, complexity: closeForm.complexity || undefined });
        if (closeForm.internalNote.trim()) await api.addMessage(tid, { content: closeForm.internalNote, messageType: 'internal' });
        // Ticket permanece como "Resolvido" — cliente tem 7 dias para confirmar no portal
      } else { showToast('Ticket não encontrado', 'error'); return; }
      setShowCloseForm(false);
      showToast('Chamado marcado como resolvido! O cliente será notificado para confirmar.');
      loadConversations(true, true);
      invalidateMyOpenTicketsCount();
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao encerrar', 'error'); }
  };

  // ── assign agent ──
  // ── transfer ──
  const openTransferModal = async () => {
    if (team.length === 0) { try { const r: any = await api.getTeam(); setTeam(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    setTransferAgentId('');
    setShowTransferModal(true);
  };

  const confirmTransfer = async () => {
    const tid = isTicketType ? (selected?.ticketId || selected?.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
    if (!tid || !transferAgentId) { showToast('Selecione um agente', 'error'); return; }
    setTransferLoading(true);
    try {
      await api.assignTicket(tid, transferAgentId);
      const agent = team.find((u: any) => u.id === transferAgentId);
      await api.addMessage(tid, { content: `Atendimento transferido para ${agent?.name || agent?.email || 'outro agente'}.`, messageType: 'system' }).catch(() => {});
      setCurrentTicket((t: any) => ({ ...t, assignedTo: transferAgentId }));
      setShowTransferModal(false);
      showToast('Atendimento transferido!');
      await reloadMessages(selected);
      invalidateMyOpenTicketsCount();
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao transferir', 'error'); }
    setTransferLoading(false);
  };

  // ── start conversation ──
  const openStartModal = () => {
    setStartMode('contact');
    setStartClientId(''); setStartClientName(''); setStartClientInput(''); setStartClientResults([]); setStartClientDropdown(false);
    setStartContactId(''); setStartContacts([]); setStartContactSearch('');
    setStartPhone(''); setStartPhoneResult(null); setStartPhoneChecking(false);
    setStartFirstMessage(''); setStartMsgMode('text'); setStartTemplateName(''); setStartTemplateLang('pt_BR');
    setShowStartModal(true);
    if (metaTemplates.length === 0) {
      setLoadingTemplates(true);
      api.getWhatsappTemplates().then((r: any) => setMetaTemplates(r?.data ?? r ?? [])).catch(() => {}).finally(() => setLoadingTemplates(false));
    }
  };

  const handleClientSearchInput = async (val: string) => {
    setStartClientInput(val);
    setStartClientId('');
    setStartClientName('');
    setStartContactId(''); setStartContacts([]); setStartContactSearch('');
    if (!val.trim()) { setStartClientResults(customers.slice(0, 8)); setStartClientDropdown(true); return; }
    const local = customers.filter((c: any) => (c.tradeName || c.companyName || c.name || '').toLowerCase().includes(val.toLowerCase()));
    setStartClientResults(local.slice(0, 10));
    setStartClientDropdown(true);
    if (val.trim().length >= 2) {
      setStartClientSearching(true);
      try {
        const r: any = await api.searchCustomers(val.trim());
        const apiRes: any[] = r?.data ?? r ?? [];
        const apiIds = new Set(apiRes.map((c: any) => c.id));
        const merged = [...apiRes, ...local.filter((c: any) => !apiIds.has(c.id))].slice(0, 12);
        setStartClientResults(merged);
      } catch {}
      setStartClientSearching(false);
    }
  };

  const handleClientSelect = (c: any) => {
    const name = c.tradeName || c.companyName || c.name || '';
    setStartClientId(c.id);
    setStartClientName(name);
    setStartClientInput(name);
    setStartClientDropdown(false);
    handleStartClientChange(c.id, name);
  };

  const handleStartClientChange = async (clientId: string, clientName: string) => {
    setStartClientId(clientId); setStartClientName(clientName); setStartContactId(''); setStartContactSearch('');
    if (!clientId) { setStartContacts([]); return; }
    setLoadingStartContacts(true);
    try {
      const r: any = await api.getContacts(clientId);
      const list = Array.isArray(r) ? r : r?.data ?? [];
      setStartContacts(list.filter((c: any) => c.whatsapp?.trim() || c.phone?.trim()));
    } catch { setStartContacts([]); }
    setLoadingStartContacts(false);
  };

  const handleCheckPhone = async () => {
    if (!startPhone.trim()) return;
    setStartPhoneChecking(true);
    setStartPhoneResult(null);
    try {
      const r: any = await api.checkWhatsappNumber(startPhone.trim());
      const d = r?.data ?? r;
      setStartPhoneResult({ exists: d.exists, jid: d.jid, normalized: d.normalized });
    } catch { setStartPhoneResult({ exists: false, jid: null, normalized: startPhone }); }
    setStartPhoneChecking(false);
  };

  // Após criar conversa (qualquer modo), recarrega lista e seleciona
  const afterConvCreated = async (conv: any) => {
    setShowStartModal(false); setFilter('all'); setChannelFilter('all');
    const [cl, tc] = await Promise.all([
      api.getConversations({ status: 'active', hasTicket: 'all' }),
      api.getTicketConversations({ status: 'active', perPage: 50 }).catch(() => []),
    ]);
    const ca = Array.isArray(cl) ? cl : (cl as any)?.data ?? [];
    const ta = Array.isArray(tc) ? tc : (tc as any)?.data ?? [];
    const merged = [...ca.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ta]
      .sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
    setConversations(merged);
    setSelected(merged.find((c: any) => sameItem(c, conv)) || conv || null);
  };

  // ── create ticket ──
  const handleCreateTicket = async () => {
    if (!selected?.id) return;
    if (team.length === 0) { try { const r: any = await api.getTeam(); setTeam(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    if (ticketSettingsTree.length === 0) {
      try {
        const r: any = await api.getTicketSettingsTree();
        const depts = Array.isArray(r) ? r : r?.departments ?? r?.data?.departments ?? [];
        setTicketSettingsTree(depts);
      } catch {}
    }
    if (networks.length === 0) { try { const r: any = await api.getNetworks(); setNetworks(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    const contactN = selected.contactName || messages.find((m: any) => m.authorType === 'contact')?.authorName || '';
    const preClientId = selected?.clientId || '';
    const preNetworkId = preClientId ? (customers.find((c: any) => c.id === preClientId)?.networkId || '') : '';
    let currentUserId = '';
    try { const me: any = await api.me(); currentUserId = me?.id ?? me?.data?.id ?? ''; } catch {}
    const medium = tenantPriorities.find((p: any) => p.slug === 'medium');
    const defPri = medium || tenantPriorities[0];
    setCreateForm({
      subject: contactN ? `Atendimento - ${contactN}` : '',
      description: '',
      priority: defPri && ['low', 'medium', 'high', 'critical'].includes(defPri.slug) ? defPri.slug : DEFAULT_PRIORITY,
      priorityId: defPri?.id || '',
      department: '',
      category: '',
      subcategory: '',
      assignedTo: currentUserId,
      networkId: preNetworkId,
      clientId: preClientId,
    });
    if (preNetworkId) {
      setCreateCustomers([]);
      try { const r: any = await api.getCustomers({ networkId: preNetworkId, perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
    } else {
      // No network (e.g. auto-created WhatsApp client): show the full customers list so the pre-selected client is visible
      setCreateCustomers(customers.length > 0 ? customers : []);
      if (customers.length === 0) {
        try { const r: any = await api.getCustomers({ perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
      }
    }
    setCreateClientSearch('');
    // Resolve display name for pre-selected client
    const preClient = preClientId ? customers.find((c: any) => c.id === preClientId) : null;
    setCreateClientName(preClient ? (preClient.tradeName || preClient.companyName || '') : '');
    setCreateClientResults([]);
    setShowCreateClientDropdown(false);
    setShowCreateModal(true);
  };

  const handleStartAttendance = async () => {
    if (!selected || startingAttendanceRef.current) return;
    startingAttendanceRef.current = true;
    setStartingAttendance(true);
    try {
      const res: any = await api.startAttendance(selected.id);
      const ticketId = res?.ticket?.id ?? res?.data?.ticket?.id;
      // Reload conversation to get updated ticketId and SLA data
      const freshConv: any = await api.getConversation(selected.id).catch(() => null);
      const updatedConv = freshConv ? { ...freshConv, ticketId } : { ...selected, ticketId };
      setSelected(updatedConv);
      loadChat(updatedConv);
      await loadConversations(false, true);
      invalidateMyOpenTicketsCount();
      showToast('Atendimento iniciado!');
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Erro ao iniciar atendimento';
      const msgNorm = String(msg).toLowerCase();
      const jaIniciado =
        msgNorm.includes('já iniciado')
        || msgNorm.includes('ja iniciado')
        || msgNorm.includes('já possui ticket')
        || msgNorm.includes('ja possui ticket');

      if (jaIniciado && selected?.id) {
        const freshConv: any = await api.getConversation(selected.id).catch(() => null);
        if (freshConv?.ticketId) {
          setSelected(freshConv);
          loadChat(freshConv);
          await loadConversations(false, true);
          invalidateMyOpenTicketsCount();
          showToast('Esse atendimento já foi iniciado. Atualizei a conversa com o ticket atual.');
        } else {
          showToast(msg, 'error');
        }
      } else {
        showToast(msg, 'error');
      }
    } finally {
      startingAttendanceRef.current = false;
      setStartingAttendance(false);
    }
  };

  const confirmCreateTicket = async () => {
    if (!createForm.subject.trim()) { showToast('Assunto é obrigatório', 'error'); return; }
    if (!createForm.clientId) { showToast('Selecione o cliente', 'error'); return; }
    if (!selected?.id) return;
    setCreateLoading(true);
    try {
      // Only send contactId when the selected client is the same as the conversation's client
      // (if the agent picks a different client, the contact won't belong to that client → 400)
      const contactId = (createForm.clientId && createForm.clientId === selected?.clientId)
        ? selected.contactId
        : undefined;
      const selP = tenantPriorities.find((p: any) => p.id === createForm.priorityId);
      const payload: any = {
        subject: createForm.subject,
        description: createForm.description || undefined,
        department: createForm.department || undefined,
        category: createForm.category || undefined,
        subcategory: createForm.subcategory || undefined,
        assignedTo: createForm.assignedTo || undefined,
        clientId: createForm.clientId,
        contactId,
        conversationId: selected.id,
        origin: selected.channel === 'whatsapp' ? 'whatsapp' : 'portal',
      };
      if (selP) {
        payload.priorityId = selP.id;
        if (['low', 'medium', 'high', 'critical'].includes(selP.slug)) payload.priority = selP.slug;
      } else {
        payload.priority = createForm.priority;
      }
      const res: any = await api.createTicket(payload);
      const ticketId = res?.id ?? res?.data?.id;
      if (ticketId) {
        await api.linkTicketToConversation(selected.id, ticketId).catch(() => {});
        // Re-busca a conversa para obter slaResolutionDeadline e demais campos SLA atualizados pelo backend
        const freshConv: any = await api.getConversation(selected.id).catch(() => null);
        const updatedConv = freshConv ? { ...freshConv, ticketId } : { ...selected, ticketId };
        setSelected(updatedConv);
        await loadConversations(false, true);
        loadChat(updatedConv);
        invalidateMyOpenTicketsCount();
      }
      setShowCreateModal(false);
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao criar ticket', 'error'); }
    setCreateLoading(false);
  };

  // ── link ticket ──
  const handleLinkTicket = (ticketId: string) => { setLinkSelectedId(ticketId); setLinkReason(''); };

  const confirmLinkTicket = async () => {
    if (!linkSelectedId || !selected?.id) return;
    if (!linkReason.trim()) { showToast('Informe o motivo da vinculação', 'error'); return; }
    try {
      await api.linkTicketToConversation(selected.id, linkSelectedId);
      if (linkReason.trim()) await api.addMessage(linkSelectedId, { content: `Conversa vinculada ao ticket. Motivo: ${linkReason}`, messageType: 'system' }).catch(() => {});
      const freshConvLink: any = await api.getConversation(selected.id).catch(() => null);
      const updatedConvLink = freshConvLink ? { ...freshConvLink, ticketId: linkSelectedId } : { ...selected, ticketId: linkSelectedId };
      setSelected(updatedConvLink);
      setShowLinkModal(false); setLinkSelectedId(null); setLinkReason('');
      await loadConversations(false, true);
      loadChat(updatedConvLink);
      invalidateMyOpenTicketsCount();
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao vincular', 'error'); }
  };

  // ── send message ──
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    const file = pendingFile;
    const currentReplyingTo = replyingTo;
    if ((!text && !file) || !selected?.id) return;
    const ticketId = isTicketType ? (selected.ticketId || selected.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
    const channel = selected?.channel || 'whatsapp';
    const isPortalNoTicket = channel === 'portal' && !ticketId && !isTicketType;
    const isConvNoTicket = !isTicketType && !ticketId && !!selected?.id;
    if (!isPortalNoTicket && !isConvNoTicket && !ticketId && !isTicketType) return;

    const whatsappConvId = !isTicketType
      ? selected.id
      : (currentTicket?.conversationId ?? selected?.conversationId ?? null);

    // Mensagem otimista: aparece imediatamente antes da resposta da API
    const tempId = `_opt_${Date.now()}`;
    const previewKind = file
      ? (file.type.startsWith('audio/')
          ? 'audio'
          : file.type === 'video/mp4' || file.type.startsWith('video/mp4;')
            ? 'video'
            : file.type.startsWith('image/')
              ? 'image'
              : 'file')
      : null;
    const localPreviewUrl = file ? URL.createObjectURL(file) : null;
    const agentDisplayName = (user?.name || '').trim() || 'Você';
    setMessages(m => [...m, {
      id: tempId,
      authorType: 'user',
      authorName: agentDisplayName,
      content:
        text ||
        (previewKind === 'image'
          ? '📷 Imagem'
          : previewKind === 'audio'
            ? '🎤 Áudio'
            : previewKind === 'video'
              ? '📹 Vídeo'
              : previewKind === 'file'
                ? '📎 Documento'
                : ''),
      createdAt: new Date().toISOString(),
      whatsappStatus: channel === 'whatsapp' ? 'sending' : null,
      _optimistic: true,
      mediaKind: previewKind,
      hasMedia: !!file,
      _localPreviewUrl: localPreviewUrl,
      replyToId: currentReplyingTo?.id ?? null,
      replyTo: currentReplyingTo ?? null,
    }]);
    setInput('');
    setPendingFile(null);
    setReplyingTo(null);
    if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    setSending(true);

    // Cancela "agente digitando" ao enviar
    if (agentIsTypingRef.current && contacts[0]?.whatsapp && user?.tenantId) {
      agentIsTypingRef.current = false;
      if (agentTypingTimeoutRef.current) { clearTimeout(agentTypingTimeoutRef.current); agentTypingTimeoutRef.current = null; }
      emitTypingPresence(contacts[0].whatsapp, user.tenantId, false);
    }

    try {
      let res: any;
      /** Onde a mensagem foi gravada — para recarregar o histórico certo (ticket_messages vs conversation_messages). */
      let reloadConversationId: string | null = null;
      if (file) {
        const convTarget = !isTicketType
          ? selected.id
          : (currentTicket?.conversationId ?? selected?.conversationId ?? null);
        if (convTarget) {
          reloadConversationId = convTarget;
          res = await api.addConversationMessage(convTarget, { content: text || undefined, file, replyToId: currentReplyingTo?.id ?? null });
        } else if (isTicketType && ticketId && channel === 'whatsapp') {
          res = await api.sendWhatsappMediaFromTicket(ticketId, {
            file,
            content: text || undefined,
            replyToId: currentReplyingTo?.id ?? null,
          });
        } else {
          throw new Error(
            'Conversa não encontrada para enviar ficheiro. Vincule a conversa ao ticket ou use um ticket WhatsApp sem conversa (envio direto).',
          );
        }
      } else if (channel === 'whatsapp' && whatsappConvId) {
        // Texto (e fluxo igual ao anexo): conversa real — dispara outbound WhatsApp. Tem prioridade sobre
        // `addMessage` do ticket, senão a linha "ticket" no inbox só gravava comentário e não enviava ao contato.
        reloadConversationId = whatsappConvId;
        res = await api.addConversationMessage(whatsappConvId, { content: text, replyToId: currentReplyingTo?.id ?? null });
      } else if (channel === 'whatsapp' && ticketId && !whatsappConvId) {
        res = await api.sendWhatsappFromTicket(ticketId, text, currentReplyingTo?.id ?? null);
      } else if (isTicketType && ticketId) {
        res = await api.addMessage(ticketId, { content: text, messageType: 'comment' });
      } else {
        reloadConversationId = selected.id;
        res = await api.addConversationMessage(selected.id, { content: text, replyToId: currentReplyingTo?.id ?? null });
      }

      if (res && typeof res === 'object' && res.success === false) {
        const m = res.message;
        throw new Error(typeof m === 'string' && m.trim() ? m : 'Envio recusado pela API');
      }

      const real = extractSavedMessageFromSendResponse(res);

      if (real?.id) {
        // Mensagens vindas de ticket_messages (send-from-ticket) não têm whatsappStatus; o WA já foi enviado.
        const ticketRow = (real as any).messageType != null;
        const withMedia =
          (real as any).mediaKind && !(real as any).hasMedia
            ? { ...real, hasMedia: true }
            : real;
        const withStatus =
          channel === 'whatsapp' && ticketRow && (withMedia as any).whatsappStatus == null
            ? { ...withMedia, whatsappStatus: 'sent' as const }
            : withMedia;
        // Substitui otimista pelo objeto real em-place — sem flash, sem reload
        setMessages(m => m.map(msg => {
          if (msg.id !== tempId) return msg;
          if (msg._localPreviewUrl) URL.revokeObjectURL(msg._localPreviewUrl);
          const merged: any = { ...withStatus };
          const fromApi = String(merged.authorName ?? merged.author_name ?? '').trim();
          if (merged.authorType === 'user' && !fromApi) merged.authorName = agentDisplayName;
          else merged.authorName = fromApi || merged.authorName || '';
          delete merged.author_name;
          return merged;
        }));
        // Socket também entrega via ticket:message / conversation:message; dedup por ID evita duplicar
      } else {
        // API não retornou objeto (caso raro: ticket sem conversationId ou meta API pura).
        // Aguarda socket substituir o otimista; reload de segurança após 1.5s.
        setTimeout(async () => {
          setMessages(m => {
            if (!m.some((x: any) => x.id === tempId)) return m; // socket já substituiu
            return m.filter((x: any) => x.id !== tempId); // remove otimista pendente
          });
          let fresh: any = null;
          if (reloadConversationId) {
            fresh = await api.getConversationMessages(reloadConversationId, { limit: 200 }).catch(() => null);
          } else if (isTicketType && ticketId) {
            fresh = await api.getMessages(ticketId, false).catch(() => null);
          } else {
            fresh = await api.getConversationMessages(selected.id, { limit: 200 }).catch(() => null);
          }
          if (fresh) {
            const arr: any[] = (fresh as any)?.messages ?? [];
            setMessages(m => m.some((x: any) => x._optimistic) ? m : arr);
          }
        }, 1500);
      }
    } catch (e: any) {
      // Marca mensagem otimista como erro em vez de removê-la
      setMessages(m => m.map(msg => {
        if (msg.id !== tempId) return msg;
        if (msg._localPreviewUrl) URL.revokeObjectURL(msg._localPreviewUrl);
        return { ...msg, whatsappStatus: 'error', _optimistic: false, _localPreviewUrl: undefined };
      }));
      showToast((e as any)?.response?.data?.message || (e as Error)?.message || 'Erro ao enviar', 'error');
    }
    setSending(false);
    inputRef.current?.focus();
  };

  // Insere emoji na posição do cursor no textarea
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setInput(v => v + emoji); return; }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next);
    // Reposiciona cursor após o emoji
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  // ── derived (envio / composer — antes de hooks que usam canSend) ──
  const hasTicket = !!selected?.ticketId || isTicketType;
  const isClosed = selected?.status === 'closed';
  const isWhatsapp = selected?.channel === 'whatsapp';
  const isPortalNoTicket = selected?.channel === 'portal' && !hasTicket && selected?.status !== 'closed';
  const isConvNoTicket = !isTicketType && !hasTicket && !!selected?.id && selected?.status !== 'closed';
  const canSend = hasTicket || isPortalNoTicket || isConvNoTicket;
  const ticketIdForRealtime = isTicketType ? (selected?.ticketId || selected?.id?.replace?.(/^ticket:/, '')) : null;
  const conversationIdForRealtime = !isTicketType ? selected?.id : null;

  /** Mesmo critério do input file: um anexo pendente, validação centralizada. */
  const acceptPendingAttachmentFile = useCallback(
    (f: File): boolean => {
      if (!isAllowedChatAttachmentFile(f)) {
        showToast('Arquivo nao permitido (imagem, audio, video MP4 ou documentos listados).', 'error');
        return false;
      }
      setPendingFile(f);
      if (attachFileInputRef.current) attachFileInputRef.current.value = '';
      return true;
    },
    [],
  );

  const handlePendingFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!acceptPendingAttachmentFile(f)) e.target.value = '';
  };

  /** Ctrl+V / colar: só imagem do clipboard → mesmo fluxo que anexo pendente. */
  const handleComposerPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!canSend || sending || pendingFile) return;
      const file = extractClipboardImageFile(e);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      acceptPendingAttachmentFile(file);
    },
    [acceptPendingAttachmentFile, canSend, pendingFile, sending],
  );

  const handleRecordedAudio = (file: File) => {
    acceptPendingAttachmentFile(file);
  };

  const clearPendingFile = () => {
    setPendingFile(null);
    if (attachFileInputRef.current) attachFileInputRef.current.value = '';
  };

  const handleComposerInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    if (selected?.channel === 'whatsapp' && contacts[0]?.whatsapp && user?.tenantId) {
      if (!agentIsTypingRef.current) {
        agentIsTypingRef.current = true;
        emitTypingPresence(contacts[0].whatsapp, user.tenantId, true);
      }
      if (agentTypingTimeoutRef.current) clearTimeout(agentTypingTimeoutRef.current);
      agentTypingTimeoutRef.current = setTimeout(() => {
        agentIsTypingRef.current = false;
        emitTypingPresence(contacts[0].whatsapp, user.tenantId, false);
      }, 4000);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(e as unknown as React.FormEvent);
    }
  };

  // IDs das mensagens que contêm a query de busca (excluindo internas e de sistema)
  const msgMatchIds: string[] = (() => {
    const q = msgSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m: any) => m.messageType !== 'internal' && String(m.content || '').toLowerCase().includes(q))
      .map((m: any) => m.id);
  })();

  const filteredConversations = conversations.filter(c => {
    // Filtro por tags: conversa precisa ter pelo menos uma das tags selecionadas
    if (filterTags.length > 0) {
      const cTags: string[] = Array.isArray(c.tags) ? c.tags : [];
      const hasTag = filterTags.some(ft =>
        cTags.some(ct => String(ct).toLowerCase() === String(ft).toLowerCase()),
      );
      if (!hasTag) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (c.contactName || customerName(c.clientId) || '').toLowerCase();
    const num = (c.ticketNumber || '').toLowerCase();
    return name.includes(q) || num.includes(q);
  });

  // ── effects ──
  useEffect(() => {
    setChatDensity(readChatDensityFromStorage());
    setChatDensityHydrated(true);
  }, []);

  useEffect(() => {
    if (!chatDensityHydrated) return;
    writeChatDensityToStorage(chatDensity);
  }, [chatDensity, chatDensityHydrated]);

  useEffect(() => {
    try { localStorage.setItem('atend_filter', filter); localStorage.setItem('atend_channel', channelFilter); } catch {}
    loadConversations(true, false);
  }, [filter, channelFilter, loadConversations]);

  useEffect(() => {
    const interval = setInterval(() => loadConversations(false, true), 10_000);
    return () => clearInterval(interval);
  }, [loadConversations]);


  useEffect(() => { if (selected) loadChat(selected); else setMessages([]); }, [selected?.id]);

  useEffect(() => {
    const toRevoke = { ...messageMediaUrlsRef.current };
    setMessageMediaUrls({});
    setReplyingTo(null);
    mediaInFlightRef.current.clear();
    Object.values(toRevoke).forEach((u) => URL.revokeObjectURL(u));
  }, [selected?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sel = selectedRef.current;
      const ticketRow = sel?.type === 'ticket' || sel?.id?.startsWith?.('ticket:');
      const ticketIdForAtt = ticketRow
        ? (sel?.ticketId || sel?.id?.replace?.(/^ticket:/, ''))
        : null;
      for (const m of messages) {
        if (!m?.id || m._optimistic || String(m.id).startsWith('_opt')) continue;
        const ticketFileAtt = Array.isArray(m.attachments)
          ? m.attachments.find((a: any) => a?.kind === 'ticket_reply_file' && a?.id)
          : null;
        const convMedia =
          m.hasMedia ||
          m.mediaKind === 'image' ||
          m.mediaKind === 'audio' ||
          m.mediaKind === 'video' ||
          m.mediaKind === 'file';
        if (!ticketFileAtt && !convMedia) continue;
        if (messageMediaUrlsRef.current[m.id] || mediaInFlightRef.current.has(String(m.id))) continue;
        mediaInFlightRef.current.add(String(m.id));
        try {
          const blob =
            ticketFileAtt && ticketIdForAtt
              ? await api.getTicketReplyAttachmentBlob(ticketIdForAtt, ticketFileAtt.id)
              : await api.getConversationMessageMediaBlob(m.id);
          const url = URL.createObjectURL(blob);
          // Não verifica `cancelled` aqui: o fetch já completou com sucesso.
          // Se a conversa trocou, o effect de selected?.id já limpou messageMediaUrls,
          // então esta atualização é inócua. Verificar cancelled após o await
          // causava race condition onde a mídia ficava em loading infinito.
          setMessageMediaUrls((prev) => {
            if (prev[m.id]) { URL.revokeObjectURL(url); return prev; }
            return { ...prev, [m.id]: url };
          });
        } catch {
          /* ignora — mensagem antiga ou sem ficheiro */
        } finally {
          mediaInFlightRef.current.delete(String(m.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);
  useEffect(() => { api.getTags({ active: true }).then((r: any) => setAvailableTags(r?.data ?? r ?? [])).catch(() => setAvailableTags([])); }, []);
  useEffect(() => {
    api.getRootCauses({ active: true })
      .then((r: any) => setRootCauseOptions((r?.data ?? r ?? []).map((item: any) => item.name).filter(Boolean)))
      .catch(() => setRootCauseOptions([]));
  }, []);
  // Foca o input de busca ao abrir
  useEffect(() => { if (msgSearchOpen) setTimeout(() => msgSearchInputRef.current?.focus(), 50); }, [msgSearchOpen]);
  // Fecha busca ao trocar de conversa
  useEffect(() => { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }, [selected?.id]);
  // Scrolla para o resultado atual
  useEffect(() => {
    if (!msgMatchIds.length) return;
    const safeIdx = Math.min(msgSearchIdx, msgMatchIds.length - 1);
    const el = document.getElementById(`msg-${msgMatchIds[safeIdx]}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [msgSearchIdx, msgMatchIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showTagDropdown) return;
    const handler = (e: MouseEvent) => {
      if (!tagDropdownRef.current?.contains(e.target as Node)) setShowTagDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTagDropdown]);
  useEffect(() => { setConversationTags(Array.isArray(selected?.tags) ? selected.tags : []); }, [selected?.id, selected?.tags]);
  useEffect(() => {
    if (!selected?.clientId) { setClientTickets([]); return; }
    api.getTickets({ clientId: selected.clientId, perPage: 20 })
      .then((r: any) => setClientTickets(r?.data ?? r ?? []))
      .catch(() => setClientTickets([]));
  }, [selected?.clientId]);
  useEffect(() => {
    api.getCustomers({ perPage: 200 })
      .then((r: any) => { const arr = r?.data ?? r ?? []; customersRef.current = arr; setCustomers(arr); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (showLinkModal && (selected?.clientId || selected?.contactId)) searchTicketsForLink(); }, [showLinkModal, selected?.clientId, selected?.contactId, searchTicketsForLink]);
  useEffect(() => {
    if (messages.length === 0) return;
    if (atBottomRef.current) {
      scrollToBottom(true);
    } else {
      // Usuário está lendo o histórico — mostra botão em vez de pular
      const last = messages[messages.length - 1];
      if (last && !last._optimistic) setShowScrollBtn(true);
    }
  }, [messages.length, scrollToBottom]);

  // ── realtime: contato digitando ──
  const contactPhone = contacts[0]?.whatsapp ?? null;
  useRealtimeContactTyping(
    selected?.channel === 'whatsapp' ? contactPhone : null,
    (isTyping) => {
      setIsContactTyping(isTyping);
      // Auto-limpa após 6s caso o backend não envie "paused"
      if (contactTypingTimeoutRef.current) clearTimeout(contactTypingTimeoutRef.current);
      if (isTyping) {
        contactTypingTimeoutRef.current = setTimeout(() => setIsContactTyping(false), 6000);
      }
    },
  );

  // ── realtime ──
  useRealtimeConversation(conversationIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      // 1. Já existe → atualiza em-place (ex: atualização de status)
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      // 2. Mensagem do agente chegou via socket enquanto otimista ainda está na lista
      //    → substitui o primeiro otimista em vez de duplicar
      if (msg.authorType === 'user') {
        const optIdx = m.findIndex((x: any) => x._optimistic === true);
        if (optIdx >= 0) {
          const next = [...m];
          next[optIdx] = { ...msg };
          return next;
        }
      }
      // 3. Mensagem nova do contato (ou sem otimista) → adiciona ao final
      return [...m, msg];
    });
  });

  useRealtimeTicket(ticketIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      if (msg.authorType === 'user') {
        const optIdx = m.findIndex((x: any) => x._optimistic === true);
        if (optIdx >= 0) {
          const next = [...m];
          next[optIdx] = { ...msg };
          return next;
        }
      }
      return [...m, msg];
    });
  });

  const saveConversationTags = async () => {
    if (!selected?.id || isTicketType) return;
    setSavingConversationTags(true);
    try {
      const saved = await api.updateConversationTags(selected.id, conversationTags);
      const savedTags = (saved as { tags?: unknown })?.tags;
      const nextTags = Array.isArray(savedTags) ? savedTags : conversationTags;
      setConversationTags(nextTags);
      setSelected((prev: any) => prev ? { ...prev, tags: nextTags } : prev);
      setConversations((prev: any[]) => prev.map((conv: any) => sameItem(conv, selected) ? { ...conv, tags: nextTags } : conv));
      showToast('Tags da conversa atualizadas');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Erro ao salvar tags da conversa', 'error');
    }
    setSavingConversationTags(false);
  };

  // ── notificações de nova mensagem (conversas não selecionadas) ──
  useRealtimeTenantNewMessages((msg) => {
    const currentSelected = selectedRef.current;
    // Ignora mensagens da conversa atualmente selecionada (já renderizadas em tempo real)
    if (currentSelected && String(currentSelected.id) === String(msg.conversationId)) return;

    // Incrementa badge
    setUnreadCounts(p => ({ ...p, [msg.conversationId]: (p[msg.conversationId] || 0) + 1 }));

    // Sobe conversa para o topo da lista e atualiza prévia.
    // Se a conversa ainda não está na lista (nova entrada via WhatsApp), recarrega silenciosamente.
    // O lado-efeito (loadConversations) fica fora do updater para manter o idioma React correto;
    // o guard reloadPendingRef evita múltiplos requests em caso de burst de mensagens.
    const currentList = conversationsRef.current;
    const idx = currentList.findIndex((c: any) => String(c.id) === String(msg.conversationId));
    if (idx < 0) {
      if (!reloadPendingRef.current) {
        reloadPendingRef.current = true;
        loadConversations(false, true).finally(() => { reloadPendingRef.current = false; });
      }
    } else {
      setConversations(prev => {
        const i = prev.findIndex((c: any) => String(c.id) === String(msg.conversationId));
        if (i < 0) return prev;
        const updated = { ...prev[i], lastMessage: msg.preview, lastMessageAt: new Date().toISOString() };
        return [updated, ...prev.slice(0, i), ...prev.slice(i + 1)];
      });
    }

    // Som de notificação via Web Audio API (sem arquivos externos)
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  });

  // ── ticket transferido em tempo real ──────────────────────────────────────────
  useRealtimeTicketAssigned((payload) => {
    const myId = user?.id;
    if (!myId) return;

    // 1. Ticket foi atribuído a MIM → toast + reload silencioso para aparecer no inbox
    if (String(payload.assignedTo) === String(myId) && String(payload.assignedBy) !== String(myId)) {
      const label = payload.ticketNumber ? `#${payload.ticketNumber}` : 'ticket';
      const byName = payload.assignedByName || 'outro agente';
      showToast(`🎯 ${label} transferido para você por ${byName}`, 'success');
      loadConversations(false, true);
      invalidateMyOpenTicketsCount();
    }

    // 2. Ticket foi tirado de mim (transferido para outro) → atualiza silenciosamente
    if (String(payload.prevAssignedTo) === String(myId) && String(payload.assignedTo) !== String(myId)) {
      loadConversations(false, true);
      invalidateMyOpenTicketsCount();
    }
  });

  // ── conversa fechada remotamente (ticket resolvido/encerrado por outro agente ou pela própria ação) ──
  useRealtimeConversationClosed((conversationId) => {
    const currentSelected = selectedRef.current;
    // Remove da lista de conversas ativas
    setConversations(prev => prev.filter((c: any) => String(c.id) !== String(conversationId)));
    // Se era a conversa selecionada, limpa a seleção
    if (currentSelected && String(currentSelected.id) === String(conversationId)) {
      setSelected(null);
      setMessages([]);
    }
    // Remove badge de não lidas
    setUnreadCounts(p => { const next = { ...p }; delete next[conversationId]; return next; });
    invalidateMyOpenTicketsCount();
  });

  // ── styles (shared) ──
  const selectedAttendanceMetrics = selected ? getConversationMetrics(selected) : null;
  const selectedResolvedContact = selected ? contacts.find((c: any) => c.id === selected.contactId) || null : null;
  const selectedDisplayName = selected
    ? (contactName(selected.contactId) !== '—'
      ? contactName(selected.contactId)
      : messages.find((m: any) => m.authorType === 'contact')?.authorName || selected.contactName || '—')
    : '—';

  const S = {
    border: '1px solid rgba(15,23,42,.08)',
    border2: '1px solid rgba(15,23,42,.12)',
    txt: '#0F172A',
    txt2: '#475569',
    txt3: '#94A3B8',
    bg: '#FFFFFF',
    bg2: '#F8FAFC',
    bg3: '#EEF2FF',
    accent: '#1D4ED8',
    accentLight: '#DBEAFE',
    accentMid: '#93C5FD',
    panel: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
    chatBg: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)',
    shadow: '0 18px 45px rgba(15,23,42,.08)',
    shadowSoft: '0 10px 24px rgba(15,23,42,.06)',
  } as const;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>

      {/* ── Main layout ── */}
      <div style={{ margin: 0, height: 'calc(100vh - 44px)', display: 'flex', overflow: 'hidden', background: 'linear-gradient(135deg, #E0E7FF 0%, #F8FAFC 45%, #FEF3C7 100%)' }}>

        {/* ══════════ CONVERSATION LIST (310px) ══════════ */}
        <div style={{ width: 326, background: S.panel, borderRight: S.border, display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: S.shadowSoft, backdropFilter: 'blur(18px)' }}>

          {/* Header */}
          <div style={{ padding: '18px 16px 14px', borderBottom: S.border, flexShrink: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(241,245,249,0.92) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <span style={{ display: 'block', fontSize: 17, fontWeight: 800, color: S.txt, letterSpacing: '-0.02em' }}>Atendimento</span>
                <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: S.txt2 }}>Inbox unificado com contexto de conversa, ticket e empresa</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={openStartModal} title="Nova conversa"
                  style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${S.accentMid}`, background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px rgba(29,78,216,.12)' }}>
                  <Plus size={15} color={S.accent} strokeWidth={1.9} />
                </button>
                <button onClick={() => loadConversations(false, true)} title="Atualizar"
                  style={{ width: 34, height: 34, borderRadius: 10, border: S.border2, background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RefreshCw size={14} color={S.txt2} strokeWidth={1.6} />
                </button>
              </div>
            </div>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.9)', border: S.border, borderRadius: 12, padding: '9px 12px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7)' }}>
              <Search size={13} color={S.txt3} strokeWidth={1.6} style={{ flexShrink: 0 }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar conversa..."
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, color: S.txt, width: '100%', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          {/* Channel tabs */}
          <div style={{ display: 'flex', gap: 4, padding: '12px 12px 10px', borderBottom: S.border, flexShrink: 0, background: 'rgba(248,250,252,.85)' }}>
            {([['all','Todos'],['whatsapp','WhatsApp']] as const).map(([ch, label]) => (
              <button key={ch} onClick={() => { setChannelFilter(ch); if (filter === 'no_ticket') setFilter('all'); }}
                style={{
                  padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  color: channelFilter === ch && filter !== 'no_ticket' ? S.accent : S.txt2,
                  background: channelFilter === ch && filter !== 'no_ticket' ? S.accentLight : 'transparent', border: 'none',
                  whiteSpace: 'nowrap', transition: 'all .15s', fontFamily: 'inherit',
                }}>
                {label}
              </button>
            ))}
            <button onClick={() => { setFilter('no_ticket'); setChannelFilter('all'); }}
              style={{
                padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                color: filter === 'no_ticket' ? S.accent : S.txt2,
                background: filter === 'no_ticket' ? S.accentLight : 'transparent', border: 'none',
                whiteSpace: 'nowrap', transition: 'all .15s', fontFamily: 'inherit',
              }}>
              Sem ticket
            </button>
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: S.border, flexShrink: 0, background: 'rgba(255,255,255,.78)' }}>
            {([['all','Em aberto'],['closed','Encerradas'],['linked','Vinculadas']] as const).map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  color: filter === f ? S.accent : S.txt2,
                  background: filter === f ? S.accentLight : 'transparent',
                  border: `1px solid ${filter === f ? S.accentMid : 'rgba(0,0,0,.12)'}`,
                  transition: 'all .12s', fontFamily: 'inherit',
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Tag filter removido */}
          {false && (
            <div ref={tagDropdownRef} style={{ padding: '8px 12px 10px', borderBottom: S.border, flexShrink: 0, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {/* Botão abre/fecha dropdown */}
                <button
                  onClick={() => setShowTagDropdown(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px',
                    borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    background: filterTags.length > 0 ? S.accentLight : 'transparent',
                    color: filterTags.length > 0 ? S.accent : S.txt2,
                    border: `1px solid ${filterTags.length > 0 ? S.accentMid : 'rgba(0,0,0,.12)'}`,
                    transition: 'all .12s',
                  }}
                >
                  <Tag size={11} strokeWidth={1.8} />
                  {filterTags.length > 0 ? `Tags (${filterTags.length})` : 'Tags'}
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: showTagDropdown ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M2 3.5l3 3 3-3"/></svg>
                </button>
                {/* Chips das tags selecionadas */}
                {filterTags.map(tagName => {
                  const t = availableTags.find((x: any) => String(x.name).toLowerCase() === String(tagName).toLowerCase());
                  return (
                    <span key={tagName} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px',
                      borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1,
                      background: t?.color ? `${t.color}18` : S.accentLight,
                      color: t?.color || S.accent,
                      border: `1px solid ${t?.color ? `${t.color}35` : S.accentMid}`,
                    }}>
                      {tagName}
                      <button onClick={() => setFilterTags(prev => prev.filter(x => x !== tagName))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'inherit', opacity: 0.7 }}>
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
                {filterTags.length > 0 && (
                  <button onClick={() => setFilterTags([])}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 10, color: S.txt3, fontFamily: 'inherit' }}>
                    limpar
                  </button>
                )}
              </div>

              {/* Dropdown de seleção de tags */}
              {showTagDropdown && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 2px)', left: 12, right: 12, zIndex: 50,
                  background: '#fff', border: S.border2, borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden',
                }}>
                  <div style={{ maxHeight: 220, overflowY: 'auto', padding: '6px 6px' }}>
                    {availableTags.map((tag: any) => {
                      const active = filterTags.some(ft => String(ft).toLowerCase() === String(tag.name).toLowerCase());
                      return (
                        <button key={tag.id || tag.name}
                          onClick={() => {
                            setFilterTags(prev =>
                              active ? prev.filter(x => String(x).toLowerCase() !== String(tag.name).toLowerCase()) : [...prev, tag.name],
                            );
                          }}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            background: active ? S.accentLight : 'transparent', gap: 10, textAlign: 'left',
                          }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color || S.accent, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 500, color: S.txt }}>{tag.name}</span>
                          </span>
                          {active && <Check size={13} color={tag.color || S.accent} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 12px' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: S.txt3, fontSize: 13 }}>
                <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" style={{ margin: '0 auto 10px' }} />
                Carregando...
              </div>
            ) : filteredConversations.length === 0 ? (
              <div style={{ padding: 36, textAlign: 'center', color: S.txt3, fontSize: 13, background: 'rgba(255,255,255,.68)', border: S.border, borderRadius: 18, boxShadow: S.shadowSoft }}>
                <div style={{ width: 56, height: 56, margin: '0 auto 14px', borderRadius: 18, background: 'linear-gradient(135deg, #DBEAFE, #E0E7FF)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageSquare style={{ width: 26, height: 26, opacity: 0.75, color: S.accent }} />
                </div>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {filter === 'no_ticket' ? 'Nenhuma sem ticket' : filter === 'linked' ? 'Nenhuma vinculada' : filter === 'closed' ? 'Nenhuma encerrada' : 'Nenhuma conversa ativa'}
                </p>
                {filter !== 'closed' && (
                  <button onClick={openStartModal} style={{ marginTop: 14, padding: '7px 14px', borderRadius: 8, border: 'none', background: S.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                    <Plus size={12} /> Nova conversa
                  </button>
                )}
              </div>
            ) : (() => {
              const open = filteredConversations.filter((c: any) => c.status !== 'closed');
              const closed = filteredConversations.filter((c: any) => c.status === 'closed');
              const renderItem = (c: any) => {
                const isSelected = sameItem(c, selected);
                const noTicket = !c.ticketId;
                const isClo = c.status === 'closed';
                const ch = c.channel || 'whatsapp';
                const dispName = c.contactName || customerName(c.clientId) || '—';
                const compName = c.clientName || (c.contactName ? customerName(c.clientId) : null) || (customerName(c.clientId) !== '—' ? customerName(c.clientId) : null);
                const col = avatarColor(dispName);
                return (
                  <button key={c.id} onClick={() => { setSelected(c); if (c?.id) setUnreadCounts(p => { const n = { ...p }; delete n[c.id]; return n; }); }}
                    style={{
                      width: '100%', padding: 12, borderRadius: 16, border: isSelected ? `1px solid ${S.accentMid}` : '1px solid rgba(255,255,255,.35)',
                      background: isSelected ? 'linear-gradient(135deg, #EFF6FF, #FFFFFF)' : 'rgba(255,255,255,.72)',
                      cursor: 'pointer', textAlign: 'left', transition: 'background .1s',
                      display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, fontFamily: 'inherit',
                      boxShadow: isSelected ? '0 12px 28px rgba(29,78,216,.10)' : '0 6px 20px rgba(15,23,42,.04)',
                    }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 14, background: isClo ? '#E2E8F0' : col, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                        {dispName !== '—' ? initials(dispName) : <MessageSquare size={14} />}
                      </div>
                      <ChannelDot channel={ch} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isClo ? S.txt3 : S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {dispName}
                        </span>
                        <span style={{ fontSize: 10, color: S.txt3, flexShrink: 0, paddingTop: 1 }}>{timeAgo(c.lastMessageAt || c.createdAt)}</span>
                      </div>
                      {c.lastMessage && (
                        <p style={{ fontSize: 12, color: S.txt2, margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                          {c.lastMessage}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        {!noTicket && c.ticketNumber && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#EEF2FF', color: '#4338CA' }}>{c.ticketNumber}</span>
                        )}
                        {compName && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#F0FDF4', color: '#166534' }}>{compName}</span>
                        )}
                        {c.escalated && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: '#FEF2F2', color: '#DC2626' }}>● Urgente</span>
                        )}
                        {(() => {
                          if (!noTicket) return null;
                          const metrics = getConversationMetrics(c);
                          if (!metrics.queuedAt || metrics.attendanceStartedAt) return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 700, background: '#F8FAFC', color: '#64748B' }}>Sem ticket</span>;
                          const waitingMs = Math.max(0, Date.now() - new Date(metrics.queuedAt).getTime());
                          const highWait = waitingMs >= 60 * 60000;
                          const atRisk = !highWait && waitingMs >= 15 * 60000;
                          const compactLabel = formatDurationLabel(waitingMs);
                          return <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 700, background: highWait ? '#FEF2F2' : atRisk ? '#FFF7ED' : '#F0FDF4', color: highWait ? '#DC2626' : atRisk ? '#C2410C' : '#15803D' }}>
                            {highWait ? 'Fila' : atRisk ? 'Espera' : 'Novo'} {compactLabel}
                          </span>;
                        })()}
                      </div>
                    </div>
                  </button>
                );
              };
              return (
                <>
                  {open.length > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 8px 4px', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Em aberto</span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: S.txt3, background: S.bg2, borderRadius: 10, padding: '1px 7px' }}>{open.length}</span>
                      </div>
                      {open.map(renderItem)}
                    </>
                  )}
                  {closed.length > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 8px 4px', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Encerradas hoje</span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: S.txt3, background: S.bg2, borderRadius: 10, padding: '1px 7px' }}>{closed.length}</span>
                      </div>
                      {closed.map(renderItem)}
                    </>
                  )}
                </>
              );
            })()}

          </div>
        </div>

        {/* CHAT AREA (flex-1) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: S.chatBg, minWidth: 0 }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: S.txt3 }}>
              <div style={{ width: 76, height: 76, borderRadius: 24, background: 'linear-gradient(135deg, #DBEAFE, #FEF3C7)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: S.shadow }}>
                <MessageSquare size={34} strokeWidth={1.5} style={{ opacity: 0.85, color: S.accent }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: S.txt2, margin: 0 }}>Selecione uma conversa</p>
                <p style={{ fontSize: 13, color: S.txt3, margin: '6px 0 0' }}>O painel central vai mostrar histórico, ticket e contexto da empresa do atendimento.</p>
              </div>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', padding: '18px 22px 16px', borderBottom: S.border, background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.95) 100%)', flexShrink: 0, boxShadow: '0 8px 22px rgba(15,23,42,.04)' }}>
                {loadingChat && (
                  <div className="animate-pulse" style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, ${S.accent} 0%, #818CF8 60%, ${S.accent} 100%)`,
                    backgroundSize: '200% 100%',
                  }} />
                )}

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: S.txt, letterSpacing: '-0.02em', minWidth: 0 }}>
                        {selectedDisplayName}
                      </div>
                      {hasTicket && (
                        <button
                          type="button"
                          onClick={openTicketPanelAndScroll}
                          title="Ver ticket no painel à direita (sem sair do atendimento)"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            border: S.border2,
                            background: S.bg2,
                            color: S.accent,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          <Ticket size={16} strokeWidth={1.9} />
                        </button>
                      )}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999, background: isWhatsapp ? '#DCFCE7' : '#EEF2FF', color: isWhatsapp ? '#15803D' : S.accent }}>
                        {isWhatsapp ? <Phone size={10} /> : <Globe size={10} />}
                        {isWhatsapp ? 'WhatsApp' : 'Portal'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: S.txt2, display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span>{customerName(selected.clientId)}</span>
                      {selectedResolvedContact?.whatsapp && isWhatsapp && (
                        <>
                          <span style={{ color: S.txt3 }}>•</span>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{formatWhatsApp(selectedResolvedContact.whatsapp)}</span>
                        </>
                      )}
                    </div>
                    {selected.lastMessageAt && (
                      <div style={{ fontSize: 11, color: S.txt3, marginTop: 6 }}>
                        Visto {timeAgo(selected.lastMessageAt)} atrás
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <ChatDensityToggle value={chatDensity} onChange={setChatDensity} />
                    <button
                      onClick={() => { setMsgSearchOpen(v => !v); if (msgSearchOpen) { setMsgSearchQuery(''); setMsgSearchIdx(0); } }}
                      title="Buscar na conversa (Ctrl+F)"
                      style={{ width: 30, height: 30, borderRadius: 8, border: S.border2, background: msgSearchOpen ? S.accentLight : S.bg2, color: msgSearchOpen ? S.accent : S.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Search size={14} strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => { const next = !panelOpen; setPanelOpen(next); try { localStorage.setItem('atend_panel_open', String(next)); } catch {} }}
                      title={panelOpen ? 'Fechar painel de contato' : 'Abrir painel de contato'}
                      style={{ width: 30, height: 30, borderRadius: 8, border: S.border2, background: panelOpen ? S.accentLight : S.bg2, color: panelOpen ? S.accent : S.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {panelOpen ? <ChevronRight size={14} strokeWidth={1.8} /> : <ChevronLeft size={14} strokeWidth={1.8} />}
                    </button>
                    {!hasTicket && !isPortalNoTicket && (
                      <button onClick={handleCreateTicket} disabled={creatingTicket}
                        style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: `linear-gradient(135deg, ${S.accent}, #3B82F6)`, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', boxShadow: '0 10px 20px rgba(29,78,216,.18)' }}>
                        <Plus size={13} /> Criar Ticket
                      </button>
                    )}
                    {!hasTicket && (
                      <button onClick={() => { setShowLinkModal(true); setLinkTicketSearch(''); setLinkTickets([]); }}
                        style={{ padding: '7px 14px', borderRadius: 999, border: S.border2, background: '#FFFFFF', color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                        <Link2 size={13} /> Vincular ticket
                      </button>
                    )}
                    <button onClick={openTransferModal}
                      style={{ padding: '7px 14px', borderRadius: 999, border: S.border2, background: '#FFFFFF', color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                      Transferir
                    </button>
                    {!isClosed && (hasTicket || isPortalNoTicket) && (
                      <button onClick={openEndFlow} disabled={!canCloseTicket || customerLinkRequired}
                        title={customerLinkRequired ? 'Defina a empresa antes de encerrar' : undefined}
                        style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid #FECACA', background: customerLinkRequired ? '#FFF1F2' : '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 700, cursor: (!canCloseTicket || customerLinkRequired) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', opacity: (!canCloseTicket || customerLinkRequired) ? 0.6 : 1 }}>
                        Encerrar
                      </button>
                    )}
                  </div>
                </div>

                {(hasTicket || selectedAttendanceMetrics?.firstReplyMs != null) && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: '1px solid rgba(15,23,42,.07)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {hasTicket && !panelOpen && (
                      <button
                        type="button"
                        onClick={openTicketPanelAndScroll}
                        title="Ver ticket no painel lateral"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 11px',
                          borderRadius: 999,
                          background: S.accentLight,
                          border: `1px solid ${S.accentMid}`,
                          color: S.accent,
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: "'DM Mono', monospace",
                          cursor: 'pointer',
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/></svg>
                        {currentTicket?.ticketNumber ?? selected?.ticketNumber ?? '—'}
                      </button>
                    )}
                    {selectedAttendanceMetrics?.firstReplyMs != null && (
                      <span
                        style={{
                          fontSize: 11,
                          color: '#475569',
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: 'rgba(248,250,252,0.95)',
                          border: S.border2,
                          fontWeight: 500,
                        }}
                      >
                        Tempo até a primeira resposta: {formatDurationLabel(selectedAttendanceMetrics.firstReplyMs)}
                      </span>
                    )}
                  </div>
                )}

                {!hasTicket && !isPortalNoTicket && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                    Sem ticket vinculado. Você ainda pode conversar normalmente e vincular o ticket depois, se necessário.
                  </div>
                )}

                {currentTicket?.id && (
                  <ContactValidationBanner
                    key={currentTicket.id}
                    ticketId={currentTicket.id}
                    initialCustomerSelectedAt={currentTicket.customerSelectedAt ?? null}
                    initialUnlinkedContact={currentTicket.unlinkedContact ?? false}
                    canManageCustomerLink={canManageCustomerLink}
                    initialCustomerName={customerName(selected?.clientId) !== '—' ? customerName(selected?.clientId) : null}
                    onResolved={(data: ResolvedData) => {
                      setCurrentTicket((prev: any) => prev ? { ...prev, ...data } : prev);
                    }}
                    onRequirementChange={setCustomerLinkRequired}
                  />
                )}
              </div>

              {/* Barra de busca dentro da conversa */}
              {msgSearchOpen && (
                <div style={{ padding: '8px 16px', borderBottom: S.border, background: S.bg, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Search size={13} color={S.txt3} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                  <input
                    ref={msgSearchInputRef}
                    value={msgSearchQuery}
                    onChange={e => { setMsgSearchQuery(e.target.value); setMsgSearchIdx(0); }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }
                      else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (msgMatchIds.length > 0) setMsgSearchIdx(i => e.shiftKey ? (i - 1 + msgMatchIds.length) % msgMatchIds.length : (i + 1) % msgMatchIds.length);
                      }
                    }}
                    placeholder="Buscar na conversa..."
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: S.txt, fontFamily: 'inherit' }}
                  />
                  {msgSearchQuery.trim() && (
                    <span style={{ fontSize: 11, color: S.txt3, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {msgMatchIds.length > 0 ? `${Math.min(msgSearchIdx + 1, msgMatchIds.length)} de ${msgMatchIds.length}` : 'Sem resultados'}
                    </span>
                  )}
                  <button
                    onClick={() => { if (msgMatchIds.length > 0) setMsgSearchIdx(i => (i - 1 + msgMatchIds.length) % msgMatchIds.length); }}
                    disabled={msgMatchIds.length === 0}
                    title="Resultado anterior (Shift+Enter)"
                    style={{ background: 'none', border: S.border2, borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: msgMatchIds.length > 0 ? 'pointer' : 'default', opacity: msgMatchIds.length > 0 ? 1 : 0.35 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke={S.txt2} strokeWidth="1.6"><path d="M2 6.5l3-3 3 3"/></svg>
                  </button>
                  <button
                    onClick={() => { if (msgMatchIds.length > 0) setMsgSearchIdx(i => (i + 1) % msgMatchIds.length); }}
                    disabled={msgMatchIds.length === 0}
                    title="Próximo resultado (Enter)"
                    style={{ background: 'none', border: S.border2, borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: msgMatchIds.length > 0 ? 'pointer' : 'default', opacity: msgMatchIds.length > 0 ? 1 : 0.35 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke={S.txt2} strokeWidth="1.6"><path d="M2 3.5l3 3 3-3"/></svg>
                  </button>
                  <button
                    onClick={() => { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }}
                    title="Fechar busca (Esc)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: S.txt3, display: 'flex', alignItems: 'center' }}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Messages — wrapper com position:relative para o botão flutuante */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: S.bg2 }}>
                <ConversationMessageList
                  scrollContainerRef={scrollContainerRef}
                  messagesEndRef={messagesEndRef}
                  onScroll={handleScroll}
                  containerStyle={{
                    height: '100%',
                    overflowY: 'auto',
                    padding: '10px 12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0,
                  }}
                  theme={{
                    border2: S.border2,
                    txt3: S.txt3,
                  }}
                  messages={messages}
                  loadingChat={loadingChat}
                  loadingMoreMsgs={loadingMoreMsgs}
                  hasMoreMsgs={hasMoreMsgs}
                  onLoadMore={loadMoreMessages}
                  messageMediaUrls={messageMediaUrls}
                  isWhatsapp={isWhatsapp}
                  msgSearchQuery={msgSearchQuery}
                  msgSearchIdx={msgSearchIdx}
                  msgMatchIds={msgMatchIds}
                  onReply={setReplyingTo}
                  isContactTyping={isContactTyping}
                  typingContactName={selected?.contactName}
                  chatDensity={chatDensity}
                />

                {/* Botão flutuante: nova mensagem enquanto usuário lê histórico */}
                {showScrollBtn && (
                  <button
                    onClick={() => scrollToBottom(true)}
                    style={{
                      position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                      background: S.accent, color: '#fff', border: 'none', borderRadius: 20,
                      padding: '7px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                      boxShadow: '0 4px 14px rgba(79,70,229,.45)', zIndex: 10,
                      fontFamily: 'inherit', transition: 'opacity .15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                    Nova mensagem
                  </button>
                )}
              </div>

              {/* Input */}
              {!isClosed && selected && !selected.ticketId && selected.channel === 'whatsapp' ? (
                <div style={{ padding: '20px 24px 24px', borderTop: '1px solid rgba(0,0,0,0.07)', background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)', flexShrink: 0 }}>
                  <div style={{ maxWidth: 720, margin: '0 auto', borderRadius: 20, border: '1px solid #E2E8F0', background: 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))', boxShadow: '0 18px 40px rgba(15,23,42,0.08)', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, width: '100%' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg, #DBEAFE, #E0E7FF)', color: '#4338CA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <MessageSquare size={20} strokeWidth={1.9} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0F172A' }}>Atendimento aguardando inicio</h3>
                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#64748B' }}>
                          O chat ja entrou na fila, mas ainda nao foi assumido por um agente. Inicie o atendimento para criar o ticket, registrar o inicio e liberar o envio da primeira mensagem.
                        </p>
                      </div>
                    </div>
                    <ConvWaitMetricsInfo conv={selected} />
                    <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
                      <span style={{ fontSize: 12, color: '#64748B', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 999, padding: '8px 12px' }}>
                        Depois do inicio, a tela passa a medir primeira resposta e duracao do atendimento.
                      </span>
                      <button
                        onClick={handleStartAttendance}
                        disabled={startingAttendance}
                        style={{ background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 20px', minWidth: 220, fontSize: 14, fontWeight: 700, cursor: startingAttendance ? 'not-allowed' : 'pointer', opacity: startingAttendance ? 0.7 : 1, fontFamily: 'inherit', boxShadow: '0 10px 24px rgba(79,70,229,0.28)' }}
                      >
                        {startingAttendance ? 'Iniciando atendimento...' : 'Iniciar atendimento'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : !isClosed && (
                  <ChatComposer
                    accentColor={S.accent}
                    borderColor={S.border}
                    backgroundColor={S.bg}
                    inputBackgroundColor={S.bg2}
                    textColor={S.txt}
                    mutedTextColor={S.txt2}
                    canSend={canSend}
                    isSending={sending}
                    isWhatsapp={isWhatsapp}
                    conversationScopeKey={selected?.id || currentTicket?.id || 'no-conversation'}
                    inputValue={input}
                    pendingFile={pendingFile}
                    attachFileInputRef={attachFileInputRef}
                    inputRef={inputRef}
                    onSubmit={sendMessage}
                    onInputChange={handleComposerInputChange}
                    onInputKeyDown={handleComposerKeyDown}
                    onComposerPaste={handleComposerPaste}
                    onPendingFileChange={handlePendingFileChange}
                    onRecordedAudio={handleRecordedAudio}
                    onRemovePendingFile={clearPendingFile}
                    onInsertEmoji={insertEmoji}
                    replyingTo={replyingTo}
                    onCancelReply={() => setReplyingTo(null)}
                  />
              )}
              {isClosed && (
                <div style={{ borderTop: S.border, background: S.bg2, padding: '12px 20px', flexShrink: 0, textAlign: 'center', fontSize: 12, color: S.txt3 }}>
                  Esta conversa está encerrada
                </div>
              )}
            </>
          )}
        </div>

        {/* ══════════ CLIENT PANEL (290px, colapsável) ══════════ */}
        <div style={{ width: panelOpen ? 308 : 0, borderLeft: panelOpen ? S.border : 'none', background: S.bg, display: 'flex', flexDirection: 'column', overflow: panelOpen ? 'auto' : 'hidden', flexShrink: 0, transition: 'width .2s ease' }}>
          {selected ? (() => {
            const customer = customers.find((c: any) => c.id === selected?.clientId);
            const contact = contacts.find((c: any) => c.id === (selected?.contactId || currentTicket?.contactId)) || null;
            // Usa assignedUser embutido no ticket (retornado pelo backend) ou faz fallback na lista de equipe
            const assignedUser = currentTicket?.assignedUser
              || team.find((u: any) => String(u.id) === String(currentTicket?.assignedTo));
            // SLA calc — ticket
            const slaInfo = (() => {
              if (!currentTicket?.slaResolveAt || ['resolved','closed','cancelled'].includes(currentTicket?.status)) return null;
              const diff = new Date(currentTicket.slaResolveAt).getTime() - Date.now();
              if (diff < 0) return { violated: true, label: 'VIOLADO', pct: 100 };
              const h = Math.floor(diff / 3600000);
              const m = Math.floor((diff % 3600000) / 60000);
              const total = new Date(currentTicket.slaResolveAt).getTime() - new Date(currentTicket.createdAt || Date.now()).getTime();
              const pct = Math.max(0, Math.min(100, 100 - (diff / Math.max(total, 1)) * 100));
              return { violated: false, label: h > 0 ? `${h}h ${m}m restantes` : `${m}m restantes`, pct };
            })();
            const attendanceMetrics = getConversationMetrics(selected);
            // Client stats from clientTickets
            const total = clientTickets.length;
            const resolved = clientTickets.filter((t: any) => ['resolved','closed'].includes(t.status)).length;
            const resRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
            const urgent = clientTickets.filter(
              (t: any) => isTicketCriticalUrgent(t) && !['closed', 'resolved', 'cancelled'].includes(t.status),
            ).length;
            const recentTickets = [...clientTickets].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4);
            const secTitle = (txt: string, action?: React.ReactNode) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.07em' }}>{txt}</span>
                {action}
              </div>
            );
            const field = (label: string, value: React.ReactNode) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0', gap: 8 }}>
                <span style={{ fontSize: 11, color: S.txt2, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 11, color: S.txt, fontWeight: 500, textAlign: 'right' as const }}>{value}</span>
              </div>
            );
            const dispName = contactName(selected.contactId) !== '—' ? contactName(selected.contactId) : selected.contactName || '—';
            const ticketSt = currentTicket ? (TICKET_STATUS_PANEL[currentTicket.status] || TICKET_STATUS_PANEL.open) : null;
            const ticketPri = currentTicket ? getTicketPriorityDisplay(currentTicket) : null;
            const ticketServiceLine = currentTicket
              ? [currentTicket.department, currentTicket.category, currentTicket.subcategory].filter(Boolean).join(' › ') || '—'
              : '—';
            const panelStatusSelectValue = TICKET_STATUS_SELECT_OPTIONS.some((o) => o.value === ticketPanelStatusDraft)
              ? ticketPanelStatusDraft
              : String(currentTicket?.status || 'open');
            const panelSelDeptEdit = ticketSettingsTree.find((d: any) => d.name === ticketPanelDeptDraft);
            const panelCatsEdit = panelSelDeptEdit?.categories || [];
            const panelSelCatEdit = panelCatsEdit.find((c: any) => c.name === ticketPanelCatDraft);
            const panelSubsEdit = panelSelCatEdit?.subcategories || [];
            const panelPrioritySelectValue = tenantPriorities.some((p: any) => p.id === ticketPanelPriorityIdDraft)
              ? ticketPanelPriorityIdDraft
              : String(currentTicket?.priorityId || tenantPriorities[0]?.id || '');
            const ticketPanelClassDirty =
              String(ticketPanelDeptDraft).trim() !== String(currentTicket?.department ?? '').trim() ||
              String(ticketPanelCatDraft).trim() !== String(currentTicket?.category ?? '').trim() ||
              String(ticketPanelSubDraft).trim() !== String(currentTicket?.subcategory ?? '').trim();
            const panelSelectCompact = {
              width: '100%',
              padding: '8px 10px',
              borderRadius: 8,
              border: S.border2,
              background: '#FFFFFF',
              fontSize: 12,
              color: S.txt,
              fontFamily: 'inherit',
            } as const;
            return (
              <>
                {currentTicket && (
                  <div
                    ref={ticketPanelRef}
                    style={{
                      padding: '10px 14px',
                      borderBottom: S.border,
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.97) 100%)',
                    }}
                  >
                    {/* ── Resumo compacto (sempre visível) ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <Ticket size={13} strokeWidth={1.8} style={{ color: S.txt3, flexShrink: 0 }} />
                      <button
                        type="button"
                        onClick={openTicketPanelAndScroll}
                        title="Destacar no painel"
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 12,
                          fontWeight: 700,
                          color: S.accent,
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          flexShrink: 0,
                          lineHeight: 1,
                        }}
                      >
                        {currentTicket.ticketNumber ?? '—'}
                      </button>
                      {ticketSt && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 999,
                            background: ticketSt.bg,
                            color: ticketSt.color,
                            border: `1px solid ${ticketSt.dot}22`,
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: ticketSt.dot }} />
                          {ticketSt.label}
                        </span>
                      )}
                      <span style={{ ...ticketPriorityChipStyle(currentTicket), flexShrink: 0 }}>
                        {(ticketPri ?? getTicketPriorityDisplay(currentTicket)).label}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => { const next = !panelOpen; setPanelOpen(next); try { localStorage.setItem('atend_panel_open', String(next)); } catch {} }}
                        title={panelOpen ? 'Fechar painel' : 'Abrir painel'}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: S.border2,
                          background: S.bg2,
                          color: S.txt2,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <ChevronRight size={13} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTicketInfoExpanded((v) => !v)}
                        title={ticketInfoExpanded ? 'Recolher informações' : 'Expandir informações'}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: S.border2,
                          background: ticketInfoExpanded ? S.accentLight : S.bg2,
                          color: ticketInfoExpanded ? S.accent : S.txt2,
                          cursor: 'pointer',
                          transition: 'background .15s, color .15s',
                          flexShrink: 0,
                        }}
                      >
                        <ChevronDown
                          size={13}
                          strokeWidth={2}
                          style={{ transition: 'transform .2s', transform: ticketInfoExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                      </button>
                    </div>

                    {ticketInfoExpanded && (<>
                      <div style={{ height: 1, background: 'rgba(15,23,42,.07)', margin: '10px -14px 10px' }} />

                      {/* 1. Assunto — título do ticket */}
                      {canEditTicketPanelContent ? (
                        <div style={{ marginBottom: 8 }}>
                          <label
                            htmlFor="atend-ticket-subject"
                            style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}
                          >
                            Assunto
                          </label>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                            <input
                              id="atend-ticket-subject"
                              value={ticketPanelSubjectDraft}
                              onChange={(ev) => setTicketPanelSubjectDraft(ev.target.value)}
                              maxLength={160}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '8px 10px',
                                borderRadius: 8,
                                border: S.border2,
                                background: '#FFFFFF',
                                fontSize: 12,
                                color: S.txt,
                                fontFamily: 'inherit',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => void handlePanelTicketSubjectSave()}
                              disabled={ticketPanelSubjectSaving}
                              title="Salvar assunto"
                              style={{
                                flexShrink: 0,
                                width: 40,
                                borderRadius: 8,
                                border: S.border2,
                                background: S.accentLight,
                                color: S.accent,
                                cursor: ticketPanelSubjectSaving ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: ticketPanelSubjectSaving ? 0.7 : 1,
                              }}
                            >
                              <Save size={16} strokeWidth={2} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        field('Assunto', <span style={{ textAlign: 'right' as const, display: 'block' }}>{currentTicket.subject || '—'}</span>)
                      )}

                      {/* 2. Descrição — abaixo do assunto */}
                      <div style={{ marginBottom: 8 }}>
                        {canEditTicketPanelContent ? (
                          <>
                            <label
                              htmlFor="atend-ticket-desc"
                              style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}
                            >
                              Descrição
                            </label>
                            <textarea
                              id="atend-ticket-desc"
                              value={ticketPanelDescDraft}
                              onChange={(ev) => setTicketPanelDescDraft(ev.target.value)}
                              maxLength={600}
                              rows={3}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box' as const,
                                padding: '7px 10px',
                                borderRadius: 8,
                                border: S.border2,
                                background: '#FFFFFF',
                                fontSize: 12,
                                color: S.txt,
                                fontFamily: 'inherit',
                                lineHeight: 1.5,
                                resize: 'vertical' as const,
                              }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                              <button
                                type="button"
                                onClick={() => void handlePanelTicketDescriptionSave()}
                                disabled={ticketPanelDescSaving || ticketPanelDescDraft.trim() === String(currentTicket.description ?? '').trim()}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  padding: '4px 10px', borderRadius: 7, border: S.border2,
                                  background: ticketPanelDescDraft.trim() !== String(currentTicket.description ?? '').trim() ? S.accentLight : S.bg2,
                                  color: S.accent, fontSize: 11, fontWeight: 600,
                                  cursor: ticketPanelDescSaving || ticketPanelDescDraft.trim() === String(currentTicket.description ?? '').trim() ? 'not-allowed' : 'pointer',
                                  opacity: ticketPanelDescSaving || ticketPanelDescDraft.trim() === String(currentTicket.description ?? '').trim() ? 0.65 : 1,
                                  fontFamily: 'inherit',
                                }}
                              >
                                <Save size={11} strokeWidth={2} />
                                {ticketPanelDescSaving ? 'Salvando...' : 'Salvar'}
                              </button>
                            </div>
                          </>
                        ) : (currentTicket.description || '').trim() ? (
                          <p style={{ margin: 0, fontSize: 11, color: S.txt2, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const }}>
                            {currentTicket.description}
                          </p>
                        ) : null}
                      </div>

                      {/* ── divisor: conteúdo ↔ classificação ── */}
                      <div style={{ height: 1, background: 'rgba(15,23,42,.05)', margin: '4px -14px 10px' }} />

                      {/* 3. Status — select apenas quando editável */}
                      {canEditTicketPanelFields && (
                        <div style={{ marginBottom: 8 }}>
                          <label
                            htmlFor="atend-ticket-status"
                            style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}
                          >
                            Status
                          </label>
                          <select
                            id="atend-ticket-status"
                            value={panelStatusSelectValue}
                            disabled={ticketPanelStatusSaving}
                            onChange={handlePanelTicketStatusChange}
                            style={{
                              width: '100%', padding: '8px 10px', borderRadius: 8,
                              border: S.border2, background: '#FFFFFF', fontSize: 12,
                              color: S.txt, fontFamily: 'inherit',
                              cursor: ticketPanelStatusSaving ? 'wait' : 'pointer',
                              opacity: ticketPanelStatusSaving ? 0.75 : 1,
                            }}
                          >
                            {TICKET_STATUS_SELECT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* 4. Categoria + Prioridade */}
                      {canEditTicketPanelFields && ticketSettingsTree.length > 0 ? (
                        /* Modo edição com árvore carregada: só Prioridade (Categoria visível nos selects abaixo) */
                        <div style={{ marginBottom: 8 }}>
                          <label
                            htmlFor="atend-ticket-priority"
                            style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}
                          >
                            Prioridade
                          </label>
                          {tenantPriorities.length > 0 ? (
                            <select
                              id="atend-ticket-priority"
                              value={panelPrioritySelectValue}
                              disabled={ticketPanelPrioritySaving}
                              onChange={handlePanelTicketPriorityChange}
                              style={{ ...panelSelectCompact, cursor: ticketPanelPrioritySaving ? 'wait' : 'pointer', opacity: ticketPanelPrioritySaving ? 0.75 : 1 }}
                            >
                              {tenantPriorities.map((p: any) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}{p.active === false ? ' (inativa)' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', minHeight: 36 }}>
                              <span style={ticketPriorityChipStyle(currentTicket)}>{(ticketPri ?? getTicketPriorityDisplay(currentTicket)).label}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Modo leitura ou sem árvore: grid Categoria | Prioridade */
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>Categoria</span>
                            <div style={{ ...panelSelectCompact, background: S.bg2, minHeight: 36, display: 'flex', alignItems: 'center', boxSizing: 'border-box' as const }}>
                              {(ticketPanelCatDraft || currentTicket.category || '').trim() || '—'}
                            </div>
                          </div>
                          <div>
                            <label
                              htmlFor="atend-ticket-priority"
                              style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 6 }}
                            >
                              Prioridade
                            </label>
                            {canEditTicketPanelFields && tenantPriorities.length > 0 ? (
                              <select
                                id="atend-ticket-priority"
                                value={panelPrioritySelectValue}
                                disabled={ticketPanelPrioritySaving}
                                onChange={handlePanelTicketPriorityChange}
                                style={{ ...panelSelectCompact, cursor: ticketPanelPrioritySaving ? 'wait' : 'pointer', opacity: ticketPanelPrioritySaving ? 0.75 : 1 }}
                              >
                                {tenantPriorities.map((p: any) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}{p.active === false ? ' (inativa)' : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', minHeight: 36 }}>
                                <span style={ticketPriorityChipStyle(currentTicket)}>{(ticketPri ?? getTicketPriorityDisplay(currentTicket)).label}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 6. Serviço */}
                      {canEditTicketPanelFields && ticketSettingsTree.length > 0 ? (
                        <div style={{ padding: '8px 0' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 8 }}>Serviço</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <select
                              value={ticketPanelDeptDraft}
                              onChange={(ev) => {
                                setTicketPanelDeptDraft(ev.target.value);
                                setTicketPanelCatDraft('');
                                setTicketPanelSubDraft('');
                              }}
                              style={panelSelectCompact}
                            >
                              <option value="">Departamento...</option>
                              {ticketSettingsTree.map((d: any) => (
                                <option key={d.id} value={d.name}>{d.name}</option>
                              ))}
                            </select>
                            <select
                              value={ticketPanelCatDraft}
                              onChange={(ev) => { setTicketPanelCatDraft(ev.target.value); setTicketPanelSubDraft(''); }}
                              disabled={!ticketPanelDeptDraft}
                              style={{ ...panelSelectCompact, opacity: ticketPanelDeptDraft ? 1 : 0.55, cursor: ticketPanelDeptDraft ? 'pointer' : 'not-allowed' }}
                            >
                              <option value="">Categoria...</option>
                              {panelCatsEdit.map((c: any) => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                            <select
                              value={ticketPanelSubDraft}
                              onChange={(ev) => setTicketPanelSubDraft(ev.target.value)}
                              disabled={!ticketPanelCatDraft}
                              style={{ ...panelSelectCompact, opacity: ticketPanelCatDraft ? 1 : 0.55, cursor: ticketPanelCatDraft ? 'pointer' : 'not-allowed' }}
                            >
                              <option value="">Subcategoria...</option>
                              {panelSubsEdit.map((sub: any) => (
                                <option key={sub.id} value={sub.name}>{sub.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void handlePanelTicketClassificationSave()}
                              disabled={ticketPanelClassSaving || !ticketPanelClassDirty}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                border: `1px solid ${S.accentMid}`,
                                background: ticketPanelClassDirty ? S.accentLight : S.bg2,
                                color: S.accent,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: ticketPanelClassSaving || !ticketPanelClassDirty ? 'not-allowed' : 'pointer',
                                fontFamily: 'inherit',
                                opacity: ticketPanelClassSaving || !ticketPanelClassDirty ? 0.65 : 1,
                              }}
                            >
                              {ticketPanelClassSaving ? 'Salvando...' : 'Salvar classificação'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        field('Serviço', ticketServiceLine)
                      )}

                      {/* ── divisor: Classificação ↔ SLA ── */}
                      <div style={{ height: 1, background: 'rgba(15,23,42,.05)', margin: '4px -14px 10px' }} />

                      {/* 7. Previsão + SLA */}
                      {field('Previsão de solução', formatTicketDateTime(currentTicket.slaResolveAt))}
                      {slaInfo && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: slaInfo.violated ? '#DC2626' : slaInfo.pct > 80 ? '#EA580C' : '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {slaInfo.violated && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#DC2626' }} />}
                              {slaInfo.label}
                            </span>
                            <span style={{ fontSize: 10, color: S.txt3, fontWeight: 500 }}>{Math.round(slaInfo.pct)}%</span>
                          </div>
                          <div style={{ height: 7, background: S.bg3, borderRadius: 4, overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                borderRadius: 4,
                                transition: 'width .4s',
                                width: `${slaInfo.pct}%`,
                                background: slaInfo.violated
                                  ? '#EF4444'
                                  : slaInfo.pct > 80
                                    ? 'linear-gradient(90deg,#F97316,#EF4444)'
                                    : slaInfo.pct > 50
                                      ? '#EAB308'
                                      : '#22C55E',
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 8. Responsável */}
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(15,23,42,.06)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: S.txt3, flexShrink: 0 }}>Responsável</span>
                        {assignedUser ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: S.accent, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {initials(assignedUser.name || assignedUser.email || 'U')}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 500, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{assignedUser.name || assignedUser.email}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: '#92400E', fontWeight: 500 }}>Aguardando distribuição</span>
                        )}
                      </div>
                    </>)}
                  </div>
                )}

                {/* Top: client header — compacto, sem duplicação */}
                <div style={{ padding: '10px 12px', borderBottom: S.border, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColor(dispName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {initials(dispName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{dispName}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: isWhatsapp ? '#DCFCE7' : S.accentLight, color: isWhatsapp ? '#15803D' : S.accent, flexShrink: 0 }}>
                        {isWhatsapp ? 'WhatsApp' : 'Portal'}
                      </span>
                    </div>
                    {customer && (
                      <div style={{ fontSize: 11, color: S.txt2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{customer.tradeName || customer.companyName}</div>
                    )}
                  </div>
                  {contact && (
                    <button
                      type="button"
                      onClick={() => void openEditContactModal()}
                      disabled={loadingEditContact}
                      title="Editar contato"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, border: S.border2, background: S.bg2, color: S.txt2, cursor: loadingEditContact ? 'wait' : 'pointer', flexShrink: 0 }}
                    >
                      <Edit2 size={13} />
                    </button>
                  )}
                </div>

                {/* INFORMAÇÕES — agrupado com o header do cliente */}
                {customer && (
                  <div style={{ padding: '10px 12px', borderBottom: S.border }}>
                    {secTitle('Informações')}
                    {customer.networkName && field('Rede', customer.networkName)}
                    {customer.cnpj && field('CNPJ', <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{customer.cnpj}</span>)}
                    {contact?.whatsapp && field('WhatsApp', <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{formatWhatsApp(contact.whatsapp)}</span>)}
                    {contact?.email && field('E-mail', <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140, display: 'block', color: S.accent }}>{contact.email}</span>)}
                    {customer.city && field('Cidade', `${customer.city}${customer.state ? `, ${customer.state}` : ''}`)}
                    {customer.createdAt && field('Cliente desde', new Date(customer.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }))}
                  </div>
                )}

                {!isTicketType && (
                  <div style={{ padding: '10px 12px', borderBottom: S.border }}>
                    {secTitle('Tags', canEditConversationTags ? (
                      <button
                        type="button"
                        onClick={saveConversationTags}
                        disabled={savingConversationTags}
                        style={{ fontSize: 11, color: S.accent, fontWeight: 700, border: 'none', background: 'transparent', cursor: savingConversationTags ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      >
                        {savingConversationTags ? 'Salvando...' : 'Salvar'}
                      </button>
                    ) : undefined)}
                    <TagMultiSelect
                      options={availableTags}
                      value={conversationTags}
                      onChange={setConversationTags}
                      disabled={!canEditConversationTags || selected?.status === 'closed'}
                      placeholder="Selecione as tags da conversa"
                      emptyText="Nenhuma tag cadastrada"
                    />
                  </div>
                )}

                {/* METRICAS DO ATENDIMENTO */}
                {(attendanceMetrics.queuedAt || attendanceMetrics.attendanceStartedAt || attendanceMetrics.firstAgentReplyAt || attendanceMetrics.closedAt) && (
                  <div style={{ padding: '10px 12px', borderBottom: S.border }}>
                    {secTitle('Métricas do atendimento')}
                    {field('Chat entrou na fila', attendanceMetrics.queuedAt ? timeAgo(attendanceMetrics.queuedAt) : '—')}
                    {field('Agente iniciou', attendanceMetrics.attendanceStartedAt ? timeAgo(attendanceMetrics.attendanceStartedAt) : '—')}
                    {field('Espera para iniciar', attendanceMetrics.waitToStartMs != null ? formatDurationLabel(attendanceMetrics.waitToStartMs) : '—')}
                    {field('Primeira resposta do agente', attendanceMetrics.firstAgentReplyAt ? timeAgo(attendanceMetrics.firstAgentReplyAt) : '—')}
                    {field('Tempo até a primeira resposta', attendanceMetrics.firstReplyMs != null ? formatDurationLabel(attendanceMetrics.firstReplyMs) : '—')}
                    {field('Chat encerrado', attendanceMetrics.closedAt ? timeAgo(attendanceMetrics.closedAt) : '—')}
                    {field('Tempo total do atendimento', attendanceMetrics.durationMs != null ? formatDurationLabel(attendanceMetrics.durationMs) : '—')}
                  </div>
                )}

                {/* ATIVIDADE */}
                {clientTickets.length > 0 && (
                  <div style={{ padding: '10px 12px', borderBottom: S.border }}>
                    {secTitle('Atividade')}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        { val: total, label: 'Tickets total', sub: `+${clientTickets.filter((t: any) => { const d = new Date(t.createdAt); const now = new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }).length} este mês` },
                        { val: `${resRate}%`, label: 'Resolução', sub: null },
                        { val: '—', label: 'Tempo médio', sub: null },
                        { val: urgent, label: 'Urgentes abertos', sub: null },
                      ].map(({ val, label, sub }) => (
                        <div key={label} style={{ background: S.bg2, borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: S.txt, lineHeight: 1.2 }}>{val}</div>
                          <div style={{ fontSize: 10, color: S.txt2, marginTop: 2, fontWeight: 500 }}>{label}</div>
                          {sub && <div style={{ fontSize: 10, color: '#10B981', marginTop: 1, fontWeight: 500 }}>{sub}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TICKETS RECENTES */}
                {recentTickets.length > 0 && (
                  <div style={{ padding: '10px 12px', borderBottom: S.border }}>
                    {secTitle('Tickets recentes', (
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboard/tickets?clientId=${selected.clientId}`)}
                        style={{ fontSize: 11, color: S.accent, fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                      >
                        Ver todos
                      </button>
                    ))}
                    {recentTickets.map((t: any) => {
                      const isOpen = ['open','in_progress','waiting_client'].includes(t.status);
                      const isResolved = t.status === 'resolved';
                      const dot = isOpen ? S.accent : isResolved ? '#10B981' : '#A8A8BE';
                      const badge = isTicketCriticalUrgent(t) ? { bg: '#FEF2F2', color: '#DC2626', label: 'Urgente' } :
                                    t.status === 'resolved' ? { bg: '#F0FDF4', color: '#166534', label: 'Resolvido' } :
                                    isOpen ? { bg: S.accentLight, color: S.accent, label: 'Aberto' } : null;
                      const isSameTicketAsChat = String(t.id) === String(selected?.ticketId || currentTicket?.id || '');
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            if (isSameTicketAsChat) {
                              openTicketPanelAndScroll();
                              return;
                            }
                            void openTicketDetailSheet(t.id);
                          }}
                          title={isSameTicketAsChat ? 'Ver detalhes no painel' : 'Ver ticket no painel lateral'}
                          style={{
                            width: '100%',
                            display: 'block',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: S.border }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: S.txt3, fontFamily: "'DM Mono', monospace" }}>{t.ticketNumber}</div>
                              <div style={{ fontSize: 12, color: S.txt, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              {badge && <div style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600, background: badge.bg, color: badge.color }}>{badge.label}</div>}
                              <div style={{ fontSize: 10, color: S.txt3, marginTop: 2 }}>{timeAgo(t.createdAt)}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

              </>
            );
          })() : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.txt3 }}>
              <div style={{ textAlign: 'center' }}>
                <User size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                <p style={{ fontSize: 12, margin: 0 }}>Nenhuma conversa selecionada</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showEditContactModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
            padding: 16,
          }}
          onClick={() => !savingEditContact && setShowEditContactModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#fff',
              borderRadius: 18,
              boxShadow: '0 24px 64px rgba(15,23,42,.22)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={17} color="#4F46E5" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Editar contato</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>Atualize nome, e-mail, telefone e WhatsApp sem sair do atendimento.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !savingEditContact && setShowEditContactModal(false)}
                style={{ width: 32, height: 32, borderRadius: 10, border: 'none', background: '#F3F4F6', color: '#6B7280', cursor: savingEditContact ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); void saveEditedContact(); }}>
              <div style={{ padding: 20, display: 'grid', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Nome</label>
                  <input
                    value={editContactForm.name}
                    onChange={(e) => setEditContactForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Nome do contato"
                    autoFocus
                    style={{ width: '100%', height: 42, borderRadius: 10, border: '1.5px solid #E5E7EB', padding: '0 12px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>E-mail</label>
                  <input
                    value={editContactForm.email}
                    onChange={(e) => setEditContactForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="email@empresa.com"
                    style={{ width: '100%', height: 42, borderRadius: 10, border: '1.5px solid #E5E7EB', padding: '0 12px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Telefone</label>
                    <input
                      value={editContactForm.phone}
                      onChange={(e) => setEditContactForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="Telefone"
                      style={{ width: '100%', height: 42, borderRadius: 10, border: '1.5px solid #E5E7EB', padding: '0 12px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>WhatsApp</label>
                    <input
                      value={editContactForm.whatsapp}
                      onChange={(e) => setEditContactForm((prev) => ({ ...prev, whatsapp: e.target.value }))}
                      placeholder="WhatsApp"
                      style={{ width: '100%', height: 42, borderRadius: 10, border: '1.5px solid #E5E7EB', padding: '0 12px', fontSize: 14, color: '#111827', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: '1px solid #E5E7EB', background: '#F9FAFB' }}>
                <button
                  type="button"
                  onClick={() => setShowEditContactModal(false)}
                  disabled={savingEditContact}
                  style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600, cursor: savingEditContact ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEditContact || !editContactForm.name.trim()}
                  style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: savingEditContact || !editContactForm.name.trim() ? '#CBD5E1' : S.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: savingEditContact || !editContactForm.name.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {savingEditContact ? 'Salvando...' : 'Salvar contato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ══════════ TOAST ══════════ */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'success' ? '#16A34A' : '#DC2626', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 10002, whiteSpace: 'nowrap', animation: 'fadeUp 0.2s ease-out' }}>
          {toast.type === 'success' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}

      {/* ══════════ MODAL: Nova Conversa WhatsApp ══════════ */}
      {showStartModal && (() => {
        const existingConv = startContactId
          ? conversations.find((c: any) => c.contactId === startContactId && c.status === 'active')
          : null;
        const filteredContacts = startContacts.filter((c: any) => {
          if (!startContactSearch.trim()) return true;
          const q = startContactSearch.toLowerCase();
          return c.name?.toLowerCase().includes(q) || c.whatsapp?.includes(q) || c.phone?.includes(q);
        });
        // Modo "Por contato": só mostra contatos que têm whatsapp (não apenas phone)
        const contactsWithWa = filteredContacts.filter((c: any) => c.whatsapp?.trim());
        const contactsPhoneOnly = filteredContacts.filter((c: any) => !c.whatsapp?.trim() && c.phone?.trim());

        const canStartByContact = !!startContactId && !startingConv;
        const canStartByPhone = startPhone.trim().replace(/\D/g,'').length >= 8 && !startingConv && !!startClientId;

        const S_TAB = (active: boolean) => ({
          flex: 1, padding: '8px 0', fontSize: 13, fontWeight: active ? 700 : 500,
          background: active ? '#4F46E5' : 'transparent',
          color: active ? '#fff' : '#64748B',
          border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
        });

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setShowStartModal(false)}>
            <div style={{ background: '#fff', borderRadius: 16, width: 500, maxWidth: 'calc(100vw - 32px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={17} color="#25D366" /> Nova conversa WhatsApp
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>Inicie uma conversa outbound com um contato</p>
                </div>
                <button onClick={() => setShowStartModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}><X size={18} /></button>
              </div>

              {/* Tabs */}
              <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 10, padding: 4 }}>
                  <button style={S_TAB(startMode === 'contact')} onClick={() => { setStartMode('contact'); setStartPhoneResult(null); }}>
                    👤 Por contato existente
                  </button>
                  <button style={S_TAB(startMode === 'phone')} onClick={() => { setStartMode('phone'); setStartContactId(''); }}>
                    📱 Por número direto
                  </button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>

                {/* ── Modo: Por contato ── */}
                {startMode === 'contact' && (
                  <>
                    <div style={{ marginBottom: 16, position: 'relative' }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cliente</label>
                      <input
                        value={startClientInput}
                        onChange={e => handleClientSearchInput(e.target.value)}
                        onFocus={() => { if (!startClientId) { setStartClientResults(customers.slice(0, 8)); setStartClientDropdown(true); } }}
                        onBlur={() => setTimeout(() => setStartClientDropdown(false), 150)}
                        placeholder="Buscar cliente por nome..."
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${startClientId ? '#4F46E5' : '#E2E8F0'}`, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, background: startClientId ? '#F5F3FF' : '#fff' }}
                      />
                      {startClientSearching && <span style={{ position: 'absolute', right: 12, top: 34, fontSize: 11, color: '#94A3B8' }}>Buscando...</span>}
                      {startClientDropdown && startClientResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                          {startClientResults.map((c: any) => (
                            <button key={c.id} onMouseDown={() => handleClientSelect(c)}
                              style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }}>
                              {c.tradeName || c.companyName || c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {startClientId && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                          Contato <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>(com WhatsApp cadastrado)</span>
                        </label>
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94A3B8' }} />
                          <input value={startContactSearch} onChange={e => setStartContactSearch(e.target.value)} placeholder="Buscar por nome ou número..."
                            style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                        </div>
                        {loadingStartContacts ? (
                          <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>Carregando contatos...</div>
                        ) : contactsWithWa.length === 0 && contactsPhoneOnly.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: 16, color: '#94A3B8', fontSize: 13, background: '#F8FAFC', borderRadius: 10 }}>
                            {startContacts.length === 0 ? 'Nenhum contato cadastrado neste cliente.' : 'Nenhum contato encontrado.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                            {contactsWithWa.map((c: any) => {
                              const isSel = startContactId === c.id;
                              return (
                                <button key={c.id} onClick={() => setStartContactId(isSel ? '' : c.id)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderRadius: 10, border: `1.5px solid ${isSel ? '#4F46E5' : '#E2E8F0'}`, background: isSel ? '#EEF2FF' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                                  <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: isSel ? '#4F46E5' : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSel ? '#fff' : '#64748B', fontSize: 12, fontWeight: 700 }}>
                                    {c.name?.charAt(0)?.toUpperCase() || '?'}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#25D366', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Phone size={10} />{formatWhatsApp(c.whatsapp) || c.whatsapp}
                                    </p>
                                  </div>
                                  {isSel && <Check size={16} color="#4F46E5" />}
                                </button>
                              );
                            })}
                            {contactsPhoneOnly.length > 0 && (
                              <div style={{ fontSize: 11, color: '#94A3B8', padding: '6px 4px 2px', borderTop: '1px solid #F1F5F9', marginTop: 4 }}>
                                Contatos abaixo têm apenas telefone (sem WhatsApp cadastrado — use &quot;Por número direto&quot;):
                              </div>
                            )}
                            {contactsPhoneOnly.map((c: any) => (
                              <button key={c.id} disabled style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderRadius: 10, border: '1.5px solid #F1F5F9', background: '#FAFAFA', cursor: 'not-allowed', textAlign: 'left', opacity: 0.6 }}>
                                <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12, fontWeight: 700 }}>
                                  {c.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} />{c.phone}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ── Modo: Por número direto ── */}
                {startMode === 'phone' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Número do WhatsApp
                    </label>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        value={startPhone}
                        onChange={e => { setStartPhone(e.target.value); setStartPhoneResult(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') handleCheckPhone(); }}
                        placeholder="Ex: 55 11 99999-9999"
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${startPhoneResult ? (startPhoneResult.exists ? '#22C55E' : '#EF4444') : '#E2E8F0'}`, fontSize: 14, outline: 'none' }}
                      />
                      <button
                        onClick={handleCheckPhone}
                        disabled={!startPhone.trim() || startPhoneChecking}
                        style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: !startPhone.trim() ? '#E2E8F0' : '#4F46E5', color: !startPhone.trim() ? '#94A3B8' : '#fff', fontWeight: 700, fontSize: 13, cursor: !startPhone.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                        {startPhoneChecking ? '...' : 'Verificar'}
                      </button>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: 11, color: '#94A3B8' }}>
                      Informe com DDI (ex: 55 para Brasil). O sistema verifica se o número está ativo no WhatsApp.
                    </p>
                    {startPhoneResult && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: startPhoneResult.exists ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${startPhoneResult.exists ? '#BBF7D0' : '#FECACA'}`, marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                        {startPhoneResult.exists ? (
                          <>
                            <CheckCircle2 size={16} color="#16A34A" style={{ flexShrink: 0 }} />
                            <div>
                              <span style={{ fontWeight: 700, color: '#15803D' }}>Número encontrado no WhatsApp!</span>
                              {startPhoneResult.jid && (
                                <span style={{ color: '#64748B', marginLeft: 6, fontSize: 11 }}>JID: {startPhoneResult.jid}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <X size={16} color="#DC2626" style={{ flexShrink: 0 }} />
                            <div>
                              <span style={{ fontWeight: 700, color: '#DC2626' }}>Número não encontrado no WhatsApp.</span>
                              <span style={{ color: '#94A3B8', marginLeft: 6, fontSize: 11 }}>Verifique o número e tente novamente, ou prossiga mesmo assim.</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <div style={{ marginBottom: 10, position: 'relative' }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cliente <span style={{ color: '#EF4444' }}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>(obrigatório — o contato será cadastrado nesta empresa)</span></label>
                      <input
                        value={startClientInput}
                        onChange={e => handleClientSearchInput(e.target.value)}
                        onFocus={() => { setStartClientResults(customers.slice(0, 8)); setStartClientDropdown(true); }}
                        onBlur={() => setTimeout(() => setStartClientDropdown(false), 150)}
                        placeholder="Buscar cliente por nome..."
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${startClientId ? '#4F46E5' : '#E2E8F0'}`, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, background: startClientId ? '#F5F3FF' : '#fff' }}
                      />
                      {startClientSearching && <span style={{ position: 'absolute', right: 12, top: 32, fontSize: 11, color: '#94A3B8' }}>Buscando...</span>}
                      {startClientDropdown && startClientResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                          {startClientResults.map((c: any) => (
                            <button key={c.id} onMouseDown={() => handleClientSelect(c)}
                              style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }}>
                              {c.tradeName || c.companyName || c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!startClientId && (
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#EF4444' }}>
                        Selecione uma empresa para que o contato seja cadastrado automaticamente ao iniciar.
                      </p>
                    )}
                  </div>
                )}

                {/* ── Template obrigatório (ambos os modos) ── */}
                {(startMode === 'phone' || (startMode === 'contact' && startContactId)) && (
                  <div style={{ marginTop: 8, padding: '14px', borderRadius: 12, border: '1.5px solid #FDE68A', background: '#FFFBEB' }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#92400E', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                      Template de abertura
                    </label>
                    {loadingTemplates ? (
                      <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>Carregando templates...</div>
                    ) : metaTemplates.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {metaTemplates.map(t => {
                          const sel = startTemplateName === t.name && startTemplateLang === t.language;
                          return (
                            <button key={`${t.name}-${t.language}`} onClick={() => { setStartTemplateName(t.name); setStartTemplateLang(t.language); setStartMsgMode('template'); setStartTemplateParams(Array(t.paramCount).fill('')); }}
                              style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 13px', borderRadius: 10, border: `2px solid ${sel ? '#D97706' : '#E2E8F0'}`, background: sel ? '#FEF3C7' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{t.name}</span>
                                <span style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', borderRadius: 4, padding: '1px 6px' }}>{t.language}</span>
                                <span style={{ fontSize: 11, borderRadius: 4, padding: '1px 6px', background: t.status === 'APPROVED' ? '#DCFCE7' : '#FEF9C3', color: t.status === 'APPROVED' ? '#16A34A' : '#854D0E', fontWeight: 600 }}>{t.status}</span>
                                {sel && <span style={{ fontSize: 11, color: '#D97706', fontWeight: 700, marginLeft: 'auto' }}>✓ selecionado</span>}
                              </div>
                              {t.body && <span style={{ fontSize: 12, color: '#64748B' }}>{t.body}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ fontSize: 12, color: '#92400E', margin: 0 }}>Nenhum template aprovado encontrado. Verifique o WABA ID e o token nas configurações.</p>
                    )}

                    {/* Campos de parâmetros do template selecionado */}
                    {startTemplateParams.length > 0 && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: '#92400E', letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
                          Parâmetros do template
                        </label>
                        {startTemplateParams.map((val, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#64748B', minWidth: 28 }}>{`{{${i + 1}}}`}</span>
                            <input
                              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none' }}
                              placeholder={`Valor para {{${i + 1}}}`}
                              value={val}
                              onChange={e => setStartTemplateParams(p => p.map((v, j) => j === i ? e.target.value : v))}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button onClick={() => setShowStartModal(false)} style={{ padding: '10px 18px', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>

                {/* Botão modo "Por contato" */}
                {startMode === 'contact' && (
                  <button disabled={!canStartByContact}
                    onClick={async () => {
                      if (!startClientId || !startContactId) return;
                      setStartingConv(true);
                      try {
                        if (existingConv && !startFirstMessage.trim()) {
                          await afterConvCreated(existingConv);
                          showToast('Conversa aberta!');
                        } else {
                          // Usa startOutbound para criar conversa + enviar mensagem inicial (sem ticket — atendente vincula depois)
                          const selectedContact = startContacts.find((c: any) => c.id === startContactId);
                          const res: any = await api.startOutboundConversation({
                            contactId: startContactId,
                            clientId: startClientId,
                            subject: selectedContact?.name ? `WhatsApp - ${selectedContact.name}` : undefined,
                            templateName: startTemplateName.trim() || undefined,
                            templateLanguage: startTemplateName.trim() ? startTemplateLang : undefined,
                            templateParams: startTemplateParams.length > 0 ? startTemplateParams : undefined,
                          });
                          const d = res?.data ?? res;
                          await afterConvCreated(d.conversation);
                          showToast(d.firstMessageSent ? 'Conversa iniciada e mensagem enviada!' : 'Nova conversa iniciada!');
                        }
                      } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao iniciar conversa', 'error'); }
                      setStartingConv(false);
                    }}
                    style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: !canStartByContact ? '#E2E8F0' : existingConv ? '#4F46E5' : 'linear-gradient(135deg,#4F46E5,#6366F1)', color: !canStartByContact ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !canStartByContact ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} />
                    {startingConv ? 'Aguarde...' : existingConv ? 'Abrir conversa' : 'Iniciar conversa'}
                  </button>
                )}

                {/* Botão modo "Por número" */}
                {startMode === 'phone' && (
                  <button
                    disabled={!canStartByPhone}
                    onClick={async () => {
                      if (!startPhone.trim()) return;
                      setStartingConv(true);
                      try {
                        const res: any = await api.startOutboundConversation({
                          phone: startPhone.trim(),
                          clientId: startClientId || undefined,
                          templateName: startTemplateName.trim() || undefined,
                          templateLanguage: startTemplateName.trim() ? startTemplateLang : undefined,
                          templateParams: startTemplateParams.length > 0 ? startTemplateParams : undefined,
                        });
                        const d = res?.data ?? res;
                        await afterConvCreated(d.conversation);
                        showToast(d.firstMessageSent ? 'Conversa iniciada e mensagem enviada!' : 'Conversa iniciada!');
                      } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao iniciar conversa', 'error'); }
                      setStartingConv(false);
                    }}
                    style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: !canStartByPhone ? '#E2E8F0' : 'linear-gradient(135deg,#25D366,#16A34A)', color: !canStartByPhone ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !canStartByPhone ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} />
                    {startingConv ? 'Aguarde...' : startPhoneResult?.exists === false ? 'Enviar mesmo assim' : 'Iniciar conversa'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ MODAL: Vincular Ticket ══════════ */}
      {showLinkModal && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={() => { setShowLinkModal(false); setLinkSelectedId(null); }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Vincular Ticket</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Selecione o ticket e informe o motivo</p>
              </div>
              <button onClick={() => { setShowLinkModal(false); setLinkSelectedId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            {!linkSelectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '16px 20px', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={linkTicketSearch} onChange={e => setLinkTicketSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchTicketsForLink()}
                    placeholder="Buscar por número ou assunto..." style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none' }} />
                  <button onClick={searchTicketsForLink} style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Buscar</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {linkTickets.filter((t: any) => !['closed', 'cancelled'].includes(t.status)).map((t: any) => {
                    const ST: Record<string,{bg:string;color:string;label:string}> = {
                      open:           { bg:'#EEF2FF', color:'#3730A3', label:'Aberto' },
                      in_progress:    { bg:'#FEF3C7', color:'#92400E', label:'Em Andamento' },
                      waiting_client: { bg:'#F0F9FF', color:'#0369A1', label:'Aguardando' },
                      resolved:       { bg:'#F0FDF4', color:'#166534', label:'Resolvido' },
                      closed:         { bg:'#F9FAFB', color:'#374151', label:'Fechado' },
                    };
                    const st = ST[t.status] || ST.closed;
                    return (
                      <button key={t.id} onClick={() => handleLinkTicket(t.id)}
                        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 8, textAlign: 'left', cursor: 'pointer', background: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4F46E5', fontSize: 12, flexShrink: 0 }}>{t.ticketNumber}</span>
                        <span style={{ fontSize: 13, color: '#0F172A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                      </button>
                    );
                  })}
                  {linkTickets.filter((t: any) => !['closed', 'cancelled'].includes(t.status)).length === 0 && (
                    <p style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: '24px 0' }}>
                      {linkTickets.length === 0 ? 'Nenhum ticket encontrado. Use a busca acima.' : 'Nenhum ticket disponível para vincular.'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#4338CA', fontWeight: 600 }}>Ticket selecionado</p>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#0F172A', fontWeight: 700 }}>
                    {linkTickets.find(t => t.id === linkSelectedId)?.ticketNumber} — {linkTickets.find(t => t.id === linkSelectedId)?.subject}
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                    Motivo da Vinculação <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <textarea value={linkReason} onChange={e => setLinkReason(e.target.value)} rows={3} autoFocus
                    placeholder="Ex: Cliente abriu via WhatsApp, ticket já existia no sistema..."
                    style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${linkReason.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setLinkSelectedId(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Voltar</button>
                  <button onClick={confirmLinkTicket} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Vincular</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Criar Ticket ══════════ */}
      {showCreateModal && selected && (() => {
        const selDept = ticketSettingsTree.find((d: any) => d.name === createForm.department);
        const cats = selDept?.categories || [];
        const selCat = cats.find((c: any) => c.name === createForm.category);
        const subs = selCat?.subcategories || [];
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plus size={18} color="#4F46E5" />
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Criar Ticket</h2>
                  <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Preencha as informações do chamado</p>
                </div>
                <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 20 }}>×</button>
              </div>
              <div style={{ overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Rede</label>
                  <select value={createForm.networkId} onChange={async e => {
                    const nid = e.target.value;
                    setCreateForm(f => ({ ...f, networkId: nid, clientId: '' }));
                    setCreateClientSearch(''); setCreateClientName(''); setCreateClientResults([]); setShowCreateClientDropdown(false);
                    if (nid) {
                      setCreateCustomers([]);
                      try { const r: any = await api.getCustomers({ networkId: nid, perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
                    } else {
                      // Cleared network: show all customers
                      setCreateCustomers(customers.length > 0 ? customers : []);
                      if (customers.length === 0) { try { const r: any = await api.getCustomers({ perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
                    }
                  }} style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value=''>Todas as redes</option>
                    {networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                </div>
                <div style={{ position: 'relative' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Cliente <span style={{ color: '#EF4444' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94A3B8', pointerEvents: 'none' }} />
                    <input
                      value={createForm.clientId ? createClientName : createClientSearch}
                      readOnly={!!createForm.clientId}
                      onChange={e => {
                        if (createForm.clientId) return; // readonly quando selecionado
                        const q = e.target.value;
                        setCreateClientSearch(q);
                        setShowCreateClientDropdown(true);
                        if (createClientSearchTimer.current) clearTimeout(createClientSearchTimer.current);
                        if (!q.trim()) {
                          setCreateClientResults(createCustomers.slice(0, 20));
                          setCreateClientLoading(false);
                          return;
                        }
                        setCreateClientLoading(true);
                        createClientSearchTimer.current = setTimeout(async () => {
                          try {
                            const params: any = { search: q, perPage: 20 };
                            if (createForm.networkId) params.networkId = createForm.networkId;
                            const r: any = await api.getCustomers(params);
                            setCreateClientResults(Array.isArray(r) ? r : r?.data ?? []);
                          } catch { setCreateClientResults([]); }
                          setCreateClientLoading(false);
                        }, 300);
                      }}
                      onFocus={() => {
                        if (createForm.clientId) return;
                        setShowCreateClientDropdown(true);
                        if (!createClientSearch.trim()) setCreateClientResults(createCustomers.slice(0, 20));
                      }}
                      onBlur={() => setTimeout(() => setShowCreateClientDropdown(false), 200)}
                      placeholder="Buscar cliente..."
                      style={{ width: '100%', padding: '9px 12px 9px 32px', border: `1.5px solid ${createForm.clientId ? '#BBF7D0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, background: createForm.clientId ? '#F0FDF4' : '#fff', cursor: createForm.clientId ? 'default' : 'text' }}
                    />
                    {createClientLoading && (
                      <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid #6366F1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                    )}
                    {createForm.clientId && !createClientLoading && (
                      <button type="button" onClick={() => { setCreateForm(f => ({ ...f, clientId: '' })); setCreateClientName(''); setCreateClientSearch(''); setCreateClientResults(createCustomers.slice(0, 20)); setShowCreateClientDropdown(false); }}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', display: 'flex', padding: 2 }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {showCreateClientDropdown && createClientResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                      {createClientResults.map((c: any) => (
                        <button key={c.id} type="button"
                          onMouseDown={() => {
                            setCreateForm(f => ({ ...f, clientId: c.id }));
                            setCreateClientName(c.tradeName || c.companyName || '');
                            setCreateClientSearch('');
                            setShowCreateClientDropdown(false);
                          }}
                          style={{ display: 'block', width: '100%', padding: '9px 12px', textAlign: 'left', border: 'none', background: createForm.clientId === c.id ? '#EEF2FF' : 'transparent', cursor: 'pointer', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }}>
                          <span style={{ fontWeight: 600 }}>{c.tradeName || c.companyName}</span>
                          {c.tradeName && c.companyName && <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 6 }}>{c.companyName}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {showCreateClientDropdown && createClientResults.length === 0 && createClientSearch.trim() && !createClientLoading && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '10px 12px', marginTop: 2 }}>
                      <span style={{ fontSize: 13, color: '#94A3B8' }}>Nenhum cliente encontrado</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Assunto <span style={{ color: '#EF4444' }}>*</span></label>
                  <input value={createForm.subject} onChange={e => setCreateForm(f => ({ ...f, subject: e.target.value }))} autoFocus
                    style={{ width: '100%', padding: '9px 12px', border: `1.5px solid ${createForm.subject.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Descrição</label>
                  <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={2}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Prioridade</label>
                    {tenantPriorities.length > 0 ? (
                      <select
                        value={createForm.priorityId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const p = tenantPriorities.find((x: any) => x.id === id);
                          setCreateForm((f) => ({
                            ...f,
                            priorityId: id,
                            priority: (
                              p && ['low', 'medium', 'high', 'critical'].includes(p.slug) ? p.slug : f.priority
                            ) as SystemPriority,
                          }));
                        }}
                        style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
                      >
                        {tenantPriorities.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={createForm.priority}
                        onChange={(e) =>
                          setCreateForm((f) => ({
                            ...f,
                            priority: e.target.value as SystemPriority,
                          }))
                        }
                        style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
                      >
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Técnico</label>
                    <select value={createForm.assignedTo} onChange={e => setCreateForm(f => ({ ...f, assignedTo: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Não atribuído</option>
                      {team.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Departamento</label>
                  <select value={createForm.department} onChange={e => setCreateForm(f => ({ ...f, department: e.target.value, category: '', subcategory: '' }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value=''>Selecione...</option>
                    {ticketSettingsTree.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                {cats.length > 0 && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Categoria</label>
                    <select value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Selecione...</option>
                      {cats.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {subs.length > 0 && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Subcategoria</label>
                    <select value={createForm.subcategory} onChange={e => setCreateForm(f => ({ ...f, subcategory: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Selecione...</option>
                      {subs.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreateModal(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={confirmCreateTicket} disabled={createLoading}
                  style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#4F46E5,#6366F1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: createLoading ? 0.7 : 1 }}>
                  <Plus size={14} />{createLoading ? 'Criando...' : 'Criar Ticket'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ MODAL: Encerrar — step 1 ══════════ */}
      {showEndModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Encerrar Atendimento</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>O que deseja fazer com o ticket vinculado?</p>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={handleKeepOpen} style={{ padding: '14px 16px', border: '1.5px solid #BFDBFE', borderRadius: 10, background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }}>
                <RefreshCw size={18} style={{ flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>Manter ticket aberto</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#3B82F6', fontWeight: 400 }}>A conversa é encerrada mas o ticket continua em aberto</p>
                </div>
              </button>
              <button onClick={handleCloseTicket} disabled={customerLinkRequired} style={{ padding: '14px 16px', border: '1.5px solid #FED7AA', borderRadius: 10, background: '#FFF7ED', color: '#C2410C', fontSize: 13, fontWeight: 600, cursor: customerLinkRequired ? 'not-allowed' : 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', opacity: customerLinkRequired ? 0.6 : 1 }}>
                <Lock size={18} style={{ flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>Encerrar e fechar o ticket</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#EA580C', fontWeight: 400 }}>Preencher solução, causa raiz, tempo e encerrar tudo</p>
                </div>
              </button>
            </div>
            <div style={{ padding: '12px 22px', borderTop: '1px solid #F1F5F9', textAlign: 'right' }}>
              <button onClick={() => setShowEndModal(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Manter aberto ══════════ */}
      {showKeepOpenModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Manter Ticket Aberto</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>Informe o motivo pelo qual o ticket ficará em aberto</p>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Descrição da solução aplicada</label>
                <textarea value={keepOpenSolution} onChange={e => setKeepOpenSolution(e.target.value)} placeholder="Descreva o que foi feito até o momento..." rows={3} autoFocus
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Motivo para manter aberto <span style={{ color: '#EF4444' }}>*</span></label>
                <textarea value={keepOpenReason} onChange={e => setKeepOpenReason(e.target.value)} placeholder="Ex: Aguardando retorno do fornecedor..." rows={3}
                  style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${keepOpenReason.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
            </div>
            <div style={{ padding: '12px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowKeepOpenModal(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmKeepOpen} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Encerrar (formulário completo) ══════════ */}
      {showCloseForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lock size={18} color="#EA580C" />
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Encerrar Atendimento</h2>
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Preencha as informações. O ticket vinculado será marcado como resolvido e o cliente poderá confirmar no portal.</p>
              </div>
              <button onClick={() => setShowCloseForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Solução Aplicada <span style={{ color: '#EF4444' }}>OBRIGATÓRIO</span></label>
                <textarea value={closeForm.solution} onChange={e => setCloseForm(f => ({ ...f, solution: e.target.value }))} placeholder="Descreva o que foi feito para resolver..." rows={3}
                  style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${closeForm.solution.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Causa Raiz</label>
                  <select value={closeForm.rootCause} onChange={e => setCloseForm(f => ({ ...f, rootCause: e.target.value }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', outline: 'none' }}>
                    <option value="">Selecione...</option>
                    {rootCauseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Tempo de Atendimento</label>
                  <select value={closeForm.timeSpent} onChange={e => setCloseForm(f => ({ ...f, timeSpent: e.target.value }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', outline: 'none' }}>
                    <option value="">Selecione...</option>
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="60">1 hora</option>
                    <option value="120">2 horas</option>
                    <option value="240">4 horas</option>
                    <option value="480">8 horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Nota Interna</label>
                <textarea value={closeForm.internalNote} onChange={e => setCloseForm(f => ({ ...f, internalNote: e.target.value }))} rows={2} placeholder="Observações internas (não enviadas ao cliente)..."
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Complexidade</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setCloseForm(f => ({ ...f, complexity: f.complexity === n ? 0 : n }))}
                      title={COMPLEXITY_LABELS[n]}
                      style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: `1.5px solid ${closeForm.complexity === n ? '#4F46E5' : '#E2E8F0'}`, background: closeForm.complexity === n ? '#EEF2FF' : '#fff', color: closeForm.complexity === n ? '#4F46E5' : '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      {n}
                    </button>
                  ))}
                </div>
                {closeForm.complexity > 0 && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748B' }}>{COMPLEXITY_LABELS[closeForm.complexity]}</p>}
              </div>
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCloseForm(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmCloseTicket} disabled={customerLinkRequired}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#EA580C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: customerLinkRequired ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: customerLinkRequired ? 0.6 : 1 }}>
                <Lock size={14} /> Encerrar Atendimento
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ══════════ MODAL: Atribuir Responsável ══════════ */}

      {/* ══════════ MODAL: Transferir ══════════ */}
      {showTransferModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowTransferModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Transferir Atendimento</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>Selecione o agente para transferir este atendimento</p>
              </div>
              <button onClick={() => setShowTransferModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {team.filter((u: any) => u.id !== currentTicket?.assignedTo).map((u: any) => (
                <button key={u.id} onClick={() => setTransferAgentId(u.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${transferAgentId === u.id ? S.accent : '#E2E8F0'}`, background: transferAgentId === u.id ? S.accentLight : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all .12s' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: transferAgentId === u.id ? S.accent : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: transferAgentId === u.id ? '#fff' : '#64748B', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {initials(u.name || u.email || 'U')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email}</p>
                    {u.name && u.email && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>{u.email}</p>}
                  </div>
                  {transferAgentId === u.id && <Check size={16} color={S.accent} />}
                </button>
              ))}
              {team.length === 0 && <p style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: '16px 0' }}>Nenhum agente disponível</p>}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowTransferModal(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmTransfer} disabled={transferLoading || !transferAgentId}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: !transferAgentId ? '#E2E8F0' : S.accent, color: !transferAgentId ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !transferAgentId ? 'not-allowed' : 'pointer', opacity: transferLoading ? 0.7 : 1 }}>
                {transferLoading ? 'Transferindo...' : 'Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ticketDetailSheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10050 }}>
          <div
            role="presentation"
            onClick={closeTicketDetailSheet}
            style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)' }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="atend-ticket-sheet-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(440px, 100vw)',
              background: S.bg,
              boxShadow: '-12px 0 40px rgba(15,23,42,0.18)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: S.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: S.bg2 }}>
              <div style={{ minWidth: 0 }}>
                <div id="atend-ticket-sheet-title" style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>Ticket</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 800, color: S.accent, marginTop: 4 }}>
                  {ticketDetailSheetLoading ? '…' : (ticketDetailSheetTicket?.ticketNumber ?? '—')}
                </div>
              </div>
              <button type="button" onClick={closeTicketDetailSheet} title="Fechar (Esc)" style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, border: S.border2, background: S.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.txt2 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              {ticketDetailSheetLoading && (
                <div style={{ padding: 40, textAlign: 'center', color: S.txt3, fontSize: 13 }}>Carregando…</div>
              )}
              {!ticketDetailSheetLoading && ticketDetailSheetTicket && (() => {
                const t = ticketDetailSheetTicket;
                const st = TICKET_STATUS_PANEL[t.status] || TICKET_STATUS_PANEL.open;
                const pri = getTicketPriorityDisplay(t);
                const classLine = [t.department, t.category, t.subcategory].filter(Boolean).join(' › ') || '—';
                const row = (label: string, value: ReactNode) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: S.border }}>
                    <span style={{ fontSize: 12, color: S.txt2, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 12, color: S.txt, fontWeight: 500, textAlign: 'right' as const }}>{value}</span>
                  </div>
                );
                const desc = t.description != null ? String(t.description) : '';
                return (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: st.bg, color: st.color, border: `1px solid ${st.dot}33` }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} />
                        {st.label}
                      </span>
                      <span style={ticketPriorityChipStyle(t)}>{pri.label}</span>
                    </div>
                    {row('Assunto', <span style={{ whiteSpace: 'pre-wrap' }}>{t.subject || '—'}</span>)}
                    {row('Classificação', classLine)}
                    {row('Aberto em', formatTicketDateTime(t.createdAt))}
                    {desc.trim() ? row('Descrição', <span style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', display: 'block' }}>{desc.length > 2000 ? `${desc.slice(0, 2000)}…` : desc}</span>) : null}
                  </>
                );
              })()}
            </div>
          </aside>
        </div>
      )}

    </>
  );
}

export default function AtendimentoPage() {
  return (
    <Suspense fallback={null}>
      <AtendimentoPageInner />
    </Suspense>
  );
}


