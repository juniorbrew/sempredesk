import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Module } from '@nestjs/common';
import type { Response } from 'express';
import { SkipTenantLicenseCheck } from '../../common/decorators/skip-tenant-license.decorator';

@ApiTags('health')
@SkipTenantLicenseCheck()
@Controller()
export class HealthController {
  @Get('health')
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'suporte-tecnico-backend' };
  }

  @Get('metrics')
  metrics(@Res() res: Response) {
    const now = new Date().toISOString();
    const uptimeSeconds = Math.floor(process.uptime());

    const payload = [
      '# HELP app_up Whether the backend process is up.',
      '# TYPE app_up gauge',
      'app_up 1',
      '# HELP app_uptime_seconds Backend process uptime in seconds.',
      '# TYPE app_uptime_seconds counter',
      `app_uptime_seconds ${uptimeSeconds}`,
      '# HELP app_build_info Static build information for the backend.',
      '# TYPE app_build_info gauge',
      'app_build_info{service="suporte-tecnico-backend"} 1',
      '# HELP app_scrape_timestamp_seconds Unix timestamp of this scrape.',
      '# TYPE app_scrape_timestamp_seconds gauge',
      `app_scrape_timestamp_seconds ${Math.floor(Date.now() / 1000)}`,
      `# ${now}`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(payload);
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
