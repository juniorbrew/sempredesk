import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user.entity';
import { PermissionsService } from '../../permissions/permissions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly permissionsService: PermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: cfg.get('JWT_SECRET', 'suporte-tecnico-jwt-secret-2024-change-in-prod'),
    });
  }

  async validate(payload: any) {
    // Token do portal do cliente
    if (payload.type === 'portal') {
      return {
        id: payload.sub,
        email: payload.email,
        role: 'client_contact',
        tenantId: payload.tenantId,
        name: payload.name,
        clientId: payload.clientId,
        isPortal: true,
        isPrimary: !!payload.isPrimary,
      };
    }

    // Token do sistema admin
    const user = await this.users.findOne({
      where: { id: payload.sub, tenantId: payload.tenantId || payload.tenant_id },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Token inválido');
    }

    // Carrega permissões do perfil para uso nos controllers (ex: ticket.view_all)
    const permissions = await this.permissionsService.getPermissionsByRole(user.role).catch(() => []);

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      name: user.name,
      permissions,
    };
  }
}
