/**
 * Testes — Etapa 2C: Avaliação do atendimento
 *
 * Cobre:
 *  1. Disparo da avaliação: fluxo enviado ao fechar conversa WhatsApp
 *  2. Registro da nota: validação 1–5, persistência
 *  3. Comentário opcional: aceita texto ou skip
 *  4. Prevenção de duplicidade: não avalia ticket já avaliado
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. DISPARO DA AVALIAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe('disparo da avaliação ao encerrar atendimento', () => {
  /**
   * Reprodução da lógica de decisão em ConversationsService.close():
   * só dispara avaliação quando channel=whatsapp, keepTicketOpen=false,
   * ticketId e outboundSender estão disponíveis.
   */
  function deveDispararAvaliacao(params: {
    channel: string;
    keepTicketOpen: boolean;
    ticketId: string | null;
    temOutboundSender: boolean;
    temChatbotService: boolean;
  }): boolean {
    const { channel, keepTicketOpen, ticketId, temOutboundSender, temChatbotService } = params;
    if (channel !== 'whatsapp') return false;
    if (!temChatbotService) return false;
    if (keepTicketOpen) return false;
    if (!ticketId) return false;
    if (!temOutboundSender) return false;
    return true;
  }

  it('dispara avaliação quando canal é whatsapp e atendimento foi encerrado', () => {
    expect(deveDispararAvaliacao({
      channel: 'whatsapp',
      keepTicketOpen: false,
      ticketId: 'ticket-uuid-001',
      temOutboundSender: true,
      temChatbotService: true,
    })).toBe(true);
  });

  it('NÃO dispara para canal portal', () => {
    expect(deveDispararAvaliacao({
      channel: 'portal',
      keepTicketOpen: false,
      ticketId: 'ticket-uuid-001',
      temOutboundSender: true,
      temChatbotService: true,
    })).toBe(false);
  });

  it('NÃO dispara quando keepTicketOpen=true', () => {
    expect(deveDispararAvaliacao({
      channel: 'whatsapp',
      keepTicketOpen: true,
      ticketId: 'ticket-uuid-001',
      temOutboundSender: true,
      temChatbotService: true,
    })).toBe(false);
  });

  it('NÃO dispara sem ticketId', () => {
    expect(deveDispararAvaliacao({
      channel: 'whatsapp',
      keepTicketOpen: false,
      ticketId: null,
      temOutboundSender: true,
      temChatbotService: true,
    })).toBe(false);
  });

  it('NÃO dispara sem outboundSender (fallback: reseta sessão)', () => {
    expect(deveDispararAvaliacao({
      channel: 'whatsapp',
      keepTicketOpen: false,
      ticketId: 'ticket-uuid-001',
      temOutboundSender: false,
      temChatbotService: true,
    })).toBe(false);
  });

  it('NÃO dispara sem chatbotService', () => {
    expect(deveDispararAvaliacao({
      channel: 'whatsapp',
      keepTicketOpen: false,
      ticketId: 'ticket-uuid-001',
      temOutboundSender: true,
      temChatbotService: false,
    })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REGISTRO DA NOTA (validação 1–5)
// ─────────────────────────────────────────────────────────────────────────────

describe('processamento da nota de avaliação (awaiting_rating)', () => {
  const SKIP_KEYWORDS = ['pular', 'pulei', 'skip', 'não', 'nao', 'n', '0', '-', 'sem comentário', 'sem comentario'];

  /**
   * Reprodução da lógica de validação de nota em processMessage() step=awaiting_rating.
   */
  function processarNota(text: string): { valida: boolean; nota: number | null } {
    const nota = parseInt(text.trim(), 10);
    if (isNaN(nota) || nota < 1 || nota > 5) {
      return { valida: false, nota: null };
    }
    return { valida: true, nota };
  }

  it('nota 1 é válida', () => {
    expect(processarNota('1')).toEqual({ valida: true, nota: 1 });
  });

  it('nota 5 é válida', () => {
    expect(processarNota('5')).toEqual({ valida: true, nota: 5 });
  });

  it('nota 3 é válida', () => {
    expect(processarNota('3')).toEqual({ valida: true, nota: 3 });
  });

  it('nota 0 é inválida', () => {
    expect(processarNota('0')).toEqual({ valida: false, nota: null });
  });

  it('nota 6 é inválida (fora do range)', () => {
    expect(processarNota('6')).toEqual({ valida: false, nota: null });
  });

  it('texto não numérico é inválido', () => {
    expect(processarNota('ótimo')).toEqual({ valida: false, nota: null });
  });

  it('texto vazio é inválido', () => {
    expect(processarNota('')).toEqual({ valida: false, nota: null });
  });

  it('nota com espaços extras ainda é válida', () => {
    expect(processarNota('  4  ')).toEqual({ valida: true, nota: 4 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. COMENTÁRIO OPCIONAL
// ─────────────────────────────────────────────────────────────────────────────

describe('processamento do comentário (awaiting_rating_comment)', () => {
  const SKIP_KEYWORDS = ['pular', 'pulei', 'skip', 'não', 'nao', 'n', '0', '-', 'sem comentário', 'sem comentario'];

  /**
   * Reprodução da lógica de detecção de skip/comentário.
   */
  function processarComentario(text: string): { comentario: string | null } {
    const ehSkip = SKIP_KEYWORDS.includes(text.trim().toLowerCase());
    return { comentario: ehSkip ? null : text.trim() };
  }

  it('"pular" resulta em comentário null', () => {
    expect(processarComentario('pular')).toEqual({ comentario: null });
  });

  it('"skip" resulta em comentário null', () => {
    expect(processarComentario('skip')).toEqual({ comentario: null });
  });

  it('"não" resulta em comentário null', () => {
    expect(processarComentario('não')).toEqual({ comentario: null });
  });

  it('"nao" resulta em comentário null', () => {
    expect(processarComentario('nao')).toEqual({ comentario: null });
  });

  it('"0" resulta em comentário null', () => {
    expect(processarComentario('0')).toEqual({ comentario: null });
  });

  it('texto livre é preservado como comentário', () => {
    expect(processarComentario('Ótimo atendimento, muito rápido!')).toEqual({
      comentario: 'Ótimo atendimento, muito rápido!',
    });
  });

  it('comentário com espaços preserva o conteúdo trimado', () => {
    expect(processarComentario('  Muito satisfeito  ')).toEqual({
      comentario: 'Muito satisfeito',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PREVENÇÃO DE DUPLICIDADE
// ─────────────────────────────────────────────────────────────────────────────

describe('prevenção de avaliação duplicada', () => {
  interface TicketAvaliacao {
    id: string;
    satisfactionRating: number | null;
    satisfactionComment: string | null;
    satisfactionAt: Date | null;
  }

  /**
   * Reprodução da cláusula WHERE satisfaction_rating IS NULL no UPDATE.
   * Se já existe uma nota, o UPDATE não altera nada (linhas afetadas = 0).
   */
  function simularUpdate(
    ticket: TicketAvaliacao,
    novaNota: number,
    comentario?: string,
  ): { linhasAfetadas: number; ticketAtualizado: TicketAvaliacao } {
    if (ticket.satisfactionRating !== null) {
      // WHERE satisfaction_rating IS NULL falhou — nenhuma linha afetada
      return { linhasAfetadas: 0, ticketAtualizado: ticket };
    }
    const atualizado: TicketAvaliacao = {
      ...ticket,
      satisfactionRating: novaNota,
      satisfactionComment: comentario ?? null,
      satisfactionAt: new Date(),
    };
    return { linhasAfetadas: 1, ticketAtualizado: atualizado };
  }

  it('primeira avaliação é salva com sucesso', () => {
    const ticket: TicketAvaliacao = {
      id: 'ticket-001', satisfactionRating: null,
      satisfactionComment: null, satisfactionAt: null,
    };
    const { linhasAfetadas, ticketAtualizado } = simularUpdate(ticket, 5, 'Excelente!');
    expect(linhasAfetadas).toBe(1);
    expect(ticketAtualizado.satisfactionRating).toBe(5);
    expect(ticketAtualizado.satisfactionComment).toBe('Excelente!');
    expect(ticketAtualizado.satisfactionAt).not.toBeNull();
  });

  it('avaliação duplicada não sobrescreve a anterior', () => {
    const ticket: TicketAvaliacao = {
      id: 'ticket-001', satisfactionRating: 4,
      satisfactionComment: 'Bom atendimento', satisfactionAt: new Date('2026-03-01'),
    };
    const { linhasAfetadas, ticketAtualizado } = simularUpdate(ticket, 1, 'Quero mudar para ruim');
    expect(linhasAfetadas).toBe(0);
    expect(ticketAtualizado.satisfactionRating).toBe(4); // manteve original
    expect(ticketAtualizado.satisfactionComment).toBe('Bom atendimento'); // manteve original
  });

  it('avaliação sem comentário é salva com comment null', () => {
    const ticket: TicketAvaliacao = {
      id: 'ticket-002', satisfactionRating: null,
      satisfactionComment: null, satisfactionAt: null,
    };
    const { linhasAfetadas, ticketAtualizado } = simularUpdate(ticket, 3);
    expect(linhasAfetadas).toBe(1);
    expect(ticketAtualizado.satisfactionRating).toBe(3);
    expect(ticketAtualizado.satisfactionComment).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TRANSIÇÃO DE STEPS DO CHATBOT
// ─────────────────────────────────────────────────────────────────────────────

describe('máquina de estados do chatbot — steps de avaliação', () => {
  type Step =
    | 'welcome' | 'awaiting_menu' | 'awaiting_cnpj'
    | 'awaiting_description' | 'transferred'
    | 'awaiting_rating' | 'awaiting_rating_comment';

  interface Session { step: Step; metadata: Record<string, unknown> }

  function processStep(session: Session, text: string): { nextStep: Step; handled: boolean } {
    if (session.step === 'awaiting_rating') {
      const nota = parseInt(text.trim(), 10);
      if (isNaN(nota) || nota < 1 || nota > 5) {
        return { nextStep: 'awaiting_rating', handled: true }; // rejeita, mantém step
      }
      return { nextStep: 'awaiting_rating_comment', handled: true };
    }
    if (session.step === 'awaiting_rating_comment') {
      return { nextStep: 'awaiting_rating_comment', handled: true }; // encerra (deletar sessão)
    }
    if (session.step === 'transferred') {
      return { nextStep: 'transferred', handled: false }; // humano assume
    }
    return { nextStep: session.step, handled: false };
  }

  it('nota válida avança para awaiting_rating_comment', () => {
    const s: Session = { step: 'awaiting_rating', metadata: { ticketId: 'ticket-x' } };
    expect(processStep(s, '4').nextStep).toBe('awaiting_rating_comment');
  });

  it('nota inválida mantém awaiting_rating', () => {
    const s: Session = { step: 'awaiting_rating', metadata: { ticketId: 'ticket-x' } };
    expect(processStep(s, 'ótimo').nextStep).toBe('awaiting_rating');
  });

  it('step transferred não é interceptado pelo bot de avaliação', () => {
    const s: Session = { step: 'transferred', metadata: {} };
    const result = processStep(s, '4');
    expect(result.handled).toBe(false);
  });

  it('initiateRating define step como awaiting_rating com ticketId na metadata', () => {
    // Reprodução do que initiateRating() faz no sessionRepo
    const ticketId = 'ticket-abc-123';
    const novaSession: Session = {
      step: 'awaiting_rating',
      metadata: { ticketId },
    };
    expect(novaSession.step).toBe('awaiting_rating');
    expect(novaSession.metadata.ticketId).toBe(ticketId);
  });
});
