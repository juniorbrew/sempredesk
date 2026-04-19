/**
 * MicrosoftCalendarAdapter
 * ────────────────────────
 * Adapter de LEITURA para Microsoft Outlook via OAuth 2.0 + Microsoft Graph API.
 *
 * Fase 4.1 — somente leitura (sem escrita no provider).
 * Fase 4.2 — adicionar escrita e delta sync (webhooks via subscriptions).
 *
 * Variáveis de ambiente necessárias:
 *   MICROSOFT_CLIENT_ID=
 *   MICROSOFT_CLIENT_SECRET=
 *   MICROSOFT_TENANT_ID=common   (use 'common' para multi-tenant pessoal+corporativo)
 *   MICROSOFT_REDIRECT_URI=https://suporte.financeos.com.br/api/v1/calendar/integrations/callback/microsoft
 *
 * Setup no Azure Portal:
 *   1. Azure Active Directory → App registrations → New registration
 *   2. Nome: SempreDesk Calendar
 *   3. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
 *   4. Redirect URI (Web): MICROSOFT_REDIRECT_URI
 *   5. API permissions → Add permission → Microsoft Graph:
 *      - Calendars.Read (delegated) — leitura
 *      - User.Read (delegated) — para obter e-mail do usuário
 *   6. Certificates & secrets → New client secret → copiar valor para MICROSOFT_CLIENT_SECRET
 *   7. Overview → Application (client) ID → copiar para MICROSOFT_CLIENT_ID
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface MicrosoftTokens {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    Date;
  email:        string;
}

export interface MicrosoftCalendarItem {
  id:        string;
  name:      string;
  color:     string;
  isDefault: boolean;
  canEdit:   boolean;
}

export interface MicrosoftEventItem {
  id:          string;
  subject:     string | null;
  body:        { content: string; contentType: string } | null;
  location:    { displayName: string } | null;
  start:       { dateTime: string; timeZone: string };
  end:         { dateTime: string; timeZone: string };
  isAllDay:    boolean;
  isCancelled: boolean;
  showAs:      string;  // free | tentative | busy | oof | workingElsewhere | unknown
  webLink:     string;
  createdDateTime:  string;
  lastModifiedDateTime: string;
  organizer?:  { emailAddress: { address: string; name: string } };
  seriesMasterId?: string;
}

@Injectable()
export class MicrosoftCalendarAdapter {
  private readonly logger = new Logger(MicrosoftCalendarAdapter.name);

  private readonly clientId:     string;
  private readonly clientSecret:  string;
  private readonly tenantId:      string;
  private readonly redirectUri:   string;

  private readonly GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

  /** Scopes de LEITURA. Para Fase 4.2, adicionar Calendars.ReadWrite */
  private readonly SCOPES = [
    'offline_access',      // necessário para refresh_token
    'Calendars.Read',
    'User.Read',
  ].join(' ');

  constructor(private readonly cfg: ConfigService) {
    this.clientId     = this.cfg.get<string>('MICROSOFT_CLIENT_ID', '');
    this.clientSecret = this.cfg.get<string>('MICROSOFT_CLIENT_SECRET', '');
    this.tenantId     = this.cfg.get<string>('MICROSOFT_TENANT_ID', 'common');
    this.redirectUri  = this.cfg.get<string>(
      'MICROSOFT_REDIRECT_URI',
      'http://localhost:4000/api/v1/calendar/integrations/callback/microsoft',
    );
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  private get authBase() {
    return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0`;
  }

  /** Gera a URL de autorização OAuth 2.0. */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id:     this.clientId,
      response_type: 'code',
      redirect_uri:  this.redirectUri,
      response_mode: 'query',
      scope:         this.SCOPES,
      state,
    });
    return `${this.authBase}/authorize?${params}`;
  }

  /** Troca o código de autorização por access_token + refresh_token. */
  async exchangeCode(code: string): Promise<MicrosoftTokens> {
    const resp = await axios.post<{
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
    }>(
      `${this.authBase}/token`,
      new URLSearchParams({
        code,
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        redirect_uri:  this.redirectUri,
        grant_type:    'authorization_code',
        scope:         this.SCOPES,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const data  = resp.data;
    const email = await this.getUserEmail(data.access_token);

    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt:    new Date(Date.now() + data.expires_in * 1000),
      email,
    };
  }

  /** Renova o access_token usando o refresh_token. */
  async refreshAccessToken(refreshToken: string): Promise<Pick<MicrosoftTokens, 'accessToken' | 'expiresAt'>> {
    const resp = await axios.post<{ access_token: string; expires_in: number }>(
      `${this.authBase}/token`,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        grant_type:    'refresh_token',
        scope:         this.SCOPES,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return {
      accessToken: resp.data.access_token,
      expiresAt:   new Date(Date.now() + resp.data.expires_in * 1000),
    };
  }

  /** Busca o e-mail do usuário autenticado. */
  private async getUserEmail(accessToken: string): Promise<string> {
    const resp = await axios.get<{ mail?: string; userPrincipalName?: string }>(
      `${this.GRAPH_BASE}/me`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return resp.data.mail ?? resp.data.userPrincipalName ?? '';
  }

  /** Lista os calendários da conta conectada. */
  async listCalendars(accessToken: string): Promise<MicrosoftCalendarItem[]> {
    const resp = await axios.get<{ value: any[] }>(
      `${this.GRAPH_BASE}/me/calendars`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return (resp.data.value ?? []).map((c) => ({
      id:        c.id,
      name:      c.name ?? c.id,
      color:     c.color ?? 'auto',
      isDefault: c.isDefaultCalendar ?? false,
      canEdit:   c.canEdit ?? false,
    }));
  }

  /**
   * Busca eventos de um calendário em um intervalo.
   * Microsoft usa UTC nos campos dateTime — converter para ISO 8601 com 'Z'.
   */
  async listEvents(
    accessToken: string,
    calendarId:  string,
    startDateTime: string,
    endDateTime:   string,
    skipToken?:    string,
  ): Promise<{ events: MicrosoftEventItem[]; nextLink?: string }> {
    const params: Record<string, string> = {
      startDateTime,
      endDateTime,
      $top: '50',
      $select: 'id,subject,body,location,start,end,isAllDay,isCancelled,showAs,webLink,createdDateTime,lastModifiedDateTime,organizer,seriesMasterId',
    };

    const url = skipToken ??
      `${this.GRAPH_BASE}/me/calendars/${calendarId}/events?${new URLSearchParams(params)}`;

    const resp = await axios.get<{ value: any[]; '@odata.nextLink'?: string }>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' } },
    );

    const events: MicrosoftEventItem[] = (resp.data.value ?? []).map((e) => ({
      id:           e.id,
      subject:      e.subject ?? null,
      body:         e.body ?? null,
      location:     e.location?.displayName ? { displayName: e.location.displayName } : null,
      start:        e.start,
      end:          e.end,
      isAllDay:     e.isAllDay ?? false,
      isCancelled:  e.isCancelled ?? false,
      showAs:       e.showAs ?? 'busy',
      webLink:      e.webLink ?? '',
      createdDateTime:      e.createdDateTime ?? new Date().toISOString(),
      lastModifiedDateTime: e.lastModifiedDateTime ?? new Date().toISOString(),
      organizer:    e.organizer,
      seriesMasterId: e.seriesMasterId,
    }));

    return { events, nextLink: resp.data['@odata.nextLink'] };
  }

  /** Busca TODOS os eventos paginando via @odata.nextLink. */
  async listAllEvents(
    accessToken:   string,
    calendarId:    string,
    startDateTime: string,
    endDateTime:   string,
  ): Promise<MicrosoftEventItem[]> {
    const all: MicrosoftEventItem[] = [];
    let nextLink: string | undefined;

    do {
      const { events, nextLink: nl } = await this.listEvents(
        accessToken, calendarId, startDateTime, endDateTime, nextLink,
      );
      all.push(...events);
      nextLink = nl;
    } while (nextLink);

    return all;
  }

  /** Mapeia um Microsoft Graph Event para o schema interno de CalendarEvent. */
  mapToCalendarEvent(
    ev: MicrosoftEventItem,
    tenantId: string,
    userId: string,
    integrationId: string,
    calendarId: string,
  ) {
    // Microsoft Graph retorna dateTime em UTC quando Prefer: outlook.timezone="UTC"
    const startsAt = new Date(
      ev.isAllDay ? `${ev.start.dateTime.split('T')[0]}T00:00:00Z` : `${ev.start.dateTime}Z`,
    );
    const endsAt   = new Date(
      ev.isAllDay ? `${ev.end.dateTime.split('T')[0]}T00:00:00Z`   : `${ev.end.dateTime}Z`,
    );

    const safeEndsAt = endsAt < startsAt ? startsAt : endsAt;

    // Extrai texto plano do body HTML (remoção básica de tags)
    const description = ev.body?.content
      ? ev.body.content.replace(/<[^>]+>/g, '').trim() || null
      : null;

    return {
      tenantId,
      createdBy:          userId,
      title:              ev.subject ?? '(sem assunto)',
      description:        description && description.length > 2000
        ? description.slice(0, 2000) + '…'
        : description,
      location:           ev.location?.displayName ?? null,
      startsAt,
      endsAt:             safeEndsAt,
      timezone:           'UTC',
      allDay:             ev.isAllDay,
      status:             ev.isCancelled ? 'cancelled' : 'confirmed',
      eventType:          'sync_outlook' as const,
      origin:             'sync_outlook' as const,
      provider:           'outlook' as const,
      providerEventId:    ev.id,
      providerCalendarId: calendarId,
      metadata: {
        webLink:              ev.webLink,
        organizer:            ev.organizer,
        seriesMasterId:       ev.seriesMasterId,
        outlookUpdatedAt:     ev.lastModifiedDateTime,
        importedAt:           new Date().toISOString(),
      },
    };
  }
}
