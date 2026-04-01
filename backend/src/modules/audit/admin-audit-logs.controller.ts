import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLogService } from './audit-log.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/audit-logs')
export class AdminAuditLogsController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @Roles('super_admin')
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.audit.listPaged({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      action,
      entityType,
    });
  }
}
