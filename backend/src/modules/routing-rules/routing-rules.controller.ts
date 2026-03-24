import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RoutingRulesService } from './routing-rules.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('routing-rules')
export class RoutingRulesController {
  constructor(private readonly svc: RoutingRulesService) {}

  @Get()
  @RequirePermission('settings.manage')
  findAll(@TenantId() tenantId: string) {
    return this.svc.findAll(tenantId);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.create(tenantId, dto);
  }

  @Put(':id')
  @RequirePermission('settings.manage')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.remove(tenantId, id);
  }
}
