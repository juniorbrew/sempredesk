import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TagsService } from './tags.service';
import { CreateTagDto, FilterTagDto, UpdateTagDto } from './dto/tag.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: CreateTagDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('ticket.view')
  findAll(@TenantId() tenantId: string, @Query() filters: FilterTagDto) {
    return this.service.findAll(tenantId, filters);
  }

  @Get(':id')
  @RequirePermission('ticket.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('settings.manage')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
