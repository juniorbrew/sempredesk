import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TeamChatService } from './team-chat.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('team-chat')
export class TeamChatController {
  constructor(
    private readonly svc: TeamChatService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  @Get('channels')
  @RequirePermission('ticket.view')
  getChannels(@TenantId() tenantId: string) {
    return this.svc.getChannels(tenantId);
  }

  @Get('messages')
  @RequirePermission('ticket.view')
  getMessages(@TenantId() tenantId: string, @Query('channel') channel = 'general', @Query('limit') limit = 50) {
    return this.svc.getMessages(tenantId, channel, Number(limit));
  }

  @Post('messages')
  @RequirePermission('ticket.reply')
  async postMessage(
    @TenantId() tenantId: string,
    @Request() req: any,
    @Body() body: { content: string; channel?: string; replyTo?: string },
  ) {
    const msg = await this.svc.postMessage(
      tenantId,
      req.user.id,
      req.user.name,
      body.content,
      body.channel || 'general',
      body.replyTo,
    );
    this.emitter.emitToTenant(tenantId, 'team-chat:message', msg);
    return msg;
  }
}
