import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from './api-key.entity';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
  ) {}

  findAll(tenantId: string): Promise<ApiKey[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  async create(tenantId: string, dto: Partial<ApiKey>): Promise<ApiKey & { rawKey: string }> {
    const rawKey = `sk_${crypto.randomBytes(24).toString('hex')}`;
    const apiKey = this.repo.create({ ...dto, tenantId, key: rawKey });
    const saved = await this.repo.save(apiKey);
    return { ...saved, rawKey };
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    await this.repo.update({ id, tenantId }, { active: false });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.repo.delete({ id, tenantId });
  }

  async validate(key: string): Promise<ApiKey | null> {
    const apiKey = await this.repo.findOne({ where: { key, active: true } });
    if (!apiKey) return null;
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;
    await this.repo.update(apiKey.id, { lastUsedAt: new Date() });
    return apiKey;
  }
}
