import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  Controller, Get, Post, Put, Body, Param, Query,
  UseGuards, Request, Headers,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post()
  @RequirePermission('devices.edit')
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.devicesService.create(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get()
  @RequirePermission('devices.view')
  findAll(@TenantId() tenantId: string, @Query('clientId') clientId?: string) {
    return this.devicesService.findAll(tenantId, clientId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('summary')
  @RequirePermission('devices.view')
  getSummary(@TenantId() tenantId: string) {
    return this.devicesService.getSummary(tenantId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get('offline')
  @RequirePermission('devices.view')
  getOffline(@TenantId() tenantId: string) {
    return this.devicesService.getOfflineDevices(tenantId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get(':id')
  @RequirePermission('devices.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.devicesService.findOne(tenantId, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Put(':id')
  @RequirePermission('devices.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any) {
    return this.devicesService.update(tenantId, id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get(':id/events')
  @RequirePermission('devices.view')
  getEvents(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.devicesService.getEvents(tenantId, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get(':id/metrics')
  @RequirePermission('devices.view')
  getMetrics(@TenantId() tenantId: string, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.devicesService.getMetricsHistory(tenantId, id, limit ? parseInt(limit, 10) : 100);
  }

  @Post(':id/heartbeat')
  heartbeat(@Headers('x-device-token') token: string, @Body() body: any) {
    return this.devicesService.processHeartbeat(token, body?.metrics);
  }
}
