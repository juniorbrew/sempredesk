import { CanActivate, ExecutionContext, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { StorageQuotaService } from '../../modules/storage/storage-quota.service';

/**
 * Rejeita uploads quando o tenant atingiu a quota de disco.
 *
 * Aplica-se nos endpoints de upload via @UseGuards(StorageQuotaGuard).
 * Corre antes do FileInterceptor (multer) — impede a escrita no disco.
 *
 * Quota configurável via TENANT_STORAGE_QUOTA_MB (padrão: 5000 MB = 5 GB).
 */
@Injectable()
export class StorageQuotaGuard implements CanActivate {
  constructor(private readonly quotaService: StorageQuotaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const tenantId = req.tenantId as string | undefined;

    // Sem tenant → deixa passar; será rejeitado pelo JwtAuthGuard
    if (!tenantId) return true;

    if (await this.quotaService.isOverQuota(tenantId)) {
      throw new PayloadTooLargeException(
        'Quota de armazenamento do tenant excedida. ' +
        'Remova ficheiros antigos ou contacte o suporte.',
      );
    }

    return true;
  }
}
