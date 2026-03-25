import { Controller, Get, Post, Body, Query, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AttendanceService } from './attendance.service';

@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Post('clock-in')
  clockIn(@Request() req: any) {
    const { id, name, email, role } = req.user;
    const ip = req.headers['x-forwarded-for'] || req.ip;
    return this.svc.clockIn(req.tenantId, id, name, email, role, ip);
  }

  @Post('clock-out')
  clockOut(@Request() req: any, @Body() body: any) {
    return this.svc.clockOut(req.tenantId, req.user.id, body.notes);
  }

  @Get('status')
  status(@Request() req: any) {
    return this.svc.getOpenRecord(req.tenantId, req.user.id);
  }

  @Get('today')
  today(@Request() req: any) {
    return this.svc.getTodaySummary(req.tenantId);
  }

  @Post('pause/start')
  startPause(@Request() req: any, @Body() body: { pauseType: string; userId?: string }) {
    const targetUserId = body.userId || req.user.id;
    return this.svc.startPause(req.tenantId, targetUserId, body.pauseType as any, req.user);
  }

  @Post('pause/end')
  endPause(@Request() req: any, @Body() body: { userId?: string }) {
    const targetUserId = body.userId || req.user.id;
    return this.svc.endPause(req.tenantId, targetUserId);
  }

  @Post('pause/authorize/:userId')
  authorizePause(@Request() req: any, @Param('userId') userId: string) {
    return this.svc.authorizeTechnicalPause(req.tenantId, userId, req.user);
  }

  @Get('queue-stats')
  queueStats(@Request() req: any) {
    return this.svc.getQueueStats(req.tenantId);
  }

  /** Fecha manualmente todos os registros órfãos do tenant (admin) */
  @Post('close-stale')
  closeStale() {
    return this.svc.closeStaleRecords();
  }

  @Get()
  list(@Request() req: any, @Query() query: any) {
    return this.svc.getRecords(req.tenantId, query);
  }
}
