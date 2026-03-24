import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NetworksService } from './networks.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('networks')
export class NetworksController {
  constructor(private readonly svc: NetworksService) {}

  @Post()
  @RequirePermission('networks.edit')
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('networks.view')
  findAll(@TenantId() tenantId: string, @Query('search') search?: string) {
    return this.svc.findAll(tenantId, search);
  }

  @Get(':id')
  @RequirePermission('networks.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('networks.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('networks.edit')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.remove(tenantId, id);
  }
}
