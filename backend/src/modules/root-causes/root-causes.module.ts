import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions/permissions.module';
import { RootCauseEntity } from './entities/root-cause.entity';
import { RootCausesService } from './root-causes.service';
import { RootCausesController } from './root-causes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RootCauseEntity]), PermissionsModule],
  providers: [RootCausesService],
  controllers: [RootCausesController],
  exports: [RootCausesService],
})
export class RootCausesModule {}
