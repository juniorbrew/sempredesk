import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Network } from './network.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { NetworksService } from './networks.service';
import { NetworksController } from './networks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Network]), PermissionsModule],
  controllers: [NetworksController],
  providers: [NetworksService],
  exports: [NetworksService],
})
export class NetworksModule {}
