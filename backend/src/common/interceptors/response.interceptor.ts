import { Injectable, NestInterceptor, ExecutionContext, CallHandler, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // StreamableFile deve passar directamente para não quebrar o pipe do ficheiro
        if (data instanceof StreamableFile) return data;

        if (data && typeof data === 'object' && 'success' in data) return data;

        if (data && typeof data === 'object' && 'items' in data && 'total' in data) {
          const { items, total, page, perPage, ...rest } = data as any;
          return { success: true, data: items, meta: { total, page, perPage, ...rest } };
        }

        return { success: true, data };
      }),
    );
  }
}
