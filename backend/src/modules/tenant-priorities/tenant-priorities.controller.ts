import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TenantPrioritiesService } from './tenant-priorities.service';
import {
  CreateTenantPriorityDto,
  SetTenantPriorityActiveDto,
  UpdateTenantPriorityDto,
} from './dto/tenant-priority.dto';

@Controller('tenant-priorities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TenantPrioritiesController {
  constructor(private readonly service: TenantPrioritiesService) {}

  @Get()
  @RequirePermission('settings.manage')
  findAll(@TenantId() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  /** Prioridades ativas para formulários de ticket / atendimento (antes de `:id`). */
  @Get('for-tickets')
  @RequirePermission('ticket.view')
  findAllForTicketUi(
    @TenantId() tenantId: string,
    @Query('currentPriorityId') currentPriorityId?: string,
  ) {
    return this.service.findAllForTicketUi(tenantId, currentPriorityId || undefined);
  }

  @Get(':id')
  @RequirePermission('settings.manage')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: CreateTenantPriorityDto) {
    return this.service.create(tenantId, dto);
  }

  @Put(':id')
  @RequirePermission('settings.manage')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenantPriorityDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Patch(':id/active')
  @RequirePermission('settings.manage')
  setActive(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetTenantPriorityActiveDto,
  ) {
    return this.service.setActive(tenantId, id, dto.active);
  }
}
