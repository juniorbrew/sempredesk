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

  async getLatestLicense(tenantId: string) {
    return this.repo.findOne({
      where: { tenantId } as any,
      order: { createdAt: 'DESC' },
    });
  }

  async renewLicense(tenantId: string, periodDays = 30) {
    const latest = await this.getLatestLicense(tenantId);
    const base = latest?.expiresAt && new Date(latest.expiresAt) > new Date() ? new Date(latest.expiresAt) : new Date();
    const expiresAt = new Date(base.getTime() + periodDays * 24 * 60 * 60 * 1000);

    if (!latest) {
      const created = this.repo.create({
        tenantId,
        planSlug: 'starter',
        status: 'active',
        billingCycle: 'monthly',
        startedAt: new Date(),
        expiresAt,
        cancelledAt: null,
        extraLimits: {},
        meta: { renewedBy: 'manual' },
      } as any);
      return this.repo.save(created as any) as Promise<TenantLicense>;
    }

    latest.status = 'active';
    latest.expiresAt = expiresAt;
    latest.cancelledAt = null;
    return this.repo.save(latest as any) as Promise<TenantLicense>;
  }
}

