import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ApiKeysService } from './api-keys.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

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

  @Delete(':id/revoke')
  @RequirePermission('settings.manage')
  revoke(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.revoke(tenantId, id);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.remove(tenantId, id);
  }
}
