import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Module } from '@nestjs/common';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'suporte-tecnico-backend' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
