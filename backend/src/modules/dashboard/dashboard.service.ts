import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../tickets/entities/ticket.entity';
import { Device, DeviceStatus } from '../devices/entities/device.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
  ) {}

  async getSummary(tenantId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const [open, inProgress, waitingClient, resolvedToday] = await Promise.all([
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.OPEN } }),
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.IN_PROGRESS } }),
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.WAITING_CLIENT } }),
      this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.status IN (:...st)', { st: [TicketStatus.RESOLVED, TicketStatus.CLOSED] })
        .andWhere('t.resolved_at >= :today', { today: todayStart })
        .getCount(),
    ]);

    // SLA compliance last 30d
    const [totalClosed, slaBreached] = await Promise.all([
      this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.status IN (:...st)', { st: [TicketStatus.RESOLVED, TicketStatus.CLOSED] })
        .andWhere('t.created_at >= :from', { from: thirtyDaysAgo })
        .getCount(),
      this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.escalated = true')
        .andWhere('t.created_at >= :from', { from: thirtyDaysAgo })
        .getCount(),
    ]);

    const slaCompliance = totalClosed > 0
      ? Math.round(((totalClosed - slaBreached) / totalClosed) * 100)
      : 100;

    const [onlineDevices, offlineDevices] = await Promise.all([
      this.deviceRepo.count({ where: { tenantId, status: DeviceStatus.ONLINE } }),
      this.deviceRepo.count({ where: { tenantId, status: DeviceStatus.OFFLINE } }),
    ]);

    return { open, inProgress, waitingClient, resolvedToday, slaCompliance, onlineDevices, offlineDevices };
  }

  async getTicketsByPriority(tenantId: string) {
    return this.ticketRepo
      .createQueryBuilder('t')
      .select('t.priority', 'priority')
      .addSelect('COUNT(*)', 'count')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.status NOT IN (:...done)', { done: [TicketStatus.CLOSED, TicketStatus.CANCELLED] })
      .groupBy('t.priority')
      .getRawMany();
  }

  async getTicketTrend(tenantId: string, days = 7) {
    const results = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      const count = await this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.created_at BETWEEN :start AND :end', { start: date, end })
        .getCount();
      results.push({ date: date.toISOString().split('T')[0], count });
    }
    return results;
  }

  async getSlaReport(tenantId: string) {
    const now = new Date();
    const soon = new Date(now.getTime() + 4 * 3600 * 1000);
    const [breached, atRisk] = await Promise.all([
      this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.sla_resolve_at < :now', { now })
        .andWhere('t.status NOT IN (:...done)', { done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED] })
        .getMany(),
      this.ticketRepo.createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.sla_resolve_at BETWEEN :now AND :soon', { now, soon })
        .andWhere('t.status NOT IN (:...done)', { done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED] })
        .getMany(),
    ]);
    return { breached, atRisk };
  }
}
