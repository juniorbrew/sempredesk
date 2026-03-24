import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { PERMISSIONS, USER_ROLE_TO_SLUG } from './permissions.constants';

const SYSTEM_ROLES = ['super_admin', 'admin', 'manager', 'technician', 'viewer'];

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async hasPermission(userRole: string, permissionCode: string): Promise<boolean> {
    if (!userRole) return false;
    if (userRole === 'super_admin') return true;

    const slug = USER_ROLE_TO_SLUG[userRole] ?? userRole;
    const role = await this.roleRepo.findOne({
      where: { slug },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    if (!role?.rolePermissions?.length) return false;

    const codes = role.rolePermissions.map((rp) => rp.permission?.code).filter(Boolean);
    return codes.includes(permissionCode);
  }

  async getPermissionsByRole(userRole: string): Promise<string[]> {
    if (!userRole) return [];
    if (userRole === 'super_admin') return Object.values(PERMISSIONS);

    const slug = USER_ROLE_TO_SLUG[userRole] ?? userRole;
    const role = await this.roleRepo.findOne({
      where: { slug },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    if (!role?.rolePermissions?.length) return [];

    return role.rolePermissions
      .map((rp) => rp.permission?.code)
      .filter((c): c is string => !!c);
  }

  // ─── Gestão de Perfis ────────────────────────────────────────────

  async getAllPermissions(): Promise<Permission[]> {
    return this.permissionRepo.find({ order: { module: 'ASC', code: 'ASC' } });
  }

  async getAllRoles(): Promise<Array<Role & { permissions: string[] }>> {
    const roles = await this.roleRepo.find({
      relations: ['rolePermissions', 'rolePermissions.permission'],
      order: { createdAt: 'ASC' },
    });
    return roles.map((role) => ({
      ...role,
      permissions: (role.rolePermissions ?? [])
        .map((rp) => rp.permission?.code)
        .filter((c): c is string => !!c),
    }));
  }

  async getRoleById(id: string): Promise<Role & { permissions: string[] }> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    if (!role) throw new NotFoundException('Perfil não encontrado');
    return {
      ...role,
      permissions: (role.rolePermissions ?? [])
        .map((rp) => rp.permission?.code)
        .filter((c): c is string => !!c),
    };
  }

  async createRole(slug: string, name: string, description?: string, permissionCodes: string[] = []): Promise<Role & { permissions: string[] }> {
    const existing = await this.roleRepo.findOne({ where: { slug } });
    if (existing) throw new BadRequestException(`Perfil com slug "${slug}" já existe`);

    let role = this.roleRepo.create({ slug, name, description });
    role = await this.roleRepo.save(role);

    if (permissionCodes.length) {
      await this._setPermissions(role.id, permissionCodes);
    }

    return this.getRoleById(role.id);
  }

  async updateRole(id: string, data: { name?: string; description?: string }): Promise<Role & { permissions: string[] }> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Perfil não encontrado');

    if (data.name !== undefined) role.name = data.name;
    if (data.description !== undefined) role.description = data.description;
    await this.roleRepo.save(role);

    return this.getRoleById(id);
  }

  async setRolePermissions(id: string, permissionCodes: string[]): Promise<Role & { permissions: string[] }> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Perfil não encontrado');

    await this._setPermissions(id, permissionCodes);
    return this.getRoleById(id);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Perfil não encontrado');
    if (SYSTEM_ROLES.includes(role.slug)) {
      throw new BadRequestException('Perfis do sistema não podem ser removidos');
    }
    await this.rolePermissionRepo.delete({ roleId: id });
    await this.roleRepo.delete(id);
  }

  private async _setPermissions(roleId: string, codes: string[]): Promise<void> {
    await this.rolePermissionRepo.delete({ roleId });

    if (!codes.length) return;

    const permissions = await this.permissionRepo.find({ where: { code: In(codes) } });
    const rps = permissions.map((p) =>
      this.rolePermissionRepo.create({ roleId, permissionId: p.id }),
    );
    await this.rolePermissionRepo.save(rps);
  }

  // ─── Seed ────────────────────────────────────────────────────────

  async seed(): Promise<void> {
    const allCodes = Object.values(PERMISSIONS);
    const permissionMap = new Map<string, Permission>();

    for (const code of allCodes) {
      let p = await this.permissionRepo.findOne({ where: { code } });
      if (!p) {
        p = this.permissionRepo.create({
          code,
          name: code.replace('.', ' '),
          module: code.split('.')[0],
        });
        p = await this.permissionRepo.save(p);
      }
      permissionMap.set(code, p);
    }

    const roleConfigs: Array<{ slug: string; name: string; permissions: string[] }> = [
      { slug: 'super_admin', name: 'Super Administrador', permissions: allCodes },
      { slug: 'admin',       name: 'Administrador',       permissions: allCodes },
      {
        slug: 'manager', name: 'Supervisor',
        permissions: [
          PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_CREATE,
          PERMISSIONS.TICKET_EDIT, PERMISSIONS.TICKET_REPLY, PERMISSIONS.TICKET_TRANSFER,
          PERMISSIONS.TICKET_CLOSE, PERMISSIONS.TICKET_REOPEN, PERMISSIONS.CUSTOMER_VIEW,
          PERMISSIONS.CUSTOMER_CREATE, PERMISSIONS.CUSTOMER_EDIT, PERMISSIONS.AGENT_VIEW,
          PERMISSIONS.REPORTS_VIEW, PERMISSIONS.KNOWLEDGE_VIEW, PERMISSIONS.KNOWLEDGE_EDIT,
          PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.NETWORKS_VIEW, PERMISSIONS.NETWORKS_EDIT,
          PERMISSIONS.DEVICES_VIEW, PERMISSIONS.DEVICES_EDIT, PERMISSIONS.ALERTS_VIEW,
          PERMISSIONS.CHAT_VIEW, PERMISSIONS.CHAT_VIEW_AGENTS, PERMISSIONS.CHAT_VIEW_STATUS,
          PERMISSIONS.ATTENDANCE_VIEW, PERMISSIONS.TICKET_VIEW_ALL, PERMISSIONS.ATTENDANCE_VIEW_ALL,
        ],
      },
      {
        slug: 'technician', name: 'Agente',
        permissions: [
          PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_CREATE,
          PERMISSIONS.TICKET_EDIT, PERMISSIONS.TICKET_REPLY, PERMISSIONS.TICKET_CLOSE,
          PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.KNOWLEDGE_VIEW,
          PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.DEVICES_VIEW, PERMISSIONS.DEVICES_EDIT,
          PERMISSIONS.ALERTS_VIEW, PERMISSIONS.CHAT_VIEW, PERMISSIONS.CHAT_VIEW_AGENTS,
          PERMISSIONS.CHAT_VIEW_STATUS, PERMISSIONS.ATTENDANCE_VIEW,
        ],
      },
      {
        slug: 'viewer', name: 'Visualizador',
        permissions: [
          PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.TICKET_VIEW, PERMISSIONS.CUSTOMER_VIEW,
          PERMISSIONS.AGENT_VIEW, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.KNOWLEDGE_VIEW,
          PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.DEVICES_VIEW, PERMISSIONS.ALERTS_VIEW,
          PERMISSIONS.ATTENDANCE_VIEW,
        ],
      },
    ];

    for (const config of roleConfigs) {
      let role = await this.roleRepo.findOne({ where: { slug: config.slug } });
      if (!role) {
        role = this.roleRepo.create({ slug: config.slug, name: config.name });
        role = await this.roleRepo.save(role);
      }

      const existing = await this.rolePermissionRepo.find({ where: { roleId: role.id } });
      const existingPermIds = new Set(existing.map((e) => e.permissionId));

      for (const code of config.permissions) {
        const perm = permissionMap.get(code);
        if (!perm || existingPermIds.has(perm.id)) continue;
        const rp = this.rolePermissionRepo.create({ roleId: role.id, permissionId: perm.id });
        await this.rolePermissionRepo.save(rp);
        existingPermIds.add(perm.id);
      }
    }
  }
}
