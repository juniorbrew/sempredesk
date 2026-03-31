import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantLicense } from './tenant-license.entity';

@Injectable()
export class TenantLicenseService {
  constructor(
    @InjectRepository(TenantLicense)
    private readonly repo: Repository<TenantLicense>,
  ) {}

  buildInitialLicensePayload(tenantId: string, planSlug: string) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return {
      tenantId,
      planSlug,
      status: 'trial' as const,
      billingCycle: 'monthly' as const,
      startedAt: now,
      expiresAt,
      cancelledAt: null,
      extraLimits: {},
      meta: {},
    };
  }

  async createInitialLicense(tenantId: string, planSlug: string) {
    const payload = this.buildInitialLicensePayload(tenantId, planSlug);
    const lic = this.repo.create(payload as any);
    return this.repo.save(lic);
  }

  async getActiveLicense(tenantId: string) {
    return this.repo.findOne({
      where: { tenantId, status: 'active' as any },
      order: { startedAt: 'DESC' },
    });
  }
}

