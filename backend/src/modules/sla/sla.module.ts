import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlaPolicy } from './entities/sla-policy.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';
import { SlaService } from './sla.service';
import { SlaController } from './sla.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { EmailModule } from '../email/email.module';
import { SlaAlertScheduler } from './sla-alert.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([SlaPolicy, TenantPriority]),
    PermissionsModule,
    EmailModule,
  ],
  providers: [SlaService, SlaAlertScheduler],
  controllers: [SlaController],
  exports: [SlaService],
})
export class SlaModule {}
