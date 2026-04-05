import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client, Contact } from './entities/customer.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { ContactArchiveRolloutService } from './contact-archive-rollout.service';

@Module({
  imports: [TypeOrmModule.forFeature([Client, Contact]), PermissionsModule],
  providers: [CustomersService, ContactArchiveRolloutService],
  controllers: [CustomersController],
  exports: [CustomersService, ContactArchiveRolloutService],
})
export class CustomersModule {}
