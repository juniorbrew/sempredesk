import { Module } from '@nestjs/common';
import { StorageCleanupService } from './storage-cleanup.service';

@Module({
  providers: [StorageCleanupService],
  exports: [StorageCleanupService],
})
export class StorageModule {}
