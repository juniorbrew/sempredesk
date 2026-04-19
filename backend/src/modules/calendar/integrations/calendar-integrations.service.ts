/**
 * CalendarIntegrationsService
 * ───────────────────────────
 * Orquestra o ciclo completo de integração com Google Calendar e Microsoft Outlook:
 *   1. Início do OAuth → URL de autorização
 *   2. Callback OAuth → troca de código, criptografia e salvamento de tokens
 *   3. Listagem de integrações conectadas
 *   4. Listagem de calendários do provider
 *   5. Sincronização (importação) de eventos externos → calendar_events
 *   6. Desconexão de conta
 *
 * Fase 4.1 — somente LEITURA. Sem escrita no provider, sem sync bidirecional.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarIntegration } from '../entities/calendar-integration.entity';
import { CalendarSyncLog }      from '../entities/calendar-sync-log.entity';
import { CalendarEvent }        from '../entities/calendar-event.entity';
import { CalendarCryptoService }      from '../crypto/calendar-crypto.service';
import { GoogleCalendarAdapter }      from '../adapters/google-calendar.adapter';
import { MicrosoftCalendarAdapter }   from '../adapters/microsoft-calendar.adapter';
import { SyncCalendarDto }            from './dto/integration.dto';

@Injectable()
export class CalendarIntegrationsService {
  private readonly logger = new Logger(CalendarIntegrationsService.name);

  /** Buffer antes de expiração para forçar refresh antecipado (5 minutos). */
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  constructor(
    @InjectRepository(CalendarIntegration)
    private readonly integrationRepo: Repository<CalendarIntegration>,

    @InjectRepository(CalendarSyncLog)
    private readonly syncLogRepo: Repository<CalendarSyncLog>,

    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,

    private readonly crypto:    CalendarCryptoService,
    private readonly google:    GoogleCalendarAdapter,
    private readonly microsoft: MicrosoftCalendarAdapter,

    private readonly cfg: ConfigService,
  ) {}

  // ─── OAUTH: INÍCIO ──────────────────────────────────────────────────────────

  /**
   * Gera a URL de autorização OAuth para o provider solicitado.
   * O state é um token HMAC assinado contendo tenantId, userId, provider
   * e returnHost — o hostname do frontend que iniciou o fluxo.
   * O returnHost é usado no callback para redirecionar de volta ao subdomínio
   * correto da empresa (multi-tenant por subdomínio).
   *
   * @param returnHost  hostname sem protocolo (ex.: "techcorp.sempredesk.com.br")
   */
  buildAuthUrl(
    provider: 'google' | 'outlook',
    tenantId: string,
    userId: string,
    returnHost = '',
  ): string {
    const adapter = this.getAdapter(provider);
    if (!adapter.isConfigured()) {
      throw new BadRequestException(
        `Integração com ${provider} não está configurada neste servidor. ` +
        `Configure as variáveis ${provider === 'google' ? 'GOOGLE_CLIENT_ID/SECRET' : 'MICROSOFT_CLIENT_ID/SECRET'}.`,
      );
    }
    const state = this.crypto.generateState({ tenantId, userId, provider, returnHost });
    return adapter.buildAuthUrl(state);
  }

  /**
   * Valida que o returnHost do state pertence a um domínio permitido.
   * Impede open-redirect: só redireciona para subdomínios do BASE_DOMAIN
   * ou para o APP_FRONTEND_URL (fallback central).
   */
  private isSafeReturnHost(host: string, baseDomain: string): boolean {
    if (!host) return false;
    const clean = host.split(':')[0].toLowerCase();
    // Permite localhost para desenvolvimento
    if (clean === 'localhost') return true;
    // Permite o baseDomain e qualquer subdomínio de nível único
    if (clean === baseDomain) return true;
    if (clean.endsWith(`.${baseDomain}`) && !clean.slice(0, -baseDomain.length - 1).includes('.')) {
      return true;
    }
    return false;
  }

  // ─── OAUTH: CALLBACK ────────────────────────────────────────────────────────

  /**
   * Processa o callback OAuth:
   * 1. Valida o state (CSRF)
   * 2. Troca o code por tokens
   * 3. Criptografa e salva no banco
   * Retorna a URL de redirecionamento para o frontend.
   */
  async handleCallback(
    provider: 'google' | 'outlook',
    code: string,
    state: string,
  ): Promise<{ redirectUrl: string; integration: CalendarIntegration }> {
    // 1. Validar state
    let payload: Record<string, string>;
    try {
      payload = this.crypto.verifyState(state);
    } catch (e) {
      throw new BadRequestException('State OAuth inválido. Tente conectar novamente.');
    }

    const { tenantId, userId, returnHost } = payload;

    // 2. Trocar code por tokens
    let tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date; email: string };
    try {
      if (provider === 'google') {
        tokens = await this.google.exchangeCode(code);
      } else {
        tokens = await this.microsoft.exchangeCode(code);
      }
    } catch (e: any) {
      this.logger.error(`Erro ao trocar código OAuth (${provider}):`, e?.response?.data ?? e?.message);
      throw new BadRequestException(`Falha na autenticação com ${provider}. Tente novamente.`);
    }

    // 3. Upsert na tabela calendar_integrations (unique: tenantId + userId + provider)
    let integration = await this.integrationRepo.findOne({
      where: { tenantId, userId, provider },
    });

    if (!integration) {
      integration = this.integrationRepo.create({ tenantId, userId, provider });
    }

    integration.providerAccount  = tokens.email;
    integration.accessTokenEnc   = this.crypto.encrypt(tokens.accessToken);
    integration.refreshTokenEnc  = tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null;
    integration.tokenExpiresAt   = tokens.expiresAt;
    integration.status           = 'active';
    integration.syncEnabled      = true;

    await this.integrationRepo.save(integration);

    // ── Resolve a URL de redirect para o subdomínio correto do tenant ─────────
    // Se o state contém um returnHost válido (hostname do frontend que iniciou o
    // fluxo OAuth), redireciona de volta para o subdomínio da empresa.
    // Fallback: APP_FRONTEND_URL (domínio central, retrocompatível).
    const baseDomain = this.cfg.get<string>('BASE_DOMAIN', 'sempredesk.com.br');
    const fallbackUrl = this.cfg.get<string>('APP_FRONTEND_URL', 'http://localhost:3000');
    let frontendUrl: string;

    if (returnHost && this.isSafeReturnHost(returnHost, baseDomain)) {
      // Usa https em produção; http apenas para localhost
      const proto = returnHost.startsWith('localhost') ? 'http' : 'https';
      frontendUrl = `${proto}://${returnHost}`;
      this.logger.debug(`OAuth callback redirecionando para subdomínio: ${frontendUrl}`);
    } else {
      frontendUrl = fallbackUrl;
      if (returnHost) {
        this.logger.warn(
          `returnHost "${returnHost}" rejeitado (fora de ${baseDomain}). Usando fallback ${fallbackUrl}.`,
        );
      }
    }

    const redirectUrl = `${frontendUrl}/dashboard/agenda/integracoes?integration=connected&provider=${provider}`;

    return { redirectUrl, integration };
  }

  // ─── LISTAGEM DE INTEGRAÇÕES ─────────────────────────────────────────────────

  async listIntegrations(tenantId: string, userId: string): Promise<CalendarIntegration[]> {
    return this.integrationRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      // Nota: access_token_enc e refresh_token_enc têm select: false na entidade.
      // Nunca são expostos nesta listagem.
    });
  }

  // ─── LISTAGEM DE CALENDÁRIOS DO PROVIDER ─────────────────────────────────────

  async listProviderCalendars(integrationId: string, tenantId: string, userId: string) {
    const integration = await this.getIntegrationOrFail(integrationId, tenantId, userId);
    const accessToken = await this.getValidAccessToken(integration);

    if (integration.provider === 'google') {
      return this.google.listCalendars(accessToken);
    } else {
      return this.microsoft.listCalendars(accessToken);
    }
  }

  // ─── SINCRONIZAÇÃO (IMPORTAÇÃO DE EVENTOS) ──────────────────────────────────

  /**
   * Importa eventos do provider para o banco local.
   * - Fase 4.1: janela de tempo estática (passado + futuro configuráveis)
   * - Fase 4.2: usar syncToken/deltaLink para sync incremental
   *
   * Upsert por (tenantId, provider, providerEventId) → nunca duplica.
   * Eventos cancelados pelo provider → marcados como 'cancelled' no local.
   */
  async syncEvents(
    integrationId: string,
    tenantId: string,
    userId: string,
    dto: SyncCalendarDto,
  ): Promise<{ imported: number; updated: number; cancelled: number; errors: number }> {
    const integration = await this.getIntegrationOrFail(integrationId, tenantId, userId);
    const accessToken = await this.getValidAccessToken(integration);

    const daysBack    = dto.daysBack    ?? 30;
    const daysForward = dto.daysForward ?? 90;
    const now         = new Date();
    const timeMin     = new Date(now.getTime() - daysBack * 86400000).toISOString();
    const timeMax     = new Date(now.getTime() + daysForward * 86400000).toISOString();

    const syncLog = this.syncLogRepo.create({
      tenantId,
      integrationId,
      provider:  integration.provider,
      direction: 'inbound',
      status:    'error',  // atualizado ao final
      eventsSynced: 0,
    });

    let imported  = 0;
    let updated   = 0;
    let cancelled = 0;
    let errors    = 0;

    try {
      // Determinar calendário a sincronizar
      let calendarId = dto.calendarId ?? integration.providerCalendarId;
      if (!calendarId) {
        // Seleciona o calendário principal automaticamente
        calendarId = await this.resolvePrimaryCalendarId(integration.provider, accessToken);
      }

      if (!calendarId) throw new Error('Nenhum calendário disponível para sincronizar');

      // Buscar eventos do provider
      let rawEvents: any[];
      if (integration.provider === 'google') {
        rawEvents = await this.google.listAllEvents(accessToken, calendarId, timeMin, timeMax);
      } else {
        rawEvents = await this.microsoft.listAllEvents(accessToken, calendarId, timeMin, timeMax);
      }

      this.logger.log(
        `[${integration.provider}] ${rawEvents.length} eventos encontrados para ${tenantId}/${userId}`,
      );

      // Upsert cada evento
      for (const raw of rawEvents) {
        try {
          const mapped = integration.provider === 'google'
            ? this.google.mapToCalendarEvent(raw, tenantId, userId, integrationId, calendarId)
            : this.microsoft.mapToCalendarEvent(raw, tenantId, userId, integrationId, calendarId);

          // Busca evento existente por providerEventId
          const existing = await this.eventRepo.findOne({
            where: { tenantId, providerEventId: mapped.providerEventId },
          });

          if (existing) {
            // Atualiza campos mutáveis, preserva campos internos (assignedUserId, notes, etc.)
            Object.assign(existing, {
              title:       mapped.title,
              description: mapped.description,
              location:    mapped.location,
              startsAt:    mapped.startsAt,
              endsAt:      mapped.endsAt,
              allDay:      mapped.allDay,
              status:      mapped.status,
              timezone:    mapped.timezone,
              metadata:    mapped.metadata,
            });
            await this.eventRepo.save(existing);
            if (mapped.status === 'cancelled') cancelled++; else updated++;
          } else {
            await this.eventRepo.save(this.eventRepo.create(mapped));
            imported++;
          }
        } catch (evErr: any) {
          errors++;
          this.logger.warn(
            `Erro ao importar evento ${(raw as any).id ?? '?'}: ${evErr.message}`,
          );
        }
      }

      // Atualiza integration com último sync e calendarId selecionado
      integration.providerCalendarId = calendarId;
      integration.lastSyncedAt       = new Date();
      await this.integrationRepo.save(integration);

      syncLog.status       = errors > 0 && (imported + updated) === 0 ? 'error' : errors > 0 ? 'partial' : 'success';
      syncLog.eventsSynced = imported + updated + cancelled;
      syncLog.finishedAt   = new Date();
    } catch (err: any) {
      syncLog.status       = 'error';
      syncLog.errorMessage = err.message ?? 'Erro desconhecido';
      syncLog.finishedAt   = new Date();
      this.logger.error(`Sync falhou para integration ${integrationId}:`, err.message);
      throw err;
    } finally {
      await this.syncLogRepo.save(syncLog);
    }

    return { imported, updated, cancelled, errors };
  }

  // ─── DESCONEXÃO ─────────────────────────────────────────────────────────────

  async disconnect(integrationId: string, tenantId: string, userId: string): Promise<void> {
    const integration = await this.getIntegrationOrFail(integrationId, tenantId, userId);

    // Revogar token no provider (best-effort)
    if (integration.provider === 'google' && integration.accessTokenEnc) {
      const token = this.safeDecrypt(integration.accessTokenEnc);
      await this.google.revokeToken(token);
    }
    // Microsoft não tem revoke endpoint direto (o token expira naturalmente)

    await this.integrationRepo.remove(integration);
  }

  // ─── HISTÓRICO DE SYNC ───────────────────────────────────────────────────────

  async listSyncLogs(integrationId: string, tenantId: string, userId: string) {
    // Verifica acesso
    await this.getIntegrationOrFail(integrationId, tenantId, userId);
    return this.syncLogRepo.find({
      where: { integrationId, tenantId },
      order: { startedAt: 'DESC' },
      take: 20,
    });
  }

  // ─── HELPERS PRIVADOS ────────────────────────────────────────────────────────

  private getAdapter(provider: 'google' | 'outlook') {
    return provider === 'google' ? this.google : this.microsoft;
  }

  private async getIntegrationOrFail(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<CalendarIntegration> {
    // Busca SEM os tokens (select: false os omite por padrão)
    // Para operações que precisam dos tokens, use QueryBuilder com addSelect
    const qb = this.integrationRepo.createQueryBuilder('i')
      .where('i.id = :id AND i.tenant_id = :tenantId AND i.user_id = :userId', { id, tenantId, userId })
      .addSelect(['i.access_token_enc', 'i.refresh_token_enc']);

    const integration = await qb.getOne();
    if (!integration) throw new NotFoundException('Integração não encontrada');
    return integration;
  }

  /**
   * Garante que o access_token é válido, renovando se necessário.
   * Retorna o access_token em texto claro.
   */
  private async getValidAccessToken(integration: CalendarIntegration): Promise<string> {
    const needsRefresh = !integration.tokenExpiresAt ||
      integration.tokenExpiresAt.getTime() < Date.now() + this.REFRESH_BUFFER_MS;

    if (needsRefresh && integration.refreshTokenEnc) {
      this.logger.debug(`Renovando access_token para integration ${integration.id}`);
      const refreshToken = this.safeDecrypt(integration.refreshTokenEnc);
      try {
        const newTokens = integration.provider === 'google'
          ? await this.google.refreshAccessToken(refreshToken)
          : await this.microsoft.refreshAccessToken(refreshToken);

        integration.accessTokenEnc  = this.crypto.encrypt(newTokens.accessToken);
        integration.tokenExpiresAt  = newTokens.expiresAt;
        await this.integrationRepo.save(integration);

        return newTokens.accessToken;
      } catch (e: any) {
        this.logger.error(`Falha ao renovar token (${integration.provider}):`, e?.message);
        // Marca integração como inativa para forçar re-autenticação
        integration.status = 'expired';
        await this.integrationRepo.save(integration);
        throw new BadRequestException(
          `Token expirado para ${integration.provider}. Reconecte a conta em Agenda → Integrações.`,
        );
      }
    }

    if (!integration.accessTokenEnc) {
      throw new BadRequestException('Token de acesso ausente. Reconecte a conta.');
    }

    return this.safeDecrypt(integration.accessTokenEnc);
  }

  private safeDecrypt(enc: string): string {
    try {
      return this.crypto.decrypt(enc);
    } catch {
      throw new BadRequestException('Token corrompido. Reconecte a conta.');
    }
  }

  /**
   * Tenta extrair a URL do frontend a partir do state OAuth (sem verificar HMAC,
   * pois o state pode ser inválido em caso de erro). Usado para redirecionar
   * corretamente mesmo em casos de falha no callback.
   * Retorna null se não conseguir extrair ou se o host não for seguro.
   */
  resolveFrontendUrlFromState(state: string): string | null {
    try {
      const [b64] = (state ?? '').split('.');
      if (!b64) return null;
      const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
      const returnHost = payload?.returnHost as string | undefined;
      if (!returnHost) return null;
      const baseDomain = this.cfg.get<string>('BASE_DOMAIN', 'sempredesk.com.br');
      if (!this.isSafeReturnHost(returnHost, baseDomain)) return null;
      const proto = returnHost.startsWith('localhost') ? 'http' : 'https';
      return `${proto}://${returnHost}`;
    } catch {
      return null;
    }
  }

  /** Identifica o calendário principal do provider. */
  private async resolvePrimaryCalendarId(
    provider: string,
    accessToken: string,
  ): Promise<string | null> {
    if (provider === 'google') {
      const cals = await this.google.listCalendars(accessToken);
      const primary = cals.find((c) => c.primary) ?? cals[0];
      return primary?.id ?? null;
    } else {
      const cals = await this.microsoft.listCalendars(accessToken);
      const primary = cals.find((c) => c.isDefault) ?? cals[0];
      return primary?.id ?? null;
    }
  }
}
