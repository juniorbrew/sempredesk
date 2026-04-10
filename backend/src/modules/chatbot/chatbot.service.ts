import { Injectable, Logger, NotFoundException, Optional, OnModuleInit } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, DataSource } from 'typeorm';
import { ChatbotConfig } from './entities/chatbot-config.entity';
import { ChatbotMenuItem } from './entities/chatbot-menu-item.entity';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotWidgetMessage } from './entities/chatbot-widget-message.entity';
import { UpdateChatbotConfigDto, UpdateMenuDto, UpsertMenuItemDto, WidgetStartDto } from './dto/chatbot.dto';
import { CustomersService } from '../customers/customers.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationChannel } from '../conversations/entities/conversation.entity';
import { TicketSatisfactionService } from '../tickets/ticket-satisfaction.service';
import { v4 as uuidv4 } from 'uuid';
import { normalizeCnpj, validateCnpj } from '../../common/utils/cnpj.utils';
import { normalizeWhatsappNumber } from '../../common/utils/phone.utils';

export interface ProcessResult {
  handled: boolean;
  /** reply text(s) to send back — only meaningful when handled=true */
  replies: string[];
  /** when bot hands off to human */
  transfer?: {
    department?: string;
    senderName?: string;
    /** clientId detectado via CNPJ — para auto-vincular ao ticket */
    clientId?: string;
  };
}

// ── Constantes do chatbot ─────────────────────────────────────────────────────

const SKIP_KEYWORDS = ['pular', 'pulei', 'skip', 'não sei', 'nao sei', 'nao', 'não', 'sem cnpj', 'p'];

@Injectable()
export class ChatbotService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotService.name);

  /** Setter para BaileysService — injetado via AppModule.onModuleInit (evita circular dep) */
  private baileysService: { sendMessage(tenantId: string, to: string, text: string): Promise<void> } | null = null;
  setBaileysService(svc: { sendMessage(tenantId: string, to: string, text: string): Promise<void> }) {
    this.baileysService = svc;
  }

  constructor(
    @InjectRepository(ChatbotConfig) private configRepo: Repository<ChatbotConfig>,
    @InjectRepository(ChatbotMenuItem) private menuRepo: Repository<ChatbotMenuItem>,
    @InjectRepository(ChatbotSession) private sessionRepo: Repository<ChatbotSession>,
    @InjectRepository(ChatbotWidgetMessage) private widgetMsgRepo: Repository<ChatbotWidgetMessage>,
    @Optional() private readonly customersService: CustomersService,
    @Optional() private readonly conversationsService: ConversationsService,
    private readonly ticketSatisfactionService: TicketSatisfactionService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.dataSource.query(`
      ALTER TABLE chatbot_configs
        ADD COLUMN IF NOT EXISTS collect_name boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS name_request_message text NOT NULL DEFAULT 'Olá! Para começarmos, pode me informar seu nome completo?'
    `).catch((err: Error) => this.logger.warn('chatbot_configs schema migration skipped: ' + err.message));
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  async getOrCreateConfig(tenantId: string): Promise<ChatbotConfig> {
    let config = await this.configRepo.findOne({ where: { tenantId }, relations: ['menuItems'] });
    if (!config) {
      // Sempre criar desabilitado: chatbot só deve responder quando operador habilitar
      // explicitamente no painel. enabled=true por default causava bot genérico respondendo
      // por todas as empresas mesmo sem nenhuma configuração, bloqueando tickets.
      config = await this.configRepo.save(this.configRepo.create({
        tenantId,
        enabled: false,
        channelWhatsapp: false,
      }));
      await this.createDefaultMenu(tenantId, config.id);
      config = await this.configRepo.findOne({ where: { tenantId }, relations: ['menuItems'] });
    }
    if (config.menuItems) {
      config.menuItems.sort((a, b) => a.order - b.order);
    }
    return config;
  }

  async updateConfig(tenantId: string, dto: UpdateChatbotConfigDto): Promise<ChatbotConfig> {
    const config = await this.getOrCreateConfig(tenantId);
    Object.assign(config, dto);
    await this.configRepo.save(config);
    return this.getOrCreateConfig(tenantId);
  }

  async updateMenu(tenantId: string, dto: UpdateMenuDto): Promise<ChatbotMenuItem[]> {
    const config = await this.getOrCreateConfig(tenantId);

    // Delete removed items
    const incomingIds = dto.items.filter(i => i.id).map(i => i.id);
    const existing = await this.menuRepo.find({ where: { chatbotId: config.id } });
    const toDelete = existing.filter(e => !incomingIds.includes(e.id));
    if (toDelete.length) await this.menuRepo.remove(toDelete);

    const saved: ChatbotMenuItem[] = [];
    for (const item of dto.items) {
      if (item.id) {
        const existingItem = await this.menuRepo.findOne({ where: { id: item.id, chatbotId: config.id } });
        if (existingItem) {
          Object.assign(existingItem, { ...item, chatbotId: config.id, tenantId });
          saved.push(await this.menuRepo.save(existingItem));
          continue;
        }
      }
      saved.push(await this.menuRepo.save(this.menuRepo.create({
        ...item,
        id: undefined,
        chatbotId: config.id,
        tenantId,
      })));
    }
    return saved.sort((a, b) => a.order - b.order);
  }

  private async createDefaultMenu(tenantId: string, chatbotId: string): Promise<void> {
    const defaults = [
      { order: 1, label: '💰 Financeiro', action: 'transfer', department: 'Financeiro' },
      { order: 2, label: '🔧 Suporte Técnico', action: 'transfer', department: 'Suporte' },
      { order: 3, label: '🛒 Comercial / Vendas', action: 'transfer', department: 'Comercial' },
      { order: 4, label: '👤 Falar com atendente', action: 'transfer', department: null },
      { order: 5, label: '📋 Outros assuntos', action: 'transfer', department: null },
    ];
    for (const d of defaults) {
      await this.menuRepo.save(this.menuRepo.create({ ...d, tenantId, chatbotId, enabled: true }));
    }
  }

  // ─── Message Processing ────────────────────────────────────────────────────

  /**
   * Main entry point called by WhatsApp / web widget handlers.
   * Returns ProcessResult indicating whether bot handled the message and what replies to send.
   */
  async processMessage(
    tenantId: string,
    identifier: string,
    text: string,
    channel: 'whatsapp' | 'web' | 'portal' = 'whatsapp',
    senderName?: string,
    /**
     * ID do canal WhatsApp (whatsapp_connections.id) pelo qual esta mensagem chegou.
     * Persistido na ChatbotSession para contexto de roteamento e para garantir que
     * respostas do chatbot saiam pelo mesmo número que recebeu a mensagem.
     * Nullable — omitido em canais web/portal ou quando não aplicável.
     */
    whatsappChannelId?: string | null,
  ): Promise<ProcessResult> {
    const config = await this.getOrCreateConfig(tenantId);

    // Pré-busca sessão para detectar fluxos de avaliação em andamento.
    // Sessões de avaliação devem ser concluídas mesmo que o chatbot esteja desabilitado —
    // caso contrário, a resposta da nota cai no handleIncomingMessage e reabre o ticket.
    // Usa timeout estendido (1440 min = 24 h) para tolerância a respondentes lentos.
    let session = await this.getActiveSession(tenantId, identifier, channel, config.sessionTimeoutMinutes);
    if (!session || !['awaiting_rating', 'awaiting_rating_comment'].includes(session.step)) {
      const extended = await this.getActiveSession(tenantId, identifier, channel, 1440);
      if (extended && ['awaiting_rating', 'awaiting_rating_comment'].includes(extended.step)) {
        session = extended;
      }
    }
    const isRatingInProgress = session?.step === 'awaiting_rating' || session?.step === 'awaiting_rating_comment';

    if (!config.enabled && !isRatingInProgress) return { handled: false, replies: [] };
    if (channel === 'whatsapp' && !config.channelWhatsapp && !isRatingInProgress) return { handled: false, replies: [] };
    if (channel === 'web' && !config.channelWeb && !isRatingInProgress) return { handled: false, replies: [] };
    if (channel === 'portal' && !config.channelPortal && !isRatingInProgress) return { handled: false, replies: [] };

    if (channel === 'whatsapp') {
      this.logger.log(`[processMessage] identifier=${identifier} text=${JSON.stringify(text)} sessionStep=${session?.step ?? 'none'}`);
    }

    // New session or expired → pedir nome (se habilitado e sem nome) ou exibir menu
    if (!session || session.step === 'welcome') {
      const shouldAskName =
        config.collectName &&
        channel === 'whatsapp' &&
        !senderName?.trim();

      const initialStep = shouldAskName ? 'awaiting_name' : 'awaiting_menu';

      if (!session) {
        session = await this.sessionRepo.save(this.sessionRepo.create({
          tenantId,
          identifier,
          channel,
          step: initialStep,
          lastActivity: new Date(),
          // Preserva o canal de origem para roteamento/envio correto de respostas
          whatsappChannelId: whatsappChannelId ?? null,
        }));
      } else {
        session.step = initialStep;
        session.lastActivity = new Date();
        // Atualiza channelId se ainda não estava definido (sessão antiga pré-migração)
        if (!session.whatsappChannelId && whatsappChannelId) {
          session.whatsappChannelId = whatsappChannelId;
        }
        await this.sessionRepo.save(session);
      }

      if (shouldAskName) {
        return {
          handled: true,
          replies: [config.nameRequestMessage],
        };
      }

      return {
        handled: true,
        replies: [this.buildWelcome(config)],
      };
    }

    // ── Aguardando nome do contato ────────────────────────────────────────────
    if (session.step === 'awaiting_name') {
      const name = text.trim();
      if (name.length < 2) {
        await this.touchSession(session);
        return { handled: true, replies: ['Por favor, informe seu nome completo (mínimo 2 caracteres).'] };
      }

      // Atualiza o nome do contato no banco (se o contato já existe com nome vazio/numérico)
      if (this.customersService) {
        try {
          const contact = await this.customersService.findContactByWhatsapp(tenantId, identifier);
          if (contact) {
            const currentName = contact.name ?? '';
            const looksLikePhone = !currentName.trim() || /^\+?\d[\d\s\-().]+$/.test(currentName.trim());
            if (looksLikePhone) {
              await this.dataSource.query(
                `UPDATE contacts SET name = $1 WHERE id = $2 AND tenant_id = $3`,
                [name, contact.id, tenantId],
              ).catch(() => {});
            }
          }
        } catch {
          // ignora — não bloqueia o fluxo
        }
      }

      // Avança para o menu, usando o nome coletado como senderName
      session.step = 'awaiting_menu';
      session.metadata = { senderName: name };
      session.lastActivity = new Date();
      await this.sessionRepo.save(session);

      return {
        handled: true,
        replies: [`Obrigado, ${name}! ` + this.buildWelcome(config)],
      };
    }

    // Already transferred to human — don't intercept
    if (session.step === 'transferred') {
      if (channel === 'whatsapp' && this.customersService) {
        const normalizedIdentifier = normalizeWhatsappNumber(identifier) || identifier.replace(/\D/g, '');
        const looksTechnicalIdentifier = identifier.includes('@') || normalizedIdentifier.length >= 14;
        if (looksTechnicalIdentifier) {
          const canonical = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
            rawWhatsapp: identifier,
            normalizedWhatsapp: normalizedIdentifier,
            lid: normalizedIdentifier,
            direction: 'inbound',
          }).catch(() => null);

          const blockedTechnicalOnly = canonical?.canonicalReason?.includes('blocked-technical-only') ?? false;
          if (!canonical?.contact && blockedTechnicalOnly) {
            this.logger.warn(
              `[processMessage] resetting orphan transferred session for technical identifier=${identifier}`,
            );
            session.step = 'awaiting_menu';
            session.lastActivity = new Date();
            await this.sessionRepo.save(session);
            return {
              handled: true,
              replies: [this.buildWelcome(config)],
            };
          }
        }
      }
      await this.touchSession(session);
      return { handled: false, replies: [] };
    }

    // ── Avaliação: aguardando nota 1–5 ────────────────────────────────────────
    if (session.step === 'awaiting_rating') {
      const nota = parseInt(text.trim(), 10);
      if (isNaN(nota) || nota < 1 || nota > 5) {
        await this.touchSession(session);
        const aviso = 'Por favor, responda com um número de 1 a 5. 😊';
        const pedido =
          config.ratingRequestMessage ||
          'Como você avalia nosso atendimento?\n\n1 - ⭐ Muito ruim\n2 - ⭐⭐ Ruim\n3 - ⭐⭐⭐ Regular\n4 - ⭐⭐⭐⭐ Bom\n5 - ⭐⭐⭐⭐⭐ Excelente';
        return { handled: true, replies: [`${aviso}\n\n${pedido}`] };
      }
      // Nota válida → guarda na metadata e avança para comentário
      const ratingIdentifiers = channel === 'whatsapp' && this.customersService
        ? await this.customersService.getWhatsappSessionIdentifiers(tenantId, identifier).catch(() => [identifier])
        : [identifier];
      const ratingSessions = await this.sessionRepo.find({
        where: ratingIdentifiers.map((currentIdentifier) => ({ tenantId, identifier: currentIdentifier, channel })) as any,
      });
      const sessionsToAdvance = ratingSessions.length ? ratingSessions : [session];
      for (const currentSession of sessionsToAdvance) {
        currentSession.metadata = { ...((currentSession.metadata as Record<string, unknown>) ?? {}), rating: nota };
        currentSession.step = 'awaiting_rating_comment';
        currentSession.lastActivity = new Date();
        await this.sessionRepo.save(currentSession);
      }
      const msgComentario =
        config.ratingCommentMessage ||
        'Obrigado pela nota! 🙏 Gostaria de deixar um comentário? (Responda com o texto ou envie *pular* para finalizar.)';
      return { handled: true, replies: [msgComentario] };
    }

    // ── Avaliação: aguardando comentário opcional ─────────────────────────────
    if (session.step === 'awaiting_rating_comment') {
      const meta = (session.metadata as Record<string, unknown>) ?? {};
      const ticketId = meta.ticketId as string | undefined;
      const rating   = meta.rating   as number | undefined;

      const SKIP = ['pular', 'pulei', 'skip', 'não', 'nao', 'n', '0', '-', 'sem comentário', 'sem comentario'];
      const comment = SKIP.includes(text.trim().toLowerCase()) ? null : text.trim();

      if (ticketId && rating) {
        await this.saveWhatsappRating(tenantId, ticketId, rating, comment ?? undefined).catch(() => {});
      }
      const ratingIdentifiers = channel === 'whatsapp' && this.customersService
        ? await this.customersService.getWhatsappSessionIdentifiers(tenantId, identifier).catch(() => [identifier])
        : [identifier];
      await this.sessionRepo.delete(ratingIdentifiers.map((currentIdentifier) => ({ tenantId, identifier: currentIdentifier, channel })) as any);

      const obrigado =
        config.ratingThanksMessage || 'Obrigado pela avaliação! 😊 Até a próxima.';
      return { handled: true, replies: [obrigado] };
    }

    // Awaiting menu selection
    if (session.step === 'awaiting_menu') {
      // Prioriza nome coletado pelo step awaiting_name (salvo na metadata da sessão)
      const sessionMeta = (session.metadata ?? {}) as Record<string, unknown>;
      const resolvedSenderName = (sessionMeta.senderName as string | null) ?? senderName ?? null;

      const trimmed = text.trim();
      const num = parseInt(trimmed, 10);
      const items = (config.menuItems || []).filter(i => i.enabled).sort((a, b) => a.order - b.order);
      const chosen = items.find(i => i.order === num);

      if (!chosen) {
        await this.touchSession(session);
        return {
          handled: true,
          replies: [`${config.invalidOptionMessage}\n\n${this.buildMenuBody(config)}`],
        };
      }

      await this.touchSession(session);

      if (chosen.action === 'auto_reply') {
        return {
          handled: true,
          replies: [
            chosen.autoReplyText || 'Obrigado pelo contato!',
            `Se precisar de mais ajuda:\n\n${this.buildMenuBody(config)}`,
          ],
        };
      }

      const selectedLabel = chosen.label?.trim() || chosen.department?.trim() || null;

      // Transfer to human — verificar se contato já tem empresa vinculada
      let knownClientId: string | null = null;
      let knownClientName: string | null = null;
      let hasMultipleLinkedClients = false;
      if (this.customersService) {
        const existingContact = await this.customersService.findContactByWhatsapp(tenantId, identifier).catch(() => null);
        const resolution = await this.customersService.resolveClientForSupportIdentifier(tenantId, identifier).catch(() => ({ mode: 'none' as const }));
        if (resolution.mode === 'single') {
            const rows = await this.sessionRepo.manager.query<{ id: string; company_name: string; trade_name: string | null; metadata: any }[]>(
              `SELECT id, company_name, trade_name, metadata
                 FROM clients
                WHERE id::text = $1
                  AND tenant_id::text = $2
                LIMIT 1`,
              [resolution.clientId, tenantId],
            ).catch(() => []);
            const row = rows[0];
            if (row && row.metadata?.autoCreated !== true && row.metadata?.autoCreated !== 'true') {
              knownClientId = row.id;
              knownClientName = row.trade_name?.trim() || row.company_name?.trim() || null;
            }
        } else if (resolution.mode === 'multiple') {
          hasMultipleLinkedClients = true;
        }
        if (false && existingContact?.id) {
          // Verificar se o cliente não é auto-criado
          const clients = await this.customersService.searchByNameOrCnpj(tenantId, existingContact.clientId).catch(() => []);
          // Busca direta pelo id
          const rows = await this.sessionRepo.manager.query<{ id: string; company_name: string; trade_name: string | null; metadata: any }[]>(
            `SELECT id, company_name, trade_name, metadata FROM clients WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
            [existingContact.clientId, tenantId],
          ).catch(() => []);
          const row = rows[0];
          if (row && row.metadata?.autoCreated !== true && row.metadata?.autoCreated !== 'true') {
            knownClientId = row.id;
            knownClientName = row.trade_name?.trim() || row.company_name?.trim() || null;
          }
          void clients; // suppress unused warning
        }
      }

      // Se empresa já conhecida → pular CNPJ, ir direto para descrição
      if (knownClientId) {
        const prefixMsg = knownClientName
          ? `Empresa identificada: *${knownClientName}*.\n`
          : undefined;
        return this.goToDescriptionStep(session, config, {
          pendingDepartment: chosen.department ?? null,
          pendingMenuLabel: selectedLabel,
          senderName: resolvedSenderName,
          pendingClientId: knownClientId,
        }, prefixMsg);
      }

      if (hasMultipleLinkedClients && this.customersService) {
        session.step = 'awaiting_cnpj';
        session.metadata = {
          pendingDepartment: chosen.department ?? null,
          pendingMenuLabel: selectedLabel,
          senderName: resolvedSenderName,
          cnpjAttempts: 0,
        };
        await this.sessionRepo.save(session);
        return {
          handled: true,
          replies: ['Identificamos mais de uma empresa vinculada a este contato. Informe o CNPJ da empresa que deseja atendimento.'],
        };
      }

      // Pedir CNPJ se habilitado
      if (config.collectCnpj && this.customersService) {
        session.step = 'awaiting_cnpj';
        session.metadata = {
          pendingDepartment: chosen.department ?? null,
          pendingMenuLabel: selectedLabel,
          senderName: resolvedSenderName,
          cnpjAttempts: 0,
        };
        await this.sessionRepo.save(session);
        return { handled: true, replies: [config.cnpjRequestMessage] };
      }

      // collectCnpj desabilitado → pedir descrição
      return this.goToDescriptionStep(session, config, {
        pendingDepartment: chosen.department ?? null,
        pendingMenuLabel: selectedLabel,
        senderName: resolvedSenderName,
        pendingClientId: null,
      });
    }

    // ── Aguardando CNPJ ──────────────────────────────────────────────────────
    if (session.step === 'awaiting_cnpj') {
      const meta = (session.metadata ?? {}) as Record<string, unknown>;
      const pendingDepartment = meta.pendingDepartment as string | null;
      const pendingMenuLabel = meta.pendingMenuLabel as string | null;
      const storedSenderName = (meta.senderName as string | null) ?? senderName;
      const attempts = (meta.cnpjAttempts as number) ?? 0;
      const trimmed = text.trim().toLowerCase();

      const goToDesc = (clientId: string | null, prefixMsg?: string, trustedSelection = false) =>
        this.goToDescriptionStep(session, config, {
          pendingDepartment,
          pendingMenuLabel,
          senderName: storedSenderName,
          pendingClientId: clientId,
          pendingClientIdTrusted: trustedSelection,
        }, prefixMsg);

      // Usuário quer pular
      if (SKIP_KEYWORDS.includes(trimmed)) return goToDesc(null);

      // Extrai apenas dígitos do texto para análise de CNPJ
      const digits = text.replace(/\D/g, '');

      // Busca por nome (texto livre, não parece CNPJ)
      if (digits.length !== 14 && digits.length < 8) {
        if (this.customersService && text.trim().length >= 3) {
          const found = await this.customersService.searchByNameOrCnpj(tenantId, text.trim()).catch(() => []);
          if (found.length === 1) {
            return goToDesc(
              found[0].id,
              `Empresa identificada: *${found[0].tradeName || found[0].companyName}*.\n`,
              true,
            );
          }
        }
        if (attempts < 1) {
          session.metadata = { ...meta, cnpjAttempts: attempts + 1 };
          await this.sessionRepo.save(session);
          return { handled: true, replies: ['CNPJ inválido. Informe 14 dígitos ou responda *pular*:'] };
        }
        return goToDesc(null, `${config.cnpjNotFoundMessage}\n`);
      }

      // Busca direta com os 14 dígitos — mesma lógica do menu de cliente, que não valida
      // matematicamente antes de buscar. O importante é encontrar o cliente cadastrado,
      // independentemente de o CNPJ passar ou não pelo algoritmo de dígitos verificadores.
      const results = await this.customersService!.searchByNameOrCnpj(tenantId, digits).catch(() => []);
      const match = results.find(r => normalizeCnpj(r.cnpj ?? '') === digits);

      if (match) {
        return goToDesc(
          match.id,
          `Empresa identificada: *${match.tradeName || match.companyName}*.\n`,
          true,
        );
      }

      // Não encontrado — dar feedback contextualizado ao usuário
      // Se o CNPJ nem é matematicamente válido, provável erro de digitação
      if (!validateCnpj(digits)) {
        if (attempts < 1) {
          session.metadata = { ...meta, cnpjAttempts: attempts + 1 };
          await this.sessionRepo.save(session);
          return { handled: true, replies: ['CNPJ inválido. Verifique os dígitos e tente novamente ou responda *pular*:'] };
        }
      }

      return goToDesc(null, `${config.cnpjNotFoundMessage}\n`);
    }

    // ── Aguardando descrição da demanda ───────────────────────────────────────
    if (session.step === 'awaiting_description') {
      const meta = (session.metadata ?? {}) as Record<string, unknown>;
      const pendingDepartment = meta.pendingDepartment as string | null;
      const storedSenderName = (meta.senderName as string | null) ?? senderName;
      const pendingClientId = await this.resolveTrustedPendingClientId(
        tenantId,
        identifier,
        meta.pendingClientId as string | null,
        meta.pendingClientIdTrusted === true,
      );

      session.step = 'transferred';
      session.metadata = null;
      await this.sessionRepo.save(session);

      // A própria mensagem do usuário vira o firstMessage/assunto do ticket
      return {
        handled: true,
        replies: [config.transferMessage],
        transfer: {
          department: pendingDepartment ?? undefined,
          senderName: storedSenderName ?? undefined,
          clientId: pendingClientId ?? undefined,
        },
      };
    }

    return { handled: false, replies: [] };
  }

  /** Transiciona sessão para awaiting_description e retorna resposta do bot */
  private async goToDescriptionStep(
    session: ChatbotSession,
    config: ChatbotConfig,
    meta: {
      pendingDepartment: string | null;
      pendingMenuLabel: string | null;
      senderName: string | null;
      pendingClientId: string | null;
      pendingClientIdTrusted?: boolean;
    },
    prefixMsg?: string,
  ): Promise<ProcessResult> {
    session.step = 'awaiting_description';
    session.metadata = {
      pendingDepartment: meta.pendingDepartment,
      pendingMenuLabel: meta.pendingMenuLabel,
      senderName: meta.senderName,
      pendingClientId: meta.pendingClientId,
      pendingClientIdTrusted: meta.pendingClientIdTrusted === true,
      descriptionStartedAt: new Date().toISOString(),
    };
    await this.sessionRepo.save(session);
    const selectionPrefix = meta.pendingMenuLabel
      ? `Você selecionou: *${meta.pendingMenuLabel}*.\n`
      : '';
    const msg = `${prefixMsg ?? ''}${selectionPrefix}${config.descriptionRequestMessage}`;
    return { handled: true, replies: [msg] };
  }

  private async resolveTrustedPendingClientId(
    tenantId: string,
    identifier: string,
    pendingClientId: string | null,
    pendingClientIdTrusted = false,
  ): Promise<string | null> {
    if (!pendingClientId || !this.customersService) return pendingClientId;

    const digits = identifier.replace(/\D/g, '');
    const normalizedWhatsapp = normalizeWhatsappNumber(digits) || digits;
    const isTechnicalIdentifier = identifier.includes('@') || normalizedWhatsapp.length >= 14;
    if (!isTechnicalIdentifier) return pendingClientId;
    if (pendingClientIdTrusted) {
      this.logger.log(
        `[resolveTrustedPendingClientId] Mantendo pendingClientId confiável para identificador técnico: ${identifier}`,
      );
      return pendingClientId;
    }

    const canonical = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
      rawWhatsapp: identifier,
      normalizedWhatsapp,
      lid: normalizedWhatsapp,
      clientId: pendingClientId,
      direction: 'inbound',
    }).catch(() => null);

    const blockedTechnicalOnly = canonical?.canonicalReason?.includes('blocked-technical-only') ?? false;
    if (!canonical?.contact || blockedTechnicalOnly) {
      this.logger.warn(
        `[resolveTrustedPendingClientId] Ignorando pendingClientId para identificador técnico sem contato canônico confiável: ${identifier}`,
      );
      return null;
    }

    return pendingClientId;
  }

  /**
   * Cron: auto-transfere sessões que ficaram em awaiting_description por mais de X minutos sem resposta.
   * Chamado pelo ChatbotScheduler a cada minuto.
   */
  async runDescriptionTimeoutCron(): Promise<void> {
    if (!this.customersService || !this.conversationsService) return;

    // Busca todos os tenants com sessões travadas
    const cutoff = new Date(Date.now() - 3 * 60 * 1000); // 3 min atrás
    const staleSessions = await this.sessionRepo.find({
      where: { step: 'awaiting_description', lastActivity: LessThan(cutoff) },
    });

    if (!staleSessions.length) return;
    this.logger.log(`ChatbotScheduler: ${staleSessions.length} sessões em timeout de descrição`);

      for (const session of staleSessions) {
        try {
          const tenantId = session.tenantId;
          const meta = (session.metadata ?? {}) as Record<string, unknown>;
          const pendingDepartment = meta.pendingDepartment as string | null;
          const pendingClientId = await this.resolveTrustedPendingClientId(
            tenantId,
            session.identifier,
            meta.pendingClientId as string | null,
            meta.pendingClientIdTrusted === true,
          );

        // Marcar como transferida
        session.step = 'transferred';
        session.metadata = null;
        await this.sessionRepo.save(session);

        // Enviar mensagem de timeout via WhatsApp (se BaileysService disponível)
        if (this.baileysService) {
          const config = await this.getOrCreateConfig(tenantId).catch(() => null);
          const msg = config?.transferMessage ?? 'Transferindo para um atendente...';
          await this.baileysService.sendMessage(tenantId, session.identifier, msg).catch(() => {});
        }

        // Criar conversa/ticket automaticamente
        const contact = await this.customersService!.findContactByWhatsapp(tenantId, session.identifier).catch(() => null);
        if (contact?.id) {
          let resolvedClientId = pendingClientId ?? null;
          if (!resolvedClientId) {
            const resolution = await this.customersService.resolveClientForSupportIdentifier(tenantId, session.identifier).catch(() => ({ mode: 'none' as const }));
            if (resolution.mode === 'single') {
              resolvedClientId = resolution.clientId;
            }
          }
          if (!resolvedClientId) continue;
          await this.conversationsService!.getOrCreateForContact(
            tenantId,
            resolvedClientId,
            contact.id,
            ConversationChannel.WHATSAPP,
            {
              firstMessage: 'Atendimento solicitado (sem descrição informada)',
              contactName: contact.name || session.identifier,
              department: pendingDepartment ?? undefined,
            } as any,
          ).catch((e) => this.logger.warn(`Auto-transfer failed for session ${session.id}`, e));
        }
      } catch (e) {
        this.logger.warn(`Failed to auto-transfer session ${session.id}`, e);
      }
    }
  }

  /** Reset session so bot engages again (e.g. conversation closed) */
  async resetSession(tenantId: string, identifier: string, channel = 'whatsapp'): Promise<void> {
    this.logger.log(`[resetSession] tenantId=${tenantId} identifier=${identifier} channel=${channel}`);
    await this.sessionRepo.delete({ tenantId, identifier, channel });
  }

  /**
   * Inicia o fluxo de avaliação ao encerrar atendimento via WhatsApp.
   * Define sessão como 'awaiting_rating' e dispara a mensagem de solicitação
   * via callback outboundSend (fornecido por ConversationsService).
   * Não reseta a sessão — o fluxo de avaliação tratará o encerramento.
   */
  async initiateRating(
    tenantId: string,
    identifier: string,
    ticketId: string,
    channel: string,
    outboundSend: (text: string) => Promise<void>,
  ): Promise<void> {
    const config = await this.getOrCreateConfig(tenantId).catch(() => null);
    const DEFAULT_REQUEST =
      'Seu atendimento foi encerrado! Como você avalia nosso suporte?\n\n' +
      '1 - ⭐ Muito ruim\n2 - ⭐⭐ Ruim\n3 - ⭐⭐⭐ Regular\n' +
      '4 - ⭐⭐⭐⭐ Bom\n5 - ⭐⭐⭐⭐⭐ Excelente';
    const message = config?.ratingRequestMessage || DEFAULT_REQUEST;

    // Upsert session → awaiting_rating
    const ratingIdentifiers = channel === 'whatsapp' && this.customersService
      ? await this.customersService.getWhatsappSessionIdentifiers(tenantId, identifier).catch(() => [identifier])
      : [identifier];
    this.logger.log(`[initiateRating] ticketId=${ticketId} identifier=${identifier} aliases=${ratingIdentifiers.join(',')}`);
    for (const currentIdentifier of ratingIdentifiers) {
      let session = await this.sessionRepo.findOne({ where: { tenantId, identifier: currentIdentifier, channel } });
      if (!session) {
        session = this.sessionRepo.create({
          tenantId, identifier: currentIdentifier, channel,
          step: 'awaiting_rating',
          metadata: { ticketId },
          lastActivity: new Date(),
        });
      } else {
        session.step = 'awaiting_rating';
        session.metadata = { ...((session.metadata as Record<string, unknown>) ?? {}), ticketId };
        session.lastActivity = new Date();
      }
      await this.sessionRepo.save(session);
      this.logger.log(`[initiateRating] saved session identifier=${currentIdentifier} step=${session.step} sessionId=${session.id}`);
    }
    try {
      await outboundSend(message);
    } catch (error) {
      this.logger.warn(`Falha ao enviar mensagem de avaliação para ${identifier}`, error as any);
    }
  }

  /**
   * Persiste a nota (1–5) e comentário opcional na tabela tickets.
   * Ignora silenciosamente se o ticket já foi avaliado (prevenção de duplicidade).
   */
  private async saveWhatsappRating(
    tenantId: string,
    ticketId: string,
    rating: number,
    comment?: string,
  ): Promise<void> {
    await this.ticketSatisfactionService.applyWhatsappRating(ticketId, tenantId, rating, comment);
  }

  private async getActiveSession(
    tenantId: string,
    identifier: string,
    channel: string,
    timeoutMinutes: number,
  ): Promise<ChatbotSession | null> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const direct = await this.sessionRepo.findOne({
      where: { tenantId, identifier, channel, lastActivity: MoreThan(cutoff) },
      order: { lastActivity: 'DESC' },
    });
    if (direct) return direct;

    if (!this.customersService || channel !== 'whatsapp') return null;

    const identifiers = await this.customersService.getWhatsappSessionIdentifiers(tenantId, identifier).catch(() => [identifier]);

    if (!identifiers.length) return null;

    return this.sessionRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.channel = :channel', { channel })
      .andWhere('s.last_activity > :cutoff', { cutoff })
      .andWhere('s.identifier IN (:...identifiers)', { identifiers })
      .orderBy('s.last_activity', 'DESC')
      .getOne();
  }

  private async touchSession(session: ChatbotSession): Promise<void> {
    session.lastActivity = new Date();
    await this.sessionRepo.save(session);
  }

  private buildWelcome(config: ChatbotConfig): string {
    return `${config.welcomeMessage}\n\n${config.menuTitle}\n\n${this.buildMenuBody(config)}`;
  }

  private buildMenuBody(config: ChatbotConfig): string {
    const items = (config.menuItems || []).filter(i => i.enabled).sort((a, b) => a.order - b.order);
    return items.map(i => `${i.order}. ${i.label}`).join('\n');
  }

  // ─── Web Widget ─────────────────────────────────────────────────────────────

  async widgetStart(tenantId: string, dto: WidgetStartDto): Promise<{ sessionId: string; messages: ChatbotWidgetMessage[] }> {
    const sessionId = uuidv4();
    const session = await this.sessionRepo.save(this.sessionRepo.create({
      tenantId,
      identifier: sessionId,
      channel: 'web',
      step: 'welcome',
      lastActivity: new Date(),
    }));

    const config = await this.getOrCreateConfig(tenantId);
    const welcome = this.buildWelcome(config);
    await this.saveWidgetMessage(tenantId, sessionId, 'bot', welcome);
    session.step = 'awaiting_menu';
    await this.sessionRepo.save(session);

    const messages = await this.widgetMsgRepo.find({
      where: { tenantId, sessionId },
      order: { createdAt: 'ASC' },
    });

    return { sessionId, messages };
  }

  async widgetMessage(tenantId: string, sessionId: string, text: string): Promise<{ messages: ChatbotWidgetMessage[] }> {
    // Save user message
    await this.saveWidgetMessage(tenantId, sessionId, 'user', text);

    // Process through bot
    const result = await this.processMessage(tenantId, sessionId, text, 'web');

    if (result.handled) {
      for (const reply of result.replies) {
        await this.saveWidgetMessage(tenantId, sessionId, 'bot', reply);
      }
    } else {
      // Transferred or no bot — agent reply will be stored by conversation service
      if (!result.transfer) {
        await this.saveWidgetMessage(tenantId, sessionId, 'bot', 'Conectando com um atendente...');
      }
    }

    const messages = await this.widgetMsgRepo.find({
      where: { tenantId, sessionId },
      order: { createdAt: 'ASC' },
    });

    return { messages };
  }

  async widgetPoll(tenantId: string, sessionId: string, since: string): Promise<ChatbotWidgetMessage[]> {
    const sinceDate = since ? new Date(since) : new Date(0);
    return this.widgetMsgRepo.find({
      where: { tenantId, sessionId, createdAt: MoreThan(sinceDate) },
      order: { createdAt: 'ASC' },
    });
  }

  async saveWidgetMessage(tenantId: string, sessionId: string, role: string, content: string): Promise<void> {
    await this.widgetMsgRepo.save(this.widgetMsgRepo.create({ tenantId, sessionId, role, content }));
  }

  async getWidgetConfig(tenantId: string): Promise<Partial<ChatbotConfig>> {
    const config = await this.getOrCreateConfig(tenantId);
    // Return only public-safe fields
    return {
      name: config.name,
      welcomeMessage: config.welcomeMessage,
      menuTitle: config.menuTitle,
      enabled: config.enabled,
      channelWeb: config.channelWeb,
    };
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats(tenantId: string): Promise<{ totalSessions: number; activeSessions: number; transferred: number }> {
    const totalSessions = await this.sessionRepo.count({ where: { tenantId } });
    const activeSessions = await this.sessionRepo.count({
      where: { tenantId, lastActivity: MoreThan(new Date(Date.now() - 30 * 60 * 1000)) },
    });
    const transferred = await this.sessionRepo.count({ where: { tenantId, step: 'transferred' } });
    return { totalSessions, activeSessions, transferred };
  }
}
