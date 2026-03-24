import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device, DeviceEvent, DeviceMetric } from './entities/device.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device, DeviceEvent, DeviceMetric]), PermissionsModule, TicketsModule, AlertsModule],
  providers: [DevicesService],
  controllers: [DevicesController],
  exports: [DevicesService],
})
export class DevicesModule {}
