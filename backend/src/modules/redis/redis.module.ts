import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (cfg: ConfigService): Redis | null => {
        const host = cfg.get('REDIS_HOST');
        const port = cfg.get<number>('REDIS_PORT', 6379);
        const password = cfg.get('REDIS_PASSWORD');
        if (!host) return null;
        try {
          const client = new Redis({
            host,
            port,
            password: password || undefined,
            retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
            lazyConnect: true,
          });
          return client;
        } catch {
          return null;
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
