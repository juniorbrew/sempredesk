import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InternalChatMessage } from './internal-chat.entity';

@Injectable()
export class InternalChatService {
  constructor(
    @InjectRepository(InternalChatMessage)
    private readonly repo: Repository<InternalChatMessage>,
  ) {}

  private async assertRecipientInTenant(tenantId: string, recipientId: string): Promise<void> {
    const { User } = await import('../auth/user.entity');
    const userRepo = this.repo.manager.getRepository(User);
    const recipient = await userRepo.findOne({ where: { id: recipientId, tenantId }, select: ['id'] });
    if (!recipient) {
      throw new BadRequestException('Destinatário inválido ou fora do escopo');
    }
  }

  async getUsers(tenantId: string, excludeUserId: string) {
    const { User } = await import('../auth/user.entity');
    const userRepo = this.repo.manager.getRepository(User);
    return userRepo.find({
      where: { tenantId, status: 'active' },
      select: ['id', 'name', 'email', 'role', 'avatar'],
      order: { name: 'ASC' },
    }).then(users => users.filter(u => u.id !== excludeUserId));
  }

  async getConversations(tenantId: string, userId: string) {
    const rows = await this.repo
      .createQueryBuilder('m')
      .select('m.sender_id', 'senderId')
      .addSelect('m.sender_name', 'senderName')
      .addSelect('m.recipient_id', 'recipientId')
      .addSelect('m.content', 'lastContent')
      .addSelect('m.created_at', 'lastAt')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('(m.sender_id = :userId OR m.recipient_id = :userId)', { userId })
      .orderBy('m.created_at', 'DESC')
      .getRawMany();

    const seen = new Set<string>();
    const threads: Array<{ userId: string; name: string; lastContent: string; lastAt: string }> = [];
    const { User } = await import('../auth/user.entity');
    const userRepo = this.repo.manager.getRepository(User);

    for (const r of rows) {
      const otherId = r.senderId === userId ? r.recipientId : r.senderId;
      if (seen.has(otherId)) continue;
      seen.add(otherId);

      const other = await userRepo.findOne({ where: { id: otherId, tenantId }, select: ['name'] });
      threads.push({
        userId: otherId,
        name: other?.name ?? r.senderName ?? '?',
        lastContent: (r.lastContent ?? '').slice(0, 80),
        lastAt: r.lastAt,
      });
    }
    return threads;
  }

  async getMessages(tenantId: string, userId: string, recipientId: string, limit = 100) {
    await this.assertRecipientInTenant(tenantId, recipientId);
    return this.repo.find({
      where: [
        { tenantId, senderId: userId, recipientId },
        { tenantId, senderId: recipientId, recipientId: userId },
      ],
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async sendMessage(
    tenantId: string,
    senderId: string,
    senderName: string,
    recipientId: string,
    content: string,
  ): Promise<InternalChatMessage> {
    await this.assertRecipientInTenant(tenantId, recipientId);
    const msg = this.repo.create({
      tenantId,
      senderId,
      senderName,
      recipientId,
      content,
    });
    return this.repo.save(msg);
  }
}
