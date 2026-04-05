import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Client, Contact } from '../customers/entities/customer.entity';
import { User } from '../auth/user.entity';
import { KbArticle } from '../knowledge/entities/knowledge.entity';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Client, Contact, User, KbArticle]),
    CustomersModule,
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
