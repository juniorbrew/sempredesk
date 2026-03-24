import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  async sendAlert(channel: string, recipient: string, subject: string, message: string): Promise<void> {
    this.logger.log(`[${channel.toUpperCase()}] → ${recipient}: ${subject}`);
    // TODO: SendGrid (email), WhatsApp Business API, Firebase (push)
  }

  async notifyDeviceOffline(device: any): Promise<void> {
    await this.sendAlert('email', 'admin', `Dispositivo offline: ${device.name}`, `O dispositivo ${device.name} ficou offline.`);
  }

  async notifySlaWarning(ticket: any): Promise<void> {
    await this.sendAlert('email', ticket.assignedTo, `SLA em risco: ${ticket.ticketNumber}`, `O ticket está próximo de violar o SLA.`);
  }

  async notifySlaBreach(ticket: any): Promise<void> {
    await this.sendAlert('email', ticket.assignedTo, `SLA VIOLADO: ${ticket.ticketNumber}`, `O SLA do ticket foi violado.`);
  }

  async notifyContractExpiring(contract: any): Promise<void> {
    await this.sendAlert('email', 'admin', `Contrato expirando: ${contract.id}`, `O contrato vence em breve.`);
  }
}
