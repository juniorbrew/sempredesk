import { Controller, Get, Put, Post, Delete, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SettingsService } from './settings.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  @RequirePermission('settings.manage')
  get(@Request() req: any) { return this.svc.findByTenant(req.tenantId); }

  @Put()
  @RequirePermission('settings.manage')
  update(@Request() req: any, @Body() body: any) { return this.svc.update(req.tenantId, body); }

  @Post('test-smtp')
  @RequirePermission('settings.manage')
  testSmtp(@Request() req: any) { return this.svc.testSmtp(req.tenantId); }

  @Delete('reset-test-data')
  @RequirePermission('settings.manage')
  resetTestData(@Request() req: any) {
    return this.svc.resetTestData(req.tenantId, req.user?.role);
  }
}
