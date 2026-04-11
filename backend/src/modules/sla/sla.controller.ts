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
  @RequirePermission('settings.manage')
  findAll(@TenantId() tenantId: string) {
    return this.slaService.findAll(tenantId);
  }

  /** Detalhe de uma política SLA. */
  @Get(':id')
  @RequirePermission('settings.manage')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.slaService.findOne(tenantId, id);
  }

  /** Cria uma nova política SLA. */
  @Post()
  @RequirePermission('settings.manage')
  create(@TenantId() tenantId: string, @Body() dto: CreateSlaPolicyDto) {
    return this.slaService.create(tenantId, dto);
  }

  /** Atualiza uma política SLA existente. */
  @Put(':id')
  @RequirePermission('settings.manage')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
  ) {
    return this.slaService.update(tenantId, id, dto);
  }

  /** Remove uma política SLA. */
  @Delete(':id')
  @RequirePermission('settings.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.slaService.remove(tenantId, id);
  }
}
