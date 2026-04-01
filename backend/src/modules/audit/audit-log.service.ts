import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export type AuditActor = {
  userId: string;
  userEmail?: string;
  userType: 'master_user' | 'user' | 'system';
};

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(
    action: string,
    entityType: string,
    entityId: string,
    actor: AuditActor,
    details?: Record<string, any>,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = manager ? manager.getRepository(AuditLog) : this.repo;
    const entry = repository.create({
      action,
      entityType,
      entityId,
      userId: actor.userId,
      userEmail: actor.userEmail,
      userType: actor.userType,
      details: details ?? {},
    });
    await repository.save(entry);
  }

  async listPaged(params: {
    limit?: number;
    offset?: number;
    action?: string;
    entityType?: string;
  }) {
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const offset = Math.max(Number(params.offset) || 0, 0);

    const qb = this.repo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (params.action?.trim()) {
      qb.andWhere('a.action ILIKE :action', { action: `%${params.action.trim()}%` });
    }
    if (params.entityType?.trim()) {
      qb.andWhere('a.entity_type = :entityType', { entityType: params.entityType.trim() });
    }
    qb.take(limit).skip(offset);
    const [logs, total] = await qb.getManyAndCount();
    return { logs, total, limit, offset };
  }
}

