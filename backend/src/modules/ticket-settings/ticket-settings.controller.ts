import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TicketSettingsService } from './ticket-settings.service';
import {
  CreateTicketSettingDto,
  UpdateTicketSettingDto,
  FilterTicketSettingDto,
} from './dto/ticket-setting.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ticket-settings')
export class TicketSettingsController {
  constructor(private readonly service: TicketSettingsService) {}

  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: CreateTicketSettingDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('settings.manage')
  findAll(@TenantId() tenantId: string, @Query() filters: FilterTicketSettingDto) {
    return this.service.findAll(tenantId, filters);
  }

  @Get('tree')
  @RequirePermission('settings.manage')
  findTree(@TenantId() tenantId: string) {
    return this.service.findTree(tenantId);
  }

  @Get('departments')
  @RequirePermission('settings.manage')
  findDepartments(@TenantId() tenantId: string) {
    return this.service.findDepartmentsList(tenantId).then((list) => ({ departments: list }));
  }

  @Get(':id')
  @RequirePermission('settings.manage')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('settings.manage')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTicketSettingDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
