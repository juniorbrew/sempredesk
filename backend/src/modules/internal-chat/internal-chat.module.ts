import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalChatMessage } from './internal-chat.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { InternalChatService } from './internal-chat.service';
import { InternalChatController } from './internal-chat.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([InternalChatMessage]), PermissionsModule, RealtimeModule],
  providers: [InternalChatService],
  controllers: [InternalChatController],
  exports: [InternalChatService],
})
export class InternalChatModule {}
