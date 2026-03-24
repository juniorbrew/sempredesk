import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { PermissionsService } from '../../modules/permissions/permissions.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Não autenticado');

    // Portal: apenas permissões explicitamente permitidas para contatos
    if (user.isPortal) {
      const PORTAL_ALLOWED: string[] = [
        'ticket.view',
        'ticket.create',
        'ticket.reply',
        'ticket.cancel',
        'kb.view',
      ];
      const allowed = required.some((p) => PORTAL_ALLOWED.includes(p));
      if (!allowed) throw new ForbiddenException('Acesso não permitido para o portal');
      return true;
    }

    const role = user.role;
    if (!role) throw new ForbiddenException('Perfil não definido');

    for (const perm of required) {
      const has = await this.permissionsService.hasPermission(role, perm);
      if (has) return true;
    }

    throw new ForbiddenException(
      `Permissão insuficiente. Necessária: ${required.join(' ou ')}`,
    );
  }
}
