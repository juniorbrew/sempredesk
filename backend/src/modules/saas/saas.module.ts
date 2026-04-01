import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantLicense } from './tenant-license.entity';
import { TenantLicenseService } from './tenant-license.service';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../auth/user.entity';
import { EmailModule } from '../email/email.module';
import { TrialLicenseReminderService } from './trial-license-reminder.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantLicense, Tenant, User]), EmailModule],
  providers: [TenantLicenseService, TrialLicenseReminderService],
  exports: [TenantLicenseService],
})
export class SaasModule {}

