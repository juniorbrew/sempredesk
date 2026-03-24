import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RealtimePresenceService } from './realtime-presence.service';

/**
 * Endpoint de apoio para presença dos agentes.
 * Permite consultar status atual quando o frontend não está conectado via WebSocket.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: RealtimePresenceService) {}

  @Get()
  @RequirePermission('chat.view_status')
  async getOnline(@TenantId() tenantId: string) {
    const { onlineIds, statusMap } = await this.presence.getOnlineIdsAndStatus(tenantId);
    return { onlineIds, statusMap };
  }

  @Get('status/:userId')
  @RequirePermission('chat.view_status')
  async getStatus(@TenantId() tenantId: string, @Param('userId') userId: string) {
    const status = await this.presence.getStatus(tenantId, userId);
    return { userId, status };
  }

  @Post('status/batch')
  @RequirePermission('chat.view_status')
  async getManyStatuses(
    @TenantId() tenantId: string,
    @Body() dto: { userIds: string[] },
  ) {
    const userIds = Array.isArray(dto.userIds) ? dto.userIds : [];
    const statusMap = await this.presence.getManyStatuses(tenantId, userIds);
    return { statusMap };
  }

  @Post('set-status')
  @RequirePermission('agent.edit')
  async setStatus(
    @TenantId() tenantId: string,
    @Body() dto: { status: 'online' | 'away' | 'busy' | 'offline' },
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    if (!userId) return { success: false };
    const status = dto.status;
    let ok = false;
    if (status === 'offline') {
      ok = await this.presence.setOffline(tenantId, userId);
    } else if (['online', 'away', 'busy'].includes(status)) {
      ok = await this.presence.setStatusAsync(tenantId, userId, status);
    }
    return { success: ok };
  }
}
