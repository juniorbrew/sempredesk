import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TenantSettings } from './settings.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly repo: Repository<TenantSettings>,
    private readonly dataSource: DataSource,
  ) {}

  async findByTenant(tenantId: string): Promise<TenantSettings> {
    let settings = await this.repo.findOne({ where: { tenantId } });
    if (!settings) {
      settings = this.repo.create({ tenantId });
      await this.repo.save(settings);
    }
    return settings;
  }

  async update(tenantId: string, dto: Partial<TenantSettings>): Promise<TenantSettings> {
    let settings = await this.repo.findOne({ where: { tenantId } });
    if (!settings) {
      settings = this.repo.create({ tenantId, ...dto });
    } else {
      Object.assign(settings, dto);
    }
    return this.repo.save(settings);
  }

  async resetTestData(tenantId: string, userRole: string): Promise<{ deleted: Record<string, number> }> {
    if (!['super_admin', 'admin'].includes(userRole)) {
      throw new ForbiddenException('Apenas administradores podem resetar dados');
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // Ordem: mensagens antes de suas tabelas pai (FK: conversation_messages → conversations)
      const ticketMsgs   = await runner.query(`DELETE FROM ticket_messages        WHERE tenant_id = $1`, [tenantId]);
      const convMsgs     = await runner.query(`DELETE FROM conversation_messages  WHERE tenant_id = $1`, [tenantId]);
      const convs        = await runner.query(`DELETE FROM conversations           WHERE tenant_id = $1`, [tenantId]);
      const tickets      = await runner.query(`DELETE FROM tickets                WHERE tenant_id = $1`, [tenantId]);
      const internalMsgs = await runner.query(`DELETE FROM internal_chat_messages WHERE tenant_id = $1`, [tenantId]);
      const teamMsgs     = await runner.query(`DELETE FROM team_chat_messages     WHERE tenant_id = $1`, [tenantId]);
      const botSess      = await runner.query(`DELETE FROM chatbot_sessions       WHERE tenant_id = $1`, [tenantId]);
      const botMsgs      = await runner.query(`DELETE FROM chatbot_widget_messages WHERE tenant_id = $1`, [tenantId]);
      await runner.commitTransaction();
      return {
        deleted: {
          tickets:              tickets.rowCount      ?? 0,
          ticketMessages:       ticketMsgs.rowCount   ?? 0,
          conversations:        convs.rowCount        ?? 0,
          conversationMessages: convMsgs.rowCount     ?? 0,
          internalChatMessages: internalMsgs.rowCount ?? 0,
          teamChatMessages:     teamMsgs.rowCount     ?? 0,
          chatbotSessions:      botSess.rowCount      ?? 0,
          chatbotWidgetMessages:botMsgs.rowCount      ?? 0,
        },
      };
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  }

  async testSmtp(tenantId: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.findByTenant(tenantId);
    if (!settings.smtpHost || !settings.smtpUser) {
      return { success: false, message: 'Configurações SMTP incompletas' };
    }
    return { success: true, message: 'Configuração SMTP parece válida (teste real em breve)' };
  }
}
