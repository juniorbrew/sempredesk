import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly settingsService: SettingsService) {}

  private async getTransporter(tenantId: string) {
    const s = await this.settingsService.findByTenant(tenantId);
    if (!s.smtpHost || !s.smtpUser || !s.smtpPass) return null;
    return nodemailer.createTransport({
      host: s.smtpHost,
      port: parseInt(s.smtpPort || '587'),
      secure: s.smtpSecure === 'true',
      auth: { user: s.smtpUser, pass: s.smtpPass },
    });
  }

  async sendTicketCreated(tenantId: string, to: string, ticket: any): Promise<void> {
    try {
      const s = await this.settingsService.findByTenant(tenantId);
      const transport = await this.getTransporter(tenantId);
      if (!transport) return;
      const from = s.smtpFrom || s.smtpUser;
      await transport.sendMail({
        from,
        to,
        subject: `[${ticket.ticketNumber}] Ticket aberto: ${ticket.subject}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#4F46E5;padding:20px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0">Ticket aberto com sucesso</h2>
            </div>
            <div style="background:#F8FAFC;padding:20px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0">
              <p>Olá! Seu ticket foi registrado em nosso sistema.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;font-weight:bold;color:#64748B;width:140px">Número:</td><td style="padding:8px;font-weight:bold;color:#4F46E5">${ticket.ticketNumber}</td></tr>
                <tr style="background:#fff"><td style="padding:8px;font-weight:bold;color:#64748B">Assunto:</td><td style="padding:8px">${ticket.subject}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#64748B">Status:</td><td style="padding:8px">Aberto</td></tr>
                <tr style="background:#fff"><td style="padding:8px;font-weight:bold;color:#64748B">Prioridade:</td><td style="padding:8px">${ticket.priority}</td></tr>
              </table>
              <p style="color:#64748B;font-size:13px">Você receberá atualizações por e-mail conforme seu ticket for atendido.</p>
            </div>
          </div>`,
      });
    } catch (e) {
      this.logger.error('Error sending ticket created email:', e.message);
    }
  }

  async sendTicketUpdated(tenantId: string, to: string, ticket: any, newStatus: string): Promise<void> {
    try {
      const s = await this.settingsService.findByTenant(tenantId);
      const transport = await this.getTransporter(tenantId);
      if (!transport) return;
      const statusMap: Record<string,string> = { open:'Aberto', in_progress:'Em Andamento', waiting_client:'Aguardando Cliente', resolved:'Resolvido', closed:'Encerrado', cancelled:'Cancelado' };
      const from = s.smtpFrom || s.smtpUser;
      await transport.sendMail({
        from,
        to,
        subject: `[${ticket.ticketNumber}] Status atualizado: ${statusMap[newStatus] || newStatus}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#4F46E5;padding:20px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0">Atualização no seu ticket</h2>
            </div>
            <div style="background:#F8FAFC;padding:20px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0">
              <p>Seu ticket <strong style="color:#4F46E5">${ticket.ticketNumber}</strong> foi atualizado.</p>
              <p><strong>Novo status:</strong> ${statusMap[newStatus] || newStatus}</p>
              ${ticket.resolutionSummary ? `<p><strong>Solução:</strong> ${ticket.resolutionSummary}</p>` : ''}
            </div>
          </div>`,
      });
    } catch (e) {
      this.logger.error('Error sending ticket updated email:', e.message);
    }
  }

  async sendTicketResolved(tenantId: string, to: string, ticket: any): Promise<void> {
    try {
      const s = await this.settingsService.findByTenant(tenantId);
      const transport = await this.getTransporter(tenantId);
      if (!transport) return;
      const from = s.smtpFrom || s.smtpUser;
      const portalUrl = process.env.PORTAL_URL || 'http://localhost:3000/portal';
      await transport.sendMail({
        from,
        to,
        subject: `[${ticket.ticketNumber}] Ticket resolvido - Avalie o atendimento`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#10B981;padding:20px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0">Seu ticket foi resolvido!</h2>
            </div>
            <div style="background:#F8FAFC;padding:20px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0">
              <p>O ticket <strong style="color:#4F46E5">${ticket.ticketNumber}</strong> foi marcado como resolvido.</p>
              ${ticket.resolutionSummary ? `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin:12px 0"><strong>Solução:</strong><p>${ticket.resolutionSummary}</p></div>` : ''}
              <p style="text-align:center;margin-top:20px"><strong>Como foi o atendimento?</strong></p>
              <div style="text-align:center;margin:16px 0">
                <a href="${portalUrl}" style="display:inline-block;margin:0 8px;padding:10px 24px;background:#10B981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">👍 Ótimo atendimento</a>
                <a href="${portalUrl}" style="display:inline-block;margin:0 8px;padding:10px 24px;background:#EF4444;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">👎 Precisa melhorar</a>
              </div>
            </div>
          </div>`,
      });
    } catch (e) {
      this.logger.error('Error sending ticket resolved email:', e.message);
    }
  }

  async sendEscalationAlert(tenantId: string, to: string, ticket: any): Promise<void> {
    try {
      const s = await this.settingsService.findByTenant(tenantId);
      const transport = await this.getTransporter(tenantId);
      if (!transport) return;
      const from = s.smtpFrom || s.smtpUser;
      await transport.sendMail({
        from,
        to,
        subject: `⚠️ [${ticket.ticketNumber}] SLA em risco - Ação necessária`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#EF4444;padding:20px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0">⚠️ Alerta de SLA</h2>
            </div>
            <div style="background:#FEF2F2;padding:20px;border-radius:0 0 8px 8px;border:1px solid #FECACA">
              <p>O ticket abaixo está em risco de violar o SLA!</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;font-weight:bold;color:#64748B">Número:</td><td style="padding:8px;font-weight:bold;color:#EF4444">${ticket.ticketNumber}</td></tr>
                <tr style="background:#fff"><td style="padding:8px;font-weight:bold;color:#64748B">Assunto:</td><td style="padding:8px">${ticket.subject}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#64748B">Prazo SLA:</td><td style="padding:8px;color:#EF4444;font-weight:bold">${ticket.slaResolveAt ? new Date(ticket.slaResolveAt).toLocaleString('pt-BR') : 'N/D'}</td></tr>
              </table>
              <p style="color:#DC2626;font-weight:bold">Por favor, tome ação imediata!</p>
            </div>
          </div>`,
      });
    } catch (e) {
      this.logger.error('Error sending escalation email:', e.message);
    }
  }

  async sendWeeklyReport(tenantId: string, to: string, stats: any): Promise<void> {
    try {
      const s = await this.settingsService.findByTenant(tenantId);
      const transport = await this.getTransporter(tenantId);
      if (!transport) return;
      const from = s.smtpFrom || s.smtpUser;
      const now = new Date();
      const weekStr = `${now.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}`;
      await transport.sendMail({
        from,
        to,
        subject: `📊 Relatório Semanal SempreDesk — ${weekStr}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#4F46E5,#6366F1);padding:24px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0;font-size:20px">📊 Relatório Semanal — SempreDesk</h2>
              <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Semana de ${weekStr}</p>
            </div>
            <div style="background:#F8FAFC;padding:20px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
                ${[
                  ['Tickets Abertos', stats.open || 0, '#3B82F6'],
                  ['Em Andamento', stats.inProgress || 0, '#F59E0B'],
                  ['Resolvidos', stats.resolved || 0, '#10B981'],
                  ['SLA em Risco', stats.slaRisk || 0, '#EF4444'],
                ].map(([label, val, color]) => `
                  <div style="background:#fff;border-radius:10px;padding:14px;border:1px solid #E2E8F0;text-align:center">
                    <p style="font-size:28px;font-weight:800;color:${color};margin:0">${val}</p>
                    <p style="font-size:12px;color:#64748B;margin:4px 0 0">${label}</p>
                  </div>
                `).join('')}
              </div>
              <p style="font-size:12px;color:#94A3B8;text-align:center">Acesse o painel completo em <a href="#" style="color:#4F46E5">SempreDesk</a></p>
            </div>
          </div>`,
      });
    } catch (e) {
      this.logger.error('Error sending weekly report:', e.message);
    }
  }
}
