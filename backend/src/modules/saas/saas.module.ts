import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantLicense } from './tenant-license.entity';
import { TenantLicenseService } from './tenant-license.service';
import { Tenant } from '../tenants/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantLicense, Tenant])],
  providers: [TenantLicenseService],
  exports: [TenantLicenseService],
})
export class SaasModule {}

