import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { AdminTenantsController } from './admin-tenants.controller';
import { TenantsOnboardService } from './tenants-onboard.service';
import { SaasModule } from '../saas/saas.module';
import { AuditLogModule } from '../audit/audit-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), SaasModule, AuditLogModule],
  providers: [TenantsService, TenantsOnboardService],
  controllers: [TenantsController, AdminTenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
