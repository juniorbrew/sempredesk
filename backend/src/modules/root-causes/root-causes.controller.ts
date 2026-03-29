import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RootCausesService } from './root-causes.service';
import { CreateRootCauseDto, FilterRootCauseDto, UpdateRootCauseDto } from './dto/root-cause.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('root-causes')
export class RootCausesController {
  constructor(private readonly service: RootCausesService) {}

  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: CreateRootCauseDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('ticket.view')
  findAll(@TenantId() tenantId: string, @Query() filters: FilterRootCauseDto) {
    return this.service.findAll(tenantId, filters);
  }

  @Get(':id')
  @RequirePermission('ticket.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('settings.manage')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateRootCauseDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
