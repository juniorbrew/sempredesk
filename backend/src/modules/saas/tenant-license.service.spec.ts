import { ForbiddenException } from '@nestjs/common';
import { TenantLicenseService } from './tenant-license.service';

describe('TenantLicenseService', () => {
  function createService() {
    const repo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const tenants = {
      findOne: jest.fn(),
    };
    const service = new TenantLicenseService(repo as any, tenants as any);
    return { service, repo, tenants };
  }

  it('consulta apenas os campos necessarios do tenant ao validar operacao', async () => {
    const { service, tenants, repo } = createService();
    tenants.findOne.mockResolvedValue({ id: 'tenant-1', status: 'active' });
    repo.findOne.mockResolvedValue(null);

    await service.assertTenantOperational('tenant-1');

    expect(tenants.findOne).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: {
        id: true,
        status: true,
      },
    });
  });

  it('bloqueia tenant suspenso sem depender de outras colunas', async () => {
    const { service, tenants } = createService();
    tenants.findOne.mockResolvedValue({ id: 'tenant-1', status: 'suspended' });

    await expect(service.assertTenantOperational('tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('trata ausencia da tabela tenant_licenses como compatibilidade legado', async () => {
    const { service, tenants, repo } = createService();
    tenants.findOne.mockResolvedValue({ id: 'tenant-1', status: 'active' });
    repo.findOne.mockRejectedValueOnce(Object.assign(new Error('relation "tenant_licenses" does not exist'), { code: '42P01' }));

    await expect(service.assertTenantOperational('tenant-1')).resolves.toBeUndefined();
  });

  it('nao mascara undefined_column inesperado na validacao de licenca', async () => {
    const { service, tenants, repo } = createService();
    const erro = Object.assign(new Error('column tenant.plan_code does not exist'), { code: '42703' });
    tenants.findOne.mockResolvedValue({ id: 'tenant-1', status: 'active' });
    repo.findOne.mockRejectedValueOnce(erro);

    await expect(service.assertTenantOperational('tenant-1')).rejects.toBe(erro);
  });
});
