import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Erro interno do servidor' };

    const tenantId = req?.tenantId || '-';
    const userId = req?.userId || req?.user?.id || '-';
    const method = req?.method || '-';
    const url = req?.originalUrl || req?.url || '-';
    const ip = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '-';

    this.logger.error(
      `[${method}] ${url} status=${status} tenant=${tenantId} user=${userId} ip=${ip} message="${exception?.message || 'unknown'}"`,
      exception?.stack,
    );

    res.status(status).json({
      success: false,
      statusCode: status,
      tenantId,
      path: url,
      timestamp: new Date().toISOString(),
      error: response,
    });
  }
}
