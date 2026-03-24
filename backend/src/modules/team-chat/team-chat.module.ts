import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamChatMessage } from './team-chat.entity';
import { TeamChatService } from './team-chat.service';
import { TeamChatController } from './team-chat.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [TypeOrmModule.forFeature([TeamChatMessage]), RealtimeModule, PermissionsModule],
  providers: [TeamChatService],
  controllers: [TeamChatController],
  exports: [TeamChatService],
})
export class TeamChatModule {}
