import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

/**
 * Adapter Socket.io com Redis pub/sub.
 *
 * Permite múltiplas instâncias do backend trocarem eventos WebSocket
 * sem perda de mensagens — pré-requisito para escala horizontal.
 *
 * Fallback seguro: se Redis não estiver disponível (host ausente ou falha
 * de conexão), o adapter NÃO é aplicado e o Socket.io opera normalmente
 * em modo instância única, sem derrubar a aplicação.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST;
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;

    if (!host) {
      this.logger.warn(
        'REDIS_HOST não configurado — Socket.io rodando em modo instância única',
      );
      return;
    }

    try {
      const pubClient = new Redis({ host, port, password, lazyConnect: true });
      const subClient = new Redis({ host, port, password, lazyConnect: true });

      await Promise.all([pubClient.connect(), subClient.connect()]);

      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Redis Adapter conectado — Socket.io pronto para multi-instância');
    } catch (err) {
      this.logger.warn(
        `Falha ao conectar Redis Adapter (${err}) — operando em instância única`,
      );
      this.adapterConstructor = null;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
