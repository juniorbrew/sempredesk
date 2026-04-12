import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { Device, DeviceEvent, DeviceMetric, DeviceStatus } from './entities/device.entity';
import { TicketsService } from '../tickets/tickets.service';
import { AlertsService } from '../alerts/alerts.service';
import { TicketStatus, TicketOrigin } from '../tickets/entities/ticket.entity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(DeviceEvent) private readonly eventRepo: Repository<DeviceEvent>,
    @InjectRepository(DeviceMetric) private readonly metricRepo: Repository<DeviceMetric>,
    private readonly ticketsService: TicketsService,
    private readonly alertsService: AlertsService,
  ) {}

  private async assertClientBelongsToTenant(tenantId: string, clientId?: string | null) {
    if (!clientId) return;
    const rows = await this.deviceRepo.manager.query(
      'SELECT id FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, clientId],
    );
    if (!rows.length) throw new BadRequestException('Cliente inválido para este tenant');
  }

  async create(tenantId: string, dto: Partial<Device>): Promise<Device> {
    const heartbeatToken = randomBytes(32).toString('hex');
    const { tenantId: _tenantId, tenant_id: _tenant_id, heartbeatToken: _hb, ...safeDto } = dto as any;
    await this.assertClientBelongsToTenant(tenantId, (safeDto as any).clientId);
    const device = this.deviceRepo.create({ ...safeDto, tenantId, heartbeatToken } as any);
    return this.deviceRepo.save(device as any) as any;
  }

  async findAll(tenantId: string, clientId?: string): Promise<Device[]> {
    const where: any = { tenantId };
    if (clientId) where.clientId = clientId;
    return this.deviceRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(tenantId: string, id: string): Promise<Device> {
    const device = await this.deviceRepo.findOne({ where: { id, tenantId } });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    return device;
  }

  async update(tenantId: string, id: string, dto: Partial<Device>): Promise<Device> {
    const device = await this.findOne(tenantId, id);
    await this.assertClientBelongsToTenant(tenantId, (dto as any)?.clientId ?? device.clientId);
    Object.assign(device, dto);
    return this.deviceRepo.save(device as any) as any;
  }

  async processHeartbeat(token: string, metrics?: Record<string, any>): Promise<Device> {
    const device = await this.deviceRepo.findOne({ where: { heartbeatToken: token } });
    if (!device) throw new UnauthorizedException('Token inválido');

    const wasOffline = device.status === DeviceStatus.OFFLINE;
    device.lastHeartbeat = new Date();
    const normalizedMetrics = metrics ? {
      cpu: metrics.cpu ?? metrics.cpu_usage ?? metrics.cpuUsage,
      memory: metrics.memory ?? metrics.memory_usage ?? metrics.memoryUsage,
      disk: metrics.disk ?? metrics.disk_free_gb ?? metrics.diskFreeGb,
      errors: metrics.errors ?? metrics.error ?? undefined,
      raw: metrics,
    } : undefined;
    device.lastMetrics = normalizedMetrics || device.lastMetrics;
    if (metrics?.system_version || metrics?.systemVersion) {
      device.systemVersion = metrics.system_version ?? metrics.systemVersion;
    }

    // Detect warning from metrics
    if (normalizedMetrics) {
      const cpu = Number(normalizedMetrics.cpu);
      const mem = Number(normalizedMetrics.memory);
      const highCpu = Number.isFinite(cpu) && cpu > 90;
      const highMem = Number.isFinite(mem) && mem > 95;
      device.status = highCpu || highMem ? DeviceStatus.WARNING : DeviceStatus.ONLINE;
    } else {
      device.status = DeviceStatus.ONLINE;
    }

    if (normalizedMetrics) {
      await this.metricRepo.save(this.metricRepo.create({
        tenantId: device.tenantId,
        deviceId: device.id,
        cpu: normalizedMetrics.cpu != null ? Number(normalizedMetrics.cpu) : undefined,
        memory: normalizedMetrics.memory != null ? Number(normalizedMetrics.memory) : undefined,
        disk: normalizedMetrics.disk != null ? Number(normalizedMetrics.disk) : undefined,
      }));
    }

    if (wasOffline) {
      await this.eventRepo.save(this.eventRepo.create({
        tenantId: device.tenantId,
        deviceId: device.id,
        eventType: 'device_online',
        severity: 'info',
        message: `Dispositivo ${device.name} voltou online`,
      }));
    }

    return this.deviceRepo.save(device as any) as any;
  }

  async getMetricsHistory(tenantId: string, deviceId: string, limit = 100): Promise<DeviceMetric[]> {
    await this.findOne(tenantId, deviceId);
    return this.metricRepo.find({
      where: { tenantId, deviceId },
      order: { recordedAt: 'DESC' },
      take: limit,
    });
  }

  async getEvents(tenantId: string, deviceId: string, limit = 50): Promise<DeviceEvent[]> {
    await this.findOne(tenantId, deviceId);
    return this.eventRepo.find({
      where: { tenantId, deviceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getOfflineDevices(tenantId: string): Promise<Device[]> {
    return this.deviceRepo.find({ where: { tenantId, status: DeviceStatus.OFFLINE } });
  }

  async getSummary(tenantId: string) {
    const devices = await this.findAll(tenantId);
    const total = devices.length;
    const online = devices.filter(d => d.status === DeviceStatus.ONLINE).length;
    const offline = devices.filter(d => d.status === DeviceStatus.OFFLINE).length;
    const warning = devices.filter(d => d.status === DeviceStatus.WARNING).length;
    const unknown = devices.filter(d => d.status === DeviceStatus.UNKNOWN).length;
    return { total, online, offline, warning, unknown };
  }

  async recordEvent(tenantId: string, deviceId: string, eventType: string, severity: string, message: string, metadata?: any): Promise<DeviceEvent> {
    return this.eventRepo.save(this.eventRepo.create({ tenantId, deviceId, eventType, severity, message, metadata }));
  }

  @Cron('*/2 * * * *')
  async checkOfflineDevices() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stale = await this.deviceRepo
      .createQueryBuilder('d')
      .where('d.status NOT IN (:...st)', { st: [DeviceStatus.OFFLINE] })
      .andWhere('(d.last_heartbeat < :cutoff OR d.last_heartbeat IS NULL)', { cutoff })
      .getMany();

    for (const device of stale) {
      device.status = DeviceStatus.OFFLINE;
      const ev = await this.eventRepo.save(this.eventRepo.create({
        tenantId: device.tenantId,
        deviceId: device.id,
        eventType: 'device_offline',
        severity: 'warning',
        message: `Dispositivo ${device.name} ficou offline`,
      }));

      // Cria ticket automático (apenas um ticket aberto por device offline)
      try {
        const ticket = await this.ticketsService.createAutoDeviceOfflineTicket(device.tenantId, device);
        if (ticket?.id) {
          ev.ticketId = ticket.id;
          await this.eventRepo.save(ev);
        }
      } catch {}

      try {
        await this.alertsService.notifyDeviceOffline(device);
      } catch {}
    }
    if (stale.length) await this.deviceRepo.save(stale);
  }
}
