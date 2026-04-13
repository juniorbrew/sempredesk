import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TeamService } from './team.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  /** ticket.view: lista de técnicos na ficha / atribuição; agent.view: gestão de equipe */
  @RequirePermission('agent.view', 'ticket.view')
  findAll(@TenantId() tenantId: string, @Request() req: any) {
    return this.teamService.findTechnicians(tenantId, req.user?.networkId);
  }

  @Post()
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles('admin', 'super_admin')
  @RequirePermission('agent.create')
  create(@TenantId() tenantId: string, @Body() dto: any, @Request() req: any) {
    return this.teamService.create(tenantId, dto, req.user?.role);
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission('agent.view', 'ticket.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.teamService.findOne(tenantId, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles('admin', 'super_admin')
  @RequirePermission('agent.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any, @Request() req: any) {
    return this.teamService.update(tenantId, id, dto, req.user?.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles('admin', 'super_admin')
  @RequirePermission('agent.delete')
  remove(@TenantId() tenantId: string, @Param('id') id: string, @Request() req: any) {
    return this.teamService.remove(tenantId, id, req.user?.role);
  }
}
