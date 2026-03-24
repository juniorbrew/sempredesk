import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Client } from '../customers/entities/customer.entity';
import { User } from '../auth/user.entity';
import { KbArticle } from '../knowledge/entities/knowledge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Client, User, KbArticle]),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
