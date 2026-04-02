import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';

/**
 * Rate limiting de upload por tenantId.
 * Limita o número de ficheiros enviados por tenant por minuto,
 * independentemente do IP (protege contra abusos multi-agente).
 *
 * Aplica o throttler nomeado "upload" configurado no ThrottlerModule.
 * Limite padrão: UPLOAD_RATE_LIMIT req/min por tenant (default 30).
 */
@Injectable()
export class UploadThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Chave por tenant; fallback para IP se tenantId não estiver disponível
    const tenantId = req.tenantId as string | undefined;
    return tenantId ? `upload:${tenantId}` : `upload-ip:${req.ip}`;
  }

  protected async getErrorMessage(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<string> {
    return 'Limite de uploads por minuto excedido. Tente novamente em breve.';
  }
}
