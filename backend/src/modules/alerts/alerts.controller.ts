import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AlertsService } from './alerts.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post('test')
  @RequirePermission('alerts.manage')
  test(@Body() body: any) {
    return this.alertsService.sendAlert(body.channel || 'email', body.recipient, body.subject, body.message);
  }
}
