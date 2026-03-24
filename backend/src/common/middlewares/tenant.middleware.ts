import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  use(req: Request & { tenantId?: string; user?: any }, _res: Response, next: NextFunction) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const token   = auth.slice(7);
        const secret  = this.cfg.get('JWT_SECRET', 'suporte-tecnico-jwt-secret-2024-change-in-prod');
        const payload = this.jwt.verify(token, { secret }) as any;
        if (payload?.tenantId) {
          req.tenantId = payload.tenantId;
          req.user     = payload;
        }
      } catch { /* guard handles invalid tokens */ }
    }
    next();
  }
}
