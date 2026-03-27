import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Contact, Client } from '../customers/entities/customer.entity';
import { ContactCustomer } from './entities/contact-customer.entity';
import { ContactValidationService } from './contact-validation.service';
import { ContactValidationController } from './contact-validation.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Contact, Client, ContactCustomer]),
    CustomersModule,
  ],
  providers: [ContactValidationService],
  controllers: [ContactValidationController],
  exports: [ContactValidationService],
})
export class ContactValidationModule {}
