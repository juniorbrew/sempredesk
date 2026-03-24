import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PermissionsService } from './permissions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly svc: PermissionsService) {}

  /** Lista todas as permissões disponíveis agrupadas por módulo */
  @Get()
  async getAllPermissions() {
    const perms = await this.svc.getAllPermissions();
    const grouped: Record<string, typeof perms> = {};
    for (const p of perms) {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push(p);
    }
    return grouped;
  }

  /** Lista todos os perfis com suas permissões */
  @Get('roles')
  getAllRoles() {
    return this.svc.getAllRoles();
  }

  /** Busca um perfil por ID */
  @Get('roles/:id')
  getRoleById(@Param('id') id: string) {
    return this.svc.getRoleById(id);
  }

  /** Cria novo perfil personalizado */
  @Post('roles')
  createRole(@Body() body: { slug: string; name: string; description?: string; permissions?: string[] }) {
    return this.svc.createRole(body.slug, body.name, body.description, body.permissions ?? []);
  }

  /** Atualiza nome e descrição de um perfil */
  @Put('roles/:id')
  updateRole(@Param('id') id: string, @Body() body: { name?: string; description?: string }) {
    return this.svc.updateRole(id, body);
  }

  /** Define as permissões de um perfil (substitui todas) */
  @Put('roles/:id/permissions')
  setRolePermissions(@Param('id') id: string, @Body() body: { permissions: string[] }) {
    return this.svc.setRolePermissions(id, body.permissions ?? []);
  }

  /** Remove um perfil personalizado (perfis do sistema são protegidos) */
  @Delete('roles/:id')
  deleteRole(@Param('id') id: string) {
    return this.svc.deleteRole(id);
  }
}
