import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @RequirePermission('dashboard.view')
  getSummary(@Request() req) {
    return this.dashboardService.getSummary(req.tenantId);
  }

  @Get('tickets-by-priority')
  @RequirePermission('dashboard.view')
  getByPriority(@Request() req) {
    return this.dashboardService.getTicketsByPriority(req.tenantId);
  }

  @Get('ticket-trend')
  @RequirePermission('dashboard.view')
  getTrend(@Request() req, @Query('days') days?: string) {
    return this.dashboardService.getTicketTrend(req.tenantId, days ? parseInt(days) : 7);
  }

  @Get('sla-report')
  @RequirePermission('reports.view')
  getSlaReport(@Request() req) {
    return this.dashboardService.getSlaReport(req.tenantId);
  }
}
