import { Global, Module } from '@nestjs/common';
import { StorageCleanupService } from './storage-cleanup.service';
import { StorageQuotaService } from './storage-quota.service';

/**
 * @Global() — StorageQuotaService fica disponível em todos os módulos
 * sem precisar importar StorageModule explicitamente.
 */
@Global()
@Module({
  providers: [StorageCleanupService, StorageQuotaService],
  exports: [StorageCleanupService, StorageQuotaService],
})
export class StorageModule {}
