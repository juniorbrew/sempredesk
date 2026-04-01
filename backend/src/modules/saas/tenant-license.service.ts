import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantLicense } from './tenant-license.entity';
import { Tenant } from '../tenants/tenant.entity';
import {
  TENANT_LICENSE_BLOCKED_CODE,
  TENANT_LICENSE_BLOCK_REASON_KEY,
} from './tenant-license.constants';

@Injectable()
export class TenantLicenseService {
  constructor(
    @InjectRepository(TenantLicense)
    private readonly repo: Repository<TenantLicense>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
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

  /**
   * Garante que o tenant pode usar a API (empresa ativa + licença não expirada / não cancelada).
   * Sem linha em tenant_licenses: não bloqueia (compatibilidade com tenants antigos).
   */
  async assertTenantOperational(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new ForbiddenException({
        message: 'Empresa inválida',
        code: TENANT_LICENSE_BLOCKED_CODE,
        reasonKey: TENANT_LICENSE_BLOCK_REASON_KEY.INVALID_TENANT,
      });
    }
    if (tenant.status === 'suspended') {
      throw new ForbiddenException({
        message: 'Esta empresa está suspensa. Contacte o suporte SempreDesk.',
        code: TENANT_LICENSE_BLOCKED_CODE,
        reasonKey: TENANT_LICENSE_BLOCK_REASON_KEY.TENANT_SUSPENDED,
      });
    }

    const lic = await this.getLatestLicense(tenantId);
    if (!lic) return;

    const inactive = ['suspended', 'cancelled', 'expired'];
    if (inactive.includes(lic.status)) {
      throw new ForbiddenException({
        message: 'Licença inativa. Contacte o suporte SempreDesk.',
        code: TENANT_LICENSE_BLOCKED_CODE,
        reasonKey: TENANT_LICENSE_BLOCK_REASON_KEY.LICENSE_INACTIVE,
      });
    }
    if (lic.expiresAt && new Date(lic.expiresAt).getTime() < Date.now()) {
      throw new ForbiddenException({
        message: 'Licença expirada. Renove o plano para continuar.',
        code: TENANT_LICENSE_BLOCKED_CODE,
        reasonKey: TENANT_LICENSE_BLOCK_REASON_KEY.LICENSE_EXPIRED,
      });
    }
  }
}

