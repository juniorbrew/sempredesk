'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Play, X } from 'lucide-react';

export type InlineChatMediaKind = 'image' | 'video';

/** Modal em ecrã completo: reproduz mídia com Fechar e Abrir noutro separador */
export function MediaLightbox({
  open,
  onClose,
  src,
  mediaKind,
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  mediaKind: InlineChatMediaKind;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const openInNewTab = useCallback(() => {
    try {
      window.open(src, '_blank', 'noopener,noreferrer');
    } catch {
      /* ignore */
    }
  }, [src]);

  if (!mounted || !open || !src) return null;

  const btnBase: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    border: 'none',
  };

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(15,23,42,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mediaKind === 'image' ? 'Visualização da imagem' : 'Reprodução do vídeo'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 'min(96vw, 1200px)',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxHeight: 'calc(92vh - 72px)',
          }}
        >
          {mediaKind === 'image' ? (
            <img
              src={src}
              alt=""
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(92vh - 72px)',
                objectFit: 'contain',
                borderRadius: 10,
                boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
              }}
            />
          ) : (
            <video
              key={src}
              src={src}
              controls
              autoPlay
              playsInline
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(92vh - 72px)',
                borderRadius: 10,
                background: '#000',
                boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          <button type="button" onClick={onClose} style={{ ...btnBase, background: '#F1F5F9', color: '#0F172A' }}>
            <X size={18} strokeWidth={2.25} aria-hidden />
            Fechar
          </button>
          <button
            type="button"
            onClick={openInNewTab}
            style={{ ...btnBase, background: '#4F46E5', color: '#fff' }}
          >
            <ExternalLink size={18} strokeWidth={2.25} aria-hidden />
            Abrir noutro separador
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type InlineChatMediaProps = {
  src: string;
  mediaKind: InlineChatMediaKind;
  /** Estilos extra para a imagem inline */
  imageStyle?: CSSProperties;
  /** Estilos extra para o vídeo inline */
  videoStyle?: CSSProperties;
  /** Envolve o vídeo + botão ampliar (ex.: marginBottom) */
  videoContainerStyle?: CSSProperties;
};

/**
 * Imagem: clique abre lightbox.
 * Vídeo: clique na pré-visualização (primeiro fotograma) abre lightbox com controlos e reprodução.
 */
export function InlineChatMedia({ src, mediaKind, imageStyle, videoStyle, videoContainerStyle }: InlineChatMediaProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const openLb = useCallback(() => setLightboxOpen(true), []);
  const closeLb = useCallback(() => setLightboxOpen(false), []);

  if (mediaKind === 'image') {
    return (
      <>
        <img
          src={src}
          alt=""
          title="Clique para ampliar"
          onClick={openLb}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openLb();
            }
          }}
          role="button"
          tabIndex={0}
          style={{
            maxWidth: '100%',
            borderRadius: 12,
            display: 'block',
            objectFit: 'cover',
            cursor: 'pointer',
            ...imageStyle,
          }}
        />
        <MediaLightbox open={lightboxOpen} onClose={closeLb} src={src} mediaKind="image" />
      </>
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        title="Clique para ver o vídeo"
        onClick={openLb}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openLb();
          }
        }}
        style={{
          position: 'relative',
          display: 'block',
          width: 'fit-content',
          maxWidth: '100%',
          cursor: 'pointer',
          borderRadius: 12,
          overflow: 'hidden',
          ...videoContainerStyle,
        }}
      >
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          style={{
            width: '100%',
            maxWidth: 320,
            maxHeight: 280,
            borderRadius: 12,
            display: 'block',
            objectFit: 'contain',
            background: '#000',
            pointerEvents: 'none',
            ...videoStyle,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.45) 100%)',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 999,
              background: 'rgba(15,23,42,0.82)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            }}
          >
            <Play size={18} fill="currentColor" aria-hidden />
            Ver vídeo
          </span>
        </div>
      </div>
      <MediaLightbox open={lightboxOpen} onClose={closeLb} src={src} mediaKind="video" />
    </>
  );
}
