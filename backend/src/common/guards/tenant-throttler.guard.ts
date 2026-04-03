import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';

/**
 * Rate limiting de API por tenantId (não por IP).
 *
 * Aplica APENAS o throttler nomeado 'default', ignorando 'upload'.
 * O throttler 'upload' é gerido exclusivamente pelo UploadThrottlerGuard
 * nas rotas de upload — aplicá-lo globalmente limitaria toda a API a 30 req/min.
 *
 * Configurável via:
 *   API_RATE_LIMIT  — limite de requisições por minuto por tenant (padrão: 300)
 *
 * Registado como APP_GUARD em app.module.ts → aplica-se a todos os endpoints.
 * Usar @SkipThrottle() nos controllers que não devem ser throttled (ex.: health).
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const tenantId = req.tenantId as string | undefined;
    return tenantId ? `tenant:${tenantId}` : `ip:${req.ip as string}`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();

    if (await this.shouldSkip(context)) return true;

    // Itera apenas sobre o throttler 'default'.
    // 'upload' é ignorado aqui — tem o seu próprio guard nas rotas de ficheiros.
    for (const throttler of this.throttlers as ThrottlerOptions[]) {
      const name = throttler.name ?? 'default';
      if (name !== 'default') continue;

      // Respeita @SkipThrottle({ default: true }) no controller/handler
      const skipKey = `THROTTLER:SKIP${name}`;
      const skip = this.reflector.getAllAndOverride<boolean>(skipKey, [handler, classRef]);
      if (skip) continue;

      const limit = throttler.limit as number;
      const ttl = throttler.ttl as number;
      const getTracker = throttler.getTracker ?? this.commonOptions?.getTracker;
      const generateKey = throttler.generateKey ?? this.commonOptions?.generateKey;

      await this.handleRequest(context, limit, ttl, throttler, getTracker, generateKey);
    }

    return true;
  }
}
