import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantPriority } from './entities/tenant-priority.entity';
import { SlaPolicy } from '../sla/entities/sla-policy.entity';
import { TenantPrioritiesService } from './tenant-priorities.service';
import { TenantPrioritiesController } from './tenant-priorities.controller';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantPriority, SlaPolicy]),
    PermissionsModule,
  ],
  controllers: [TenantPrioritiesController],
  providers: [TenantPrioritiesService],
  exports: [TenantPrioritiesService],
})
export class TenantPrioritiesModule {}
