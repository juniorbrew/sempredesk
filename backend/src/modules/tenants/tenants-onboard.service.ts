import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from './tenant.entity';
import { PLAN_LIMITS } from './tenants.service';
import { TenantLicense } from '../saas/tenant-license.entity';
import { User } from '../auth/user.entity';
import { TenantSettings } from '../settings/settings.entity';
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
      const settingsRepo = em.getRepository(TenantSettings);

      const existingTenant = await tenantRepo.findOne({ where: { slug: dto.slug } });
      if (existingTenant) throw new ConflictException('Slug já utilizado por outra empresa');

      const existingUser = await userRepo.findOne({ where: { email: dto.adminEmail } });
      if (existingUser) throw new ConflictException('E-mail do admin já está em uso');

      // Monta dados complementares da empresa para settings.empresa (sem nova coluna)
      const empresaSettings: Record<string, string> = {};
      if (dto.razaoSocial)  empresaSettings.razaoSocial  = dto.razaoSocial;
      if (dto.nomeFantasia) empresaSettings.nomeFantasia = dto.nomeFantasia;
      if (dto.logradouro)   empresaSettings.logradouro   = dto.logradouro;
      if (dto.numero)       empresaSettings.numero       = dto.numero;
      if (dto.complemento)  empresaSettings.complemento  = dto.complemento;
      if (dto.bairro)       empresaSettings.bairro       = dto.bairro;
      if (dto.cidade)       empresaSettings.cidade       = dto.cidade;
      if (dto.uf)           empresaSettings.uf           = dto.uf;
      if (dto.cep)          empresaSettings.cep          = dto.cep;

      const tenant = tenantRepo.create();
      Object.assign(tenant, {
        name: dto.name,
        slug: dto.slug,
        cnpj: dto.cnpj,
        email: dto.email,
        phone: dto.phone,
        plan: planSlug,
        status: 'trial',
        limits: PLAN_LIMITS[planSlug] ?? PLAN_LIMITS.starter,
        settings: Object.keys(empresaSettings).length ? { empresa: empresaSettings } : {},
      });
      await tenantRepo.save(tenant);

      // Provisiona tenant_settings já com os dados do cadastro para que o painel
      // interno não abra em branco. O SettingsService reutiliza este registro normalmente.
      const addressParts = [
        dto.logradouro,
        dto.numero,
        dto.complemento,
        dto.bairro,
        dto.cidade && dto.uf ? `${dto.cidade}/${dto.uf}` : (dto.cidade || dto.uf),
        dto.cep,
      ].filter(Boolean);
      const tenantSettings = settingsRepo.create({
        tenantId: tenant.id,
        companyName: dto.nomeFantasia || dto.razaoSocial || dto.name,
        companyEmail: dto.email,
        companyPhone: dto.phone,
        companyCnpj: dto.cnpj,
        companyAddress: addressParts.length ? addressParts.join(', ') : undefined,
      });
      await settingsRepo.save(tenantSettings);

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
          cnpj: tenant.cnpj,
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

  async list(search?: string, status?: string) {
    const tenantRepo = this.dataSource.getRepository(Tenant);
    const rows = await tenantRepo
      .createQueryBuilder('t')
      .where(status ? 't.status = :status' : '1=1', status ? { status } : {})
      .andWhere(
        search
          ? '(LOWER(t.name) LIKE LOWER(:q) OR LOWER(t.email) LIKE LOWER(:q) OR LOWER(t.slug) LIKE LOWER(:q) OR t.cnpj LIKE :qRaw)'
          : '1=1',
        search ? { q: `%${search}%`, qRaw: `%${search}%` } : {},
      )
      .orderBy('t.created_at', 'DESC')
      .getMany();

    const data = await Promise.all(
      rows.map(async (t) => {
        const lic = await this.licenseSvc.getLatestLicense(t.id);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          cnpj: t.cnpj,
          email: t.email,
          status: t.status,
          plan: t.plan,
          license: lic
            ? {
                id: lic.id,
                status: lic.status,
                planSlug: lic.planSlug,
                expiresAt: lic.expiresAt,
              }
            : null,
        };
      }),
    );
    return data;
  }

  async getById(id: string) {
    const tenantRepo = this.dataSource.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    const license = await this.licenseSvc.getLatestLicense(id);
    return {
      ...tenant,
      license: license
        ? {
            id: license.id,
            status: license.status,
            planSlug: license.planSlug,
            billingCycle: license.billingCycle,
            startedAt: license.startedAt,
            expiresAt: license.expiresAt,
          }
        : null,
    };
  }

  async setStatus(id: string, newStatus: 'active' | 'suspended', actor: AuditActor) {
    const tenantRepo = this.dataSource.getRepository(Tenant);
    const tenant = await tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    const oldStatus = tenant.status;
    tenant.status = newStatus;
    await tenantRepo.save(tenant);

    const lic = await this.licenseSvc.getLatestLicense(id);
    if (lic) {
      lic.status = newStatus === 'suspended' ? 'suspended' : 'active';
      await this.dataSource.getRepository(TenantLicense).save(lic);
    }

    await this.audit.log(
      'TENANT_STATUS_CHANGED',
      'tenant',
      id,
      actor,
      { oldStatus, newStatus },
    );
    return this.getById(id);
  }

  async renew(id: string, periodDays: number, actor: AuditActor) {
    const license = await this.licenseSvc.renewLicense(id, periodDays);
    await this.audit.log(
      'LICENSE_RENEWED',
      'tenant_license',
      license.id,
      actor,
      { tenantId: id, periodDays, expiresAt: license.expiresAt },
    );
    return this.getById(id);
  }
}

