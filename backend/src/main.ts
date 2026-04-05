import type { Response } from 'express';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { TenantLicenseInterceptor } from './common/interceptors/tenant-license.interceptor';
import { TenantLicenseService } from './modules/saas/tenant-license.service';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], rawBody: true });

  // Redis Adapter para Socket.io — habilita multi-instância com fallback automático
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Disable Express ETag so browsers don't cache API responses
  app.getHttpAdapter().getInstance().disable('etag');

  app.setGlobalPrefix('api/v1');

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [
        'http://localhost:3000',
        'https://cliente.sempredesk.com.br',
        'https://suporte.sempredesk.com.br',
        'https://adminpanel.sempredesk.com.br',
      ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  const reflector = app.get(Reflector);
  const tenantLicenseSvc = app.get(TenantLicenseService);
  app.useGlobalInterceptors(
    new TenantLicenseInterceptor(reflector, tenantLicenseSvc),
    new ResponseInterceptor(),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('SempreDesk API')
    .setDescription('SempreDesk — Sistema completo de gestão de suporte técnico')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('health')
    .addTag('auth')
    .addTag('tenants')
    .addTag('customers')
    .addTag('contracts')
    .addTag('tickets')
    .addTag('devices')
    .addTag('team')
    .addTag('knowledge')
    .addTag('dashboard')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    customSiteTitle: 'SempreDesk API Docs',
  });

  // Mesmo padrão que /api/docs: fora do prefixo global api/v1. Útil quando reverse proxies
  // encaminham /api/* ao Nest (ex.: sem location = /api/health → frontend).
  app.getHttpAdapter().get('/api/health', (_req, res: Response) => {
    res.status(200).json({
      ok: true,
      app: 'sempredesk-backend',
      router: 'nest',
      time: new Date().toISOString(),
    });
  });

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Backend running  → http://localhost:${port}`);
  logger.log(`📖 Swagger docs     → http://localhost:${port}/api/docs`);
}

bootstrap();
