/**
 * GoogleCalendarAdapter
 * ─────────────────────
 * Adapter de LEITURA para Google Calendar via OAuth 2.0 + REST API.
 *
 * Fase 4.1 — somente leitura (sem escrita no provider).
 * Fase 4.2 — adicionar escrita e webhooks (push notifications).
 *
 * Variáveis de ambiente necessárias:
 *   GOOGLE_CLIENT_ID=
 *   GOOGLE_CLIENT_SECRET=
 *   GOOGLE_REDIRECT_URI=https://suporte.financeos.com.br/api/v1/calendar/integrations/callback/google
 *
 * Setup no Google Cloud Console:
 *   1. Criar projeto → APIs & Services → Credentials → OAuth 2.0 Client IDs
 *   2. Tipo: Web application
 *   3. Authorized redirect URIs: adicionar GOOGLE_REDIRECT_URI
 *   4. Habilitar "Google Calendar API" na biblioteca de APIs
 *   5. Scopes necessários: https://www.googleapis.com/auth/calendar.readonly
 *      (ou https://www.googleapis.com/auth/calendar para Fase 4.2 bidirecional)
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface GoogleTokens {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    Date;
  email:        string;
}

export interface GoogleCalendarItem {
  id:          string;
  summary:     string;
  description: string | null;
  primary:     boolean;
  accessRole:  string; // owner | writer | reader | freeBusyReader
}

export interface GoogleEventItem {
  id:          string;
  summary:     string | null;
  description: string | null;
  location:    string | null;
  status:      string; // confirmed | tentative | cancelled
  start:       { dateTime?: string; date?: string; timeZone?: string };
  end:         { dateTime?: string; date?: string; timeZone?: string };
  htmlLink:    string;
  created:     string;
  updated:     string;
  recurringEventId?: string;
  organizer?:  { email: string; displayName?: string };
}

@Injectable()
export class GoogleCalendarAdapter {
  private readonly logger = new Logger(GoogleCalendarAdapter.name);

  private readonly clientId:     string;
  private readonly clientSecret:  string;
  private readonly redirectUri:   string;

  private readonly AUTH_URL    = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly TOKEN_URL   = 'https://oauth2.googleapis.com/token';
  private readonly REVOKE_URL  = 'https://oauth2.googleapis.com/revoke';
  private readonly USERINFO_URL= 'https://www.googleapis.com/oauth2/v3/userinfo';
  private readonly CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

  /** Scopes de LEITURA. Para Fase 4.2 (bidirecional), substituir por calendar */
  private readonly SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');

  constructor(private readonly cfg: ConfigService) {
    this.clientId     = this.cfg.get<string>('GOOGLE_CLIENT_ID', '');
    this.clientSecret = this.cfg.get<string>('GOOGLE_CLIENT_SECRET', '');
    this.redirectUri  = this.cfg.get<string>(
      'GOOGLE_REDIRECT_URI',
      'http://localhost:4000/api/v1/calendar/integrations/callback/google',
    );
  }

  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /** Gera a URL de autorização OAuth 2.0. */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id:     this.clientId,
      redirect_uri:  this.redirectUri,
      response_type: 'code',
      scope:         this.SCOPES,
      access_type:   'offline',   // garante refresh_token
      prompt:        'consent',   // força re-consentimento para sempre receber refresh_token
      state,
    });
    return `${this.AUTH_URL}?${params}`;
  }

  /** Troca o código de autorização por access_token + refresh_token. */
  async exchangeCode(code: string): Promise<GoogleTokens> {
    const resp = await axios.post<{
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
      token_type:    string;
    }>(this.TOKEN_URL, new URLSearchParams({
      code,
      client_id:     this.clientId,
      client_secret: this.clientSecret,
      redirect_uri:  this.redirectUri,
      grant_type:    'authorization_code',
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

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
  async refreshAccessToken(refreshToken: string): Promise<Pick<GoogleTokens, 'accessToken' | 'expiresAt'>> {
    const resp = await axios.post<{ access_token: string; expires_in: number }>(
      this.TOKEN_URL,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        grant_type:    'refresh_token',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return {
      accessToken: resp.data.access_token,
      expiresAt:   new Date(Date.now() + resp.data.expires_in * 1000),
    };
  }

  /** Revoga o token no Google (disconnect). */
  async revokeToken(token: string): Promise<void> {
    try {
      await axios.post(this.REVOKE_URL, null, { params: { token } });
    } catch (e) {
      // Revogação falhou (token já expirado ou inválido) — continuar com remoção local
      this.logger.warn('Falha ao revogar token Google (pode já estar expirado):', (e as any)?.message);
    }
  }

  /** Busca o e-mail do usuário autenticado. */
  private async getUserEmail(accessToken: string): Promise<string> {
    const resp = await axios.get<{ email: string }>(this.USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data.email ?? '';
  }

  /** Lista os calendários da conta conectada. */
  async listCalendars(accessToken: string): Promise<GoogleCalendarItem[]> {
    const resp = await axios.get<{ items: any[] }>(
      `${this.CALENDAR_BASE}/users/me/calendarList`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return (resp.data.items ?? []).map((c) => ({
      id:          c.id,
      summary:     c.summary ?? c.id,
      description: c.description ?? null,
      primary:     c.primary ?? false,
      accessRole:  c.accessRole ?? 'reader',
    }));
  }

  /**
   * Busca eventos de um calendário em um intervalo de tempo.
   * timeMin / timeMax são ISO 8601 strings.
   * Retorna até maxResults eventos (padrão 250 — máximo permitido pela API).
   */
  async listEvents(
    accessToken:  string,
    calendarId:   string,
    timeMin:      string,
    timeMax:      string,
    pageToken?:   string,
  ): Promise<{ events: GoogleEventItem[]; nextPageToken?: string }> {
    const params: Record<string, string | number> = {
      timeMin,
      timeMax,
      singleEvents: 'true',  // expande recorrências em eventos individuais
      orderBy:      'startTime',
      maxResults:   250,
    };
    if (pageToken) params.pageToken = pageToken;

    const resp = await axios.get<{ items: any[]; nextPageToken?: string }>(
      `${this.CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        params,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const events: GoogleEventItem[] = (resp.data.items ?? []).map((e) => ({
      id:               e.id,
      summary:          e.summary ?? null,
      description:      e.description ?? null,
      location:         e.location ?? null,
      status:           e.status ?? 'confirmed',
      start:            e.start ?? {},
      end:              e.end ?? {},
      htmlLink:         e.htmlLink ?? '',
      created:          e.created ?? new Date().toISOString(),
      updated:          e.updated ?? new Date().toISOString(),
      recurringEventId: e.recurringEventId,
      organizer:        e.organizer,
    }));

    return { events, nextPageToken: resp.data.nextPageToken };
  }

  /**
   * Busca TODOS os eventos de um calendário paginando automaticamente.
   * Para janelas de tempo grandes, pode fazer várias requisições.
   */
  async listAllEvents(
    accessToken: string,
    calendarId:  string,
    timeMin:     string,
    timeMax:     string,
  ): Promise<GoogleEventItem[]> {
    const all: GoogleEventItem[] = [];
    let pageToken: string | undefined;

    do {
      const { events, nextPageToken } = await this.listEvents(
        accessToken, calendarId, timeMin, timeMax, pageToken,
      );
      all.push(...events);
      pageToken = nextPageToken;
    } while (pageToken);

    return all;
  }

  /** Mapeia um Google Event para o schema interno de CalendarEvent. */
  mapToCalendarEvent(
    ev: GoogleEventItem,
    tenantId: string,
    userId: string,
    integrationId: string,
    calendarId: string,
  ) {
    const allDay   = !ev.start.dateTime;  // se não tem dateTime, é dia inteiro (usa date)
    const startsAt = allDay
      ? new Date(`${ev.start.date}T00:00:00Z`)
      : new Date(ev.start.dateTime!);
    const endsAt   = allDay
      ? new Date(`${ev.end.date}T00:00:00Z`)
      : new Date(ev.end.dateTime!);

    // Garante que endsAt >= startsAt (Google às vezes retorna eventos zerados)
    const safeEndsAt = endsAt < startsAt ? startsAt : endsAt;

    // Mapeamento de status Google → interno
    const statusMap: Record<string, string> = {
      confirmed: 'confirmed',
      tentative: 'scheduled',
      cancelled: 'cancelled',
    };

    return {
      tenantId,
      createdBy:          userId,
      title:              ev.summary ?? '(sem título)',
      description:        ev.description ?? null,
      location:           ev.location ?? null,
      startsAt,
      endsAt:             safeEndsAt,
      timezone:           ev.start.timeZone ?? 'America/Sao_Paulo',
      allDay,
      status:             statusMap[ev.status] ?? 'scheduled',
      eventType:          'sync_google' as const,
      origin:             'sync_google' as const,
      provider:           'google' as const,
      providerEventId:    ev.id,
      providerCalendarId: calendarId,
      metadata: {
        htmlLink:          ev.htmlLink,
        organizer:         ev.organizer,
        recurringEventId:  ev.recurringEventId,
        googleUpdatedAt:   ev.updated,
        importedAt:        new Date().toISOString(),
      },
    };
  }
}
