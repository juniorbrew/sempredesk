import { Controller, Get, UseGuards } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard, Public } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Public()
  @Get('health')
  health() {
    return this.monitoringService.health();
  }

  @UseGuards(JwtAuthGuard)
  @Get('tenant')
  tenantStats(@TenantId() tenantId: string) {
    return this.monitoringService.tenantStats(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get('global')
  globalStats() {
    return this.monitoringService.globalStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get('suspicious')
  suspicious() {
    return this.monitoringService.suspiciousActivity();
  }
}
