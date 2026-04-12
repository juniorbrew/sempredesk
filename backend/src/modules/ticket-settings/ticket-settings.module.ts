import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketSetting } from './entities/ticket-setting.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { TicketSettingsController } from './ticket-settings.controller';
import { TicketSettingsService } from './ticket-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketSetting, TenantPriority]), PermissionsModule],
  controllers: [TicketSettingsController],
  providers: [TicketSettingsService],
  exports: [TicketSettingsService],
})
export class TicketSettingsModule {}
