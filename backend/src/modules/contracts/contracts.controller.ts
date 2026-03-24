import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { Controller, Get, Post, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @RequirePermission('contracts.edit')
  create(@TenantId() tenantId: string, @Body() dto: CreateContractDto) {
    return this.contractsService.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('contracts.view')
  findAll(@TenantId() tenantId: string) {
    return this.contractsService.findByTenant(tenantId);
  }

  @Get('expiring')
  @RequirePermission('contracts.view')
  getExpiring(@TenantId() tenantId: string) {
    return this.contractsService.getExpiringSoon(tenantId);
  }

  @Get(':id')
  @RequirePermission('contracts.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.contractsService.findOne(tenantId, id);
  }

  @Get(':id/consumption')
  @RequirePermission('contracts.view')
  getConsumption(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.contractsService.getConsumption(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('contracts.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contractsService.update(tenantId, id, dto);
  }
}
