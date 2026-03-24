import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
  import { tap, catchError } from 'rxjs/operators';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const tenantId = req.tenantId || '-';
    const userId = req.userId || req.user?.id || '-';
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '-';
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - startedAt;
        const statusCode = context.switchToHttp().getResponse()?.statusCode ?? 200;
        this.logger.log(
          `[${method}] ${url} status=${statusCode} tenant=${tenantId} user=${userId} ip=${ip} ${ms}ms`,
        );
      }),
      catchError((error) => {
        const ms = Date.now() - startedAt;
        const statusCode = error?.status || error?.statusCode || 500;
        this.logger.error(
          `[${method}] ${url} status=${statusCode} tenant=${tenantId} user=${userId} ip=${ip} ${ms}ms error="${error?.message || 'unknown'}"`,
          error?.stack,
        );
        throw error;
      }),
    );
  }
}
