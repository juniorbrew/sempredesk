import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { SlaService } from './sla.service';
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from './dto/sla-policy.dto';

@Controller('sla-policies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  /** Lista todas as políticas SLA do tenant. */
  @Get()
  @RequirePermission('settings.view')
  findAll(@TenantId() tenantId: string) {
    return this.slaService.findAll(tenantId);
  }

  /** Detalhe de uma política SLA. */
  @Get(':id')
  @RequirePermission('settings.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.slaService.findOne(tenantId, id);
  }

  /** Cria uma nova política SLA. */
  @Post()
  @RequirePermission('settings.edit')
  create(@TenantId() tenantId: string, @Body() dto: CreateSlaPolicyDto) {
    return this.slaService.create(tenantId, dto);
  }

  /** Atualiza uma política SLA existente. */
  @Put(':id')
  @RequirePermission('settings.edit')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
  ) {
    return this.slaService.update(tenantId, id, dto);
  }

  /** Remove uma política SLA. */
  @Delete(':id')
  @RequirePermission('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.slaService.remove(tenantId, id);
  }
}
