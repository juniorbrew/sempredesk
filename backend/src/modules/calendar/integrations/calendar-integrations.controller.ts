/**
 * CalendarIntegrationsController
 * ───────────────────────────────
 * Endpoints HTTP para gerenciar integrações com Google Calendar e Microsoft Outlook.
 *
 * Rotas públicas (sem auth):
 *   GET /calendar/integrations/callback/:provider   ← callback OAuth (chamado pelo provider)
 *
 * Rotas protegidas (requerem JWT + agenda.view):
 *   GET  /calendar/integrations                      ← lista integrações do usuário
 *   GET  /calendar/integrations/providers            ← quais providers estão configurados
 *   GET  /calendar/integrations/:provider/connect    ← inicia OAuth (redireciona)
 *   GET  /calendar/integrations/:id/calendars        ← lista calendários do provider
 *   POST /calendar/integrations/:id/sync             ← importa eventos
 *   GET  /calendar/integrations/:id/logs             ← histórico de sync
 *   DELETE /calendar/integrations/:id               ← desconecta conta
 */
import {
  Body, Controller, Delete, Get, Logger,
  Param, Post, Query, Redirect, Req, Res, UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard }      from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard }  from '../../../common/guards/permissions.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { TenantId }          from '../../../common/decorators/tenant-id.decorator';
import { UserId }            from '../../../common/decorators/user-id.decorator';
import { CalendarIntegrationsService } from './calendar-integrations.service';
import { GoogleCalendarAdapter }       from '../adapters/google-calendar.adapter';
import { MicrosoftCalendarAdapter }    from '../adapters/microsoft-calendar.adapter';
import { SyncCalendarDto }             from './dto/integration.dto';

@Controller('calendar/integrations')
export class CalendarIntegrationsController {
  private readonly logger = new Logger(CalendarIntegrationsController.name);

  constructor(
    private readonly service:    CalendarIntegrationsService,
    private readonly google:     GoogleCalendarAdapter,
    private readonly microsoft:  MicrosoftCalendarAdapter,
  ) {}

  /**
   * Lista quais providers OAuth estão configurados neste servidor.
   * Útil para o frontend decidir quais botões de "Conectar" exibir.
   */
  @Get('providers')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  getProviders() {
    return {
      google:    { available: this.google.isConfigured(),    label: 'Google Calendar' },
      outlook:   { available: this.microsoft.isConfigured(), label: 'Microsoft Outlook' },
    };
  }

  /**
   * Lista todas as integrações conectadas do usuário autenticado.
   * Os tokens (access/refresh) nunca são incluídos na resposta.
   */
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  listIntegrations(
    @TenantId() tenantId: string,
    @UserId()   userId: string,
  ) {
    return this.service.listIntegrations(tenantId, userId);
  }

  /**
   * Retorna a URL de autorização OAuth como JSON (sem redirect HTTP).
   * O frontend usa esta URL para navegar via window.location.href.
   *
   * Preferir este endpoint ao /:provider/connect para uso no SPA,
   * pois o Axios em browser segue redirects automaticamente e não
   * permite capturar a Location header de uma resposta 302.
   */
  @Get(':provider/connect-url')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  async getConnectUrl(
    @Param('provider') provider: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
    @Req()      req: Request,
  ) {
    if (provider !== 'google' && provider !== 'outlook') {
      throw new Error(`Provider inválido: ${provider}. Use 'google' ou 'outlook'.`);
    }
    // Captura o host de origem para redirecionar de volta ao subdomínio correto após OAuth.
    // Nginx propaga o host original via X-Forwarded-Host.
    const returnHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const url = this.service.buildAuthUrl(provider as 'google' | 'outlook', tenantId, userId, returnHost);
    return { url };
  }

  /**
   * Inicia o fluxo OAuth para o provider solicitado.
   * Redireciona o usuário para a página de autorização do provider.
   *
   * Nota: como o redirect é browser-based, o JWT deve ser passado via query string
   * ou o frontend deve fazer GET com credentials. A rota usa JwtAuthGuard.
   * Para uso em SPA, prefira GET /:provider/connect-url (retorna JSON).
   */
  @Get(':provider/connect')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  @Redirect()
  async startOAuth(
    @Param('provider') provider: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
    @Req()      req: Request,
  ) {
    if (provider !== 'google' && provider !== 'outlook') {
      throw new Error(`Provider inválido: ${provider}. Use 'google' ou 'outlook'.`);
    }
    const returnHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const url = this.service.buildAuthUrl(provider as 'google' | 'outlook', tenantId, userId, returnHost);
    return { url, statusCode: 302 };
  }

  /**
   * Callback OAuth — chamado pelo Google/Microsoft após o usuário autorizar.
   * NÃO usa JwtAuthGuard (o estado de autenticação está no state parameter).
   * Redireciona para o frontend após salvar os tokens.
   */
  @Get('callback/:provider')
  async handleCallback(
    @Param('provider') provider: string,
    @Query('code')  code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // O provider também pode ser 'microsoft' dependendo da rota configurada
    const normalizedProvider = provider === 'microsoft' ? 'outlook' : provider as 'google' | 'outlook';

    if (error) {
      this.logger.warn(`OAuth ${provider} negado pelo usuário: ${error}`);
      // Tenta extrair returnHost do state para redirecionar ao subdomínio correto
      const frontendBase = this.service.resolveFrontendUrlFromState(state)
        ?? process.env.APP_FRONTEND_URL
        ?? 'http://localhost:3000';
      return res.redirect(`${frontendBase}/dashboard/agenda/integracoes?integration=denied&provider=${provider}`);
    }

    try {
      const { redirectUrl } = await this.service.handleCallback(normalizedProvider, code, state);
      return res.redirect(redirectUrl);
    } catch (e: any) {
      this.logger.error(`Callback OAuth ${provider} falhou:`, e.message);
      const frontendBase = this.service.resolveFrontendUrlFromState(state)
        ?? process.env.APP_FRONTEND_URL
        ?? 'http://localhost:3000';
      return res.redirect(
        `${frontendBase}/dashboard/agenda/integracoes?integration=error&provider=${provider}&msg=${encodeURIComponent(e.message)}`,
      );
    }
  }

  /**
   * Lista os calendários disponíveis no provider da integração.
   * Necessário para o usuário escolher qual calendário sincronizar.
   */
  @Get(':id/calendars')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  listCalendars(
    @Param('id')    id: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
  ) {
    return this.service.listProviderCalendars(id, tenantId, userId);
  }

  /**
   * Importa eventos do provider para o banco local.
   * Fase 4.1: leitura unidirecional (provider → banco).
   * Retorna contagem de eventos importados/atualizados/cancelados/erros.
   */
  @Post(':id/sync')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.edit')
  syncEvents(
    @Param('id')    id: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
    @Body()     dto: SyncCalendarDto,
  ) {
    return this.service.syncEvents(id, tenantId, userId, dto);
  }

  /**
   * Histórico das últimas sincronizações da integração.
   */
  @Get(':id/logs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.view')
  listSyncLogs(
    @Param('id')    id: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
  ) {
    return this.service.listSyncLogs(id, tenantId, userId);
  }

  /**
   * Remove a integração e revoga o token no provider (best-effort).
   * Eventos já importados NÃO são removidos automaticamente.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('agenda.edit')
  disconnect(
    @Param('id')    id: string,
    @TenantId() tenantId: string,
    @UserId()   userId: string,
  ) {
    return this.service.disconnect(id, tenantId, userId);
  }
}
