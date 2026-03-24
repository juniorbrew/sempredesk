import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Webhook } from './webhook.entity';
import * as crypto from 'crypto';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly repo: Repository<Webhook>,
    private readonly httpService: HttpService,
  ) {}

  findAll(tenantId: string): Promise<Webhook[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  create(tenantId: string, dto: Partial<Webhook>): Promise<Webhook> {
    const wh = this.repo.create({ ...dto, tenantId });
    return this.repo.save(wh);
  }

  async update(tenantId: string, id: string, dto: Partial<Webhook>): Promise<Webhook> {
    await this.repo.update({ id, tenantId }, dto);
    return this.repo.findOne({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.repo.delete({ id, tenantId });
  }

  async fire(tenantId: string, event: string, payload: any): Promise<void> {
    const webhooks = await this.repo.find({ where: { tenantId, active: true } });
    for (const wh of webhooks) {
      if (!wh.events.includes(event)) continue;
      const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
      const headers: any = { 'Content-Type': 'application/json' };
      if (wh.secret) {
        const sig = crypto.createHmac('sha256', wh.secret).update(body).digest('hex');
        headers['X-Signature-256'] = `sha256=${sig}`;
      }
      try {
        await firstValueFrom(this.httpService.post(wh.url, body, { headers, timeout: 5000 }));
        await this.repo.update(wh.id, { lastFiredAt: new Date(), lastStatus: '200' });
      } catch (e: any) {
        const status = e?.response?.status?.toString() || 'error';
        await this.repo.update(wh.id, { lastFiredAt: new Date(), lastStatus: status });
        this.logger.warn(`Webhook ${wh.id} failed: ${e.message}`);
      }
    }
  }
}
