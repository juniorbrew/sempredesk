import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingRule } from './routing-rule.entity';
import { RoutingRulesService } from './routing-rules.service';
import { RoutingRulesController } from './routing-rules.controller';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [TypeOrmModule.forFeature([RoutingRule]), PermissionsModule],
  providers: [RoutingRulesService],
  controllers: [RoutingRulesController],
  exports: [RoutingRulesService],
})
export class RoutingRulesModule {}
