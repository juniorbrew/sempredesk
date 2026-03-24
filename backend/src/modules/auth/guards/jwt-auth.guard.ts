import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

export const Public = () => SetMetadata('isPublic', true);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException('Acesso não autorizado');
    }

    const request = context.switchToHttp().getRequest();

    request.user = user;

    request.tenantId =
      user.tenantId ||
      user.tenant_id ||
      user.tenant;

    request.userId =
      user.id ||
      user.userId ||
      user.sub;

    if (!request.tenantId) {
      throw new UnauthorizedException('Token sem tenant válido');
    }

    return user;
  }
}
