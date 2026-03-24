import { Controller, Get, Post, Body, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { InternalChatService } from './internal-chat.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('internal-chat')
export class InternalChatController {
  constructor(
    private readonly svc: InternalChatService,
    private readonly emitter: RealtimeEmitterService,
    private readonly presence: RealtimePresenceService,
  ) {}

  @Get('users')
  @RequirePermission('chat.view_agents')
  getUsers(@TenantId() tenantId: string, @Request() req: any) {
    return this.svc.getUsers(tenantId, req.user.id);
  }

  @Get('conversations')
  @RequirePermission('chat.view')
  getConversations(@TenantId() tenantId: string, @Request() req: any) {
    return this.svc.getConversations(tenantId, req.user.id);
  }

  @Get('online')
  @RequirePermission('chat.view_status')
  async getOnline(@TenantId() tenantId: string) {
    const { onlineIds, statusMap } = await this.presence.getOnlineIdsAndStatus(tenantId);
    return { onlineIds, statusMap };
  }

  @Get('messages/:recipientId')
  @RequirePermission('chat.view')
  getMessages(
    @TenantId() tenantId: string,
    @Request() req: any,
    @Param('recipientId') recipientId: string,
  ) {
    return this.svc.getMessages(tenantId, req.user.id, recipientId);
  }

  @Post('messages')
  @RequirePermission('chat.view')
  async postMessage(
    @TenantId() tenantId: string,
    @Request() req: any,
    @Body() body: { recipientId: string; content: string },
  ) {
    const { recipientId, content } = body;
    if (!recipientId?.trim() || !content?.trim()) {
      throw new BadRequestException('recipientId e content são obrigatórios');
    }
    const msg = await this.svc.sendMessage(
      tenantId,
      req.user.id,
      req.user.name,
      recipientId.trim(),
      content.trim(),
    );
    this.emitter.emitInternalChatMessage(tenantId, msg);
    return msg;
  }
}
