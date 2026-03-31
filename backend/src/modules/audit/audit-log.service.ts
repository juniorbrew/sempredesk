import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
    private readonly dataSource: DataSource,
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
}

