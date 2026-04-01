import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AuthModule],
  controllers: [AdminAuditLogsController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}

