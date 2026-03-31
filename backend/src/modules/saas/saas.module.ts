import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantLicense } from './tenant-license.entity';
import { TenantLicenseService } from './tenant-license.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantLicense])],
  providers: [TenantLicenseService],
  exports: [TenantLicenseService],
})
export class SaasModule {}

