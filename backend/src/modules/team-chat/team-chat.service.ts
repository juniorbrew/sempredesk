import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamChatMessage } from './team-chat.entity';

@Injectable()
export class TeamChatService {
  constructor(
    @InjectRepository(TeamChatMessage)
    private readonly repo: Repository<TeamChatMessage>,
  ) {}

  async getMessages(tenantId: string, channel = 'general', limit = 50): Promise<TeamChatMessage[]> {
    return this.repo.find({
      where: { tenantId, channel },
      order: { createdAt: 'DESC' },
      take: limit,
    }).then(msgs => msgs.reverse());
  }

  async postMessage(tenantId: string, authorId: string, authorName: string, content: string, channel = 'general', replyTo?: string): Promise<TeamChatMessage> {
    const msg = this.repo.create({ tenantId, authorId, authorName, content, channel, replyTo });
    return this.repo.save(msg);
  }

  async getChannels(tenantId: string): Promise<string[]> {
    const rows = await this.repo.createQueryBuilder('m')
      .select('DISTINCT m.channel', 'channel')
      .where('m.tenant_id = :tenantId', { tenantId })
      .getRawMany();
    const channels = rows.map(r => r.channel);
    if (!channels.includes('general')) channels.unshift('general');
    return channels;
  }
}
