import {
  Injectable, UnauthorizedException,
  ConflictException, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from './user.entity';
import { LoginDto, CreateUserDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  private attendanceSvc: any = null;
  private permissionsSvc: any = null;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  setPermissionsService(svc: any) { this.permissionsSvc = svc; }

  setAttendanceService(svc: any) { this.attendanceSvc = svc; }

  async login(dto: LoginDto, ipAddress?: string) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Credenciais inválidas');
    if (user.status !== 'active') throw new UnauthorizedException('Conta inativa');
    if (!await user.validatePassword(dto.password)) throw new UnauthorizedException('Credenciais inválidas');

    await this.users.update(user.id, { lastLogin: new Date() });

    // Clock-in automático
    if (this.attendanceSvc && user.tenantId) {
      try {
        await this.attendanceSvc.clockIn(user.tenantId, user.id, user.name, user.email, user.role, ipAddress);
      } catch {}
    }

    const tokens = await this.generateTokens(user);
    let permissions: string[] = [];
    if (this.permissionsSvc) {
      try { permissions = await this.permissionsSvc.getPermissionsByRole(user.role); } catch {}
    }
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId, permissions },
      ...tokens,
    };
  }

  async logout(tenantId: string, userId: string) {
    if (this.attendanceSvc && tenantId) {
      try { await this.attendanceSvc.clockOut(tenantId, userId, 'Logout automático'); } catch {}
    }
    return { success: true };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.cfg.get('JWT_REFRESH_SECRET', 'suporte-tecnico-refresh-secret-2024'),
      }) as any;
      const user = await this.users.findOne({ where: { id: payload.sub } });
      if (!user || user.status !== 'active') throw new Error();
      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }
  }

  async createUser(tenantId: string, dto: CreateUserDto) {
    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('E-mail já cadastrado');
    const { tenantId: _tenantId, tenant_id: _tenant_id, lastLogin: _lastLogin, ...safeDto } = dto as any;
    const user = this.users.create({ ...safeDto, tenantId, role: dto.role as any } as any);
    const saved: any = await this.users.save(user as any);
    return typeof saved?.toJSON === 'function' ? saved.toJSON() : saved;
  }

  async findUsers(tenantId: string) {
    return (await this.users.find({ where: { tenantId }, order: { name: 'ASC' } }))
      .map(u => u.toJSON());
  }

  async findOne(tenantId: string, id: string) {
    const u = await this.users.findOne({ where: { id, tenantId } });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return u.toJSON();
  }

  async updateUser(tenantId: string, id: string, data: Partial<User>) {
    await this.findOne(tenantId, id);
    await this.users.update({ id, tenantId }, data as any);
    return this.findOne(tenantId, id);
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId, name: user.name };
    const secret  = this.cfg.get('JWT_SECRET', 'suporte-tecnico-jwt-secret-2024-change-in-prod');
    const refresh = this.cfg.get('JWT_REFRESH_SECRET', 'suporte-tecnico-refresh-secret-2024');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { secret, expiresIn: '8h' }),
      this.jwt.signAsync(payload, { secret: refresh, expiresIn: '30d' }),
    ]);
    return { accessToken, refreshToken, expiresIn: 28800 };
  }

  async portalLogin(email: string, password: string, tenantId?: string, tenantSlug?: string) {
    const contactRepo = this.users.manager.getRepository('Contact');
    const clientRepo  = this.users.manager.getRepository('Client');
    let resolvedTenantId: string | null = null;
    if (tenantId) {
      resolvedTenantId = tenantId;
    } else if (tenantSlug) {
      const tenantRow = await this.users.manager.query(
        'SELECT id FROM tenants WHERE slug = $1 LIMIT 1',
        [tenantSlug],
      );
      if (tenantRow.length) resolvedTenantId = tenantRow[0].id;
    }
    const qb = contactRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.client', 'cl')
      .where('LOWER(c.email) = LOWER(:email)', { email })
      .andWhere('c.status = :status', { status: 'active' })
      .andWhere('c.portal_password IS NOT NULL');
    if (resolvedTenantId) {
      qb.andWhere('c.tenant_id = :tenantId', { tenantId: resolvedTenantId });
    }
    const contacts = await qb.getMany();
    if (!contacts.length) throw new UnauthorizedException('Credenciais inválidas');
    const contact = contacts[0];
    const valid = await bcrypt.compare(password, contact.portalPassword);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas');
    const clientMap = new Map<string, any>();
    for (const c of contacts) {
      if (c.client) {
        clientMap.set(c.client.id, c.client);
        if (c.isPrimary && c.client.networkId) {
          const networkClients = await clientRepo
            .createQueryBuilder('cl')
            .where('cl.network_id = :networkId', { networkId: c.client.networkId })
            .andWhere('cl.status = :status', { status: 'active' })
            .andWhere('cl.tenant_id = :tenantId', { tenantId: c.tenantId })
            .orderBy('cl.company_name', 'ASC')
            .getMany();
          for (const nc of networkClients) clientMap.set(nc.id, nc);
        }
      }
    }
    const clients = Array.from(clientMap.values()).sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));
    const payload = { sub: contact.id, email: contact.email, type: 'portal', clientId: contact.clientId, tenantId: contact.tenantId, name: contact.name, isPrimary: !!contact.isPrimary };
    const secret = this.cfg.get('JWT_SECRET', 'suporte-tecnico-jwt-secret-2024-change-in-prod');
    const accessToken = await this.jwt.signAsync(payload, { secret, expiresIn: '8h' });
    return { accessToken, contact: { id: contact.id, name: contact.name, email: contact.email, clientId: contact.clientId, isPrimary: !!contact.isPrimary }, clients };
  }
}
