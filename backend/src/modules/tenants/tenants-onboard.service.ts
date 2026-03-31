import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from './tenant.entity';
import { PLAN_LIMITS } from './tenants.service';
import { TenantLicense } from '../saas/tenant-license.entity';
import { User } from '../auth/user.entity';
import { TenantLicenseService } from '../saas/tenant-license.service';
import { AuditActor, AuditLogService } from '../audit/audit-log.service';
import { CreateTenantOnboardDto } from './dto/create-tenant-onboard.dto';

@Injectable()
export class TenantsOnboardService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly licenseSvc: TenantLicenseService,
    private readonly audit: AuditLogService,
  ) {}

  async onboard(dto: CreateTenantOnboardDto, actor: AuditActor) {
    const planSlug = dto.planSlug || 'starter';

    return this.dataSource.transaction(async (em) => {
      const tenantRepo = em.getRepository(Tenant);
      const userRepo = em.getRepository(User);
      const licenseRepo = em.getRepository(TenantLicense);

      const existingTenant = await tenantRepo.findOne({ where: { slug: dto.slug } });
      if (existingTenant) throw new ConflictException('Slug já utilizado por outra empresa');

      const existingUser = await userRepo.findOne({ where: { email: dto.adminEmail } });
      if (existingUser) throw new ConflictException('E-mail do admin já está em uso');

      const tenant = tenantRepo.create();
      Object.assign(tenant, {
        name: dto.name,
        slug: dto.slug,
        email: dto.email,
        phone: dto.phone,
        plan: planSlug,
        status: 'trial',
        limits: PLAN_LIMITS[planSlug] ?? PLAN_LIMITS.starter,
      });
      await tenantRepo.save(tenant);

      const licensePayload = this.licenseSvc.buildInitialLicensePayload(tenant.id, planSlug);
      const license = licenseRepo.create();
      Object.assign(license, licensePayload);
      await licenseRepo.save(license);

      const admin = userRepo.create();
      Object.assign(admin, {
        name: dto.adminName,
        email: dto.adminEmail,
        password: dto.adminPassword || 'Mudar@123',
        role: 'admin',
        tenantId: tenant.id,
        status: 'active',
        settings: { forcePasswordChange: !dto.adminPassword },
      });
      await userRepo.save(admin);

      await this.audit.log(
        'TENANT_CREATED',
        'tenant',
        tenant.id,
        actor,
        { name: tenant.name, slug: tenant.slug, plan: planSlug },
        em,
      );

      await this.audit.log(
        'LICENSE_CREATED',
        'tenant_license',
        license.id,
        actor,
        { tenantId: tenant.id, plan: planSlug, status: license.status, expiresAt: license.expiresAt },
        em,
      );

      await this.audit.log(
        'TENANT_ADMIN_CREATED',
        'user',
        admin.id,
        actor,
        { tenantId: tenant.id, email: admin.email, role: admin.role },
        em,
      );

      return {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          plan: tenant.plan,
          limits: tenant.limits,
        },
        license: {
          id: license.id,
          status: license.status,
          planSlug: license.planSlug,
          billingCycle: license.billingCycle,
          startedAt: license.startedAt,
          expiresAt: license.expiresAt,
        },
        admin: {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          mustChangePassword: !dto.adminPassword,
        },
      };
    });
  }
}

