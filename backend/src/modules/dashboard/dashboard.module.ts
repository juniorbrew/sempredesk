import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Device } from '../devices/entities/device.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, Device]), PermissionsModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
