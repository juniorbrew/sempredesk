import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { TenantLicenseService } from '../../modules/saas/tenant-license.service';
import { SKIP_TENANT_LICENSE_KEY } from '../decorators/skip-tenant-license.decorator';

/**
 * Após JwtAuthGuard: bloqueia staff/portal se tenant suspenso ou licença inválida/expirada.
 * super_admin (painel master) ignora — pode operar vários tenants.
 */
@Injectable()
export class TenantLicenseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly licenses: TenantLicenseService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const skipLic = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_LICENSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipLic) return next.handle();

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.tenantId) return next.handle();

    if (user.role === 'super_admin') return next.handle();

    return from(this.licenses.assertTenantOperational(user.tenantId)).pipe(
      switchMap(() => next.handle()),
    );
  }
}
