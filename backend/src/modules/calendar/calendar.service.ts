import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventParticipant } from './entities/calendar-event-participant.entity';
import {
  CreateCalendarEventDto, UpdateCalendarEventDto,
  FilterCalendarEventDto, AddParticipantDto,
} from './dto/calendar-event.dto';

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(CalendarEventParticipant)
    private readonly participantRepo: Repository<CalendarEventParticipant>,
  ) {}

  private async getOrFail(tenantId: string, id: string): Promise<CalendarEvent> {
    const event = await this.eventRepo.findOne({ where: { tenantId, id } });
    if (!event) throw new NotFoundException('Evento não encontrado');
    return event;
  }

  async create(tenantId: string, userId: string, dto: CreateCalendarEventDto): Promise<CalendarEvent> {
    if (new Date(dto.endsAt) < new Date(dto.startsAt)) {
      throw new BadRequestException('A data de término deve ser igual ou posterior à data de início');
    }

    const event = this.eventRepo.create({
      tenantId,
      createdBy: userId,
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      notes: dto.notes ?? null,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      timezone: dto.timezone ?? 'America/Sao_Paulo',
      allDay: dto.allDay ?? false,
      status: dto.status ?? 'scheduled',
      eventType: dto.eventType ?? 'internal',
      origin: dto.origin ?? 'manual',
      assignedUserId: dto.assignedUserId ?? null,
      departmentId: dto.departmentId ?? null,
      ticketId: dto.ticketId ?? null,
      contactId: dto.contactId ?? null,
      clientId: dto.clientId ?? null,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.eventRepo.save(event);

    if (dto.participants?.length) {
      await this.saveParticipants(tenantId, saved.id, dto.participants);
    }

    return this.findOne(tenantId, saved.id);
  }

  async findAll(tenantId: string, filters: FilterCalendarEventDto) {
    const page    = filters.page    ?? 1;
    const perPage = filters.perPage ?? 20;

    const qb = this.eventRepo.createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId })
      .orderBy('e.starts_at', 'ASC');

    if (filters.from)           qb.andWhere('e.starts_at >= :from', { from: filters.from });
    if (filters.to)             qb.andWhere('e.starts_at <= :to',   { to: filters.to });
    if (filters.status)         qb.andWhere('e.status = :status',   { status: filters.status });
    if (filters.eventType)      qb.andWhere('e.event_type = :eventType', { eventType: filters.eventType });
    if (filters.assignedUserId) qb.andWhere('e.assigned_user_id = :uid', { uid: filters.assignedUserId });
    if (filters.departmentId)   qb.andWhere('e.department_id = :deptId', { deptId: filters.departmentId });
    if (filters.ticketId)       qb.andWhere('e.ticket_id = :ticketId',   { ticketId: filters.ticketId });
    if (filters.clientId)       qb.andWhere('e.client_id = :clientId',   { clientId: filters.clientId });

    const [items, total] = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    const totalPages = Math.ceil(total / perPage) || 1;
    return { data: items, total, page, perPage, totalPages };
  }

  async findOne(tenantId: string, id: string): Promise<CalendarEvent> {
    const event = await this.eventRepo.findOne({
      where: { tenantId, id },
      relations: ['participants'],
    });
    if (!event) throw new NotFoundException('Evento não encontrado');
    return event;
  }

  async update(tenantId: string, id: string, dto: UpdateCalendarEventDto): Promise<CalendarEvent> {
    const event = await this.getOrFail(tenantId, id);

    if (dto.startsAt || dto.endsAt) {
      const starts = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
      const ends   = dto.endsAt   ? new Date(dto.endsAt)   : event.endsAt;
      if (ends < starts) {
        throw new BadRequestException('A data de término deve ser igual ou posterior à data de início');
      }
    }

    Object.assign(event, {
      ...(dto.title          !== undefined && { title: dto.title }),
      ...(dto.description    !== undefined && { description: dto.description }),
      ...(dto.location       !== undefined && { location: dto.location }),
      ...(dto.notes          !== undefined && { notes: dto.notes }),
      ...(dto.startsAt       !== undefined && { startsAt: new Date(dto.startsAt) }),
      ...(dto.endsAt         !== undefined && { endsAt: new Date(dto.endsAt) }),
      ...(dto.timezone       !== undefined && { timezone: dto.timezone }),
      ...(dto.allDay         !== undefined && { allDay: dto.allDay }),
      ...(dto.status         !== undefined && { status: dto.status }),
      ...(dto.eventType      !== undefined && { eventType: dto.eventType }),
      ...(dto.assignedUserId !== undefined && { assignedUserId: dto.assignedUserId }),
      ...(dto.departmentId   !== undefined && { departmentId: dto.departmentId }),
      ...(dto.ticketId       !== undefined && { ticketId: dto.ticketId }),
      ...(dto.contactId      !== undefined && { contactId: dto.contactId }),
      ...(dto.clientId       !== undefined && { clientId: dto.clientId }),
      ...(dto.metadata       !== undefined && { metadata: dto.metadata }),
    });

    return this.eventRepo.save(event);
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: boolean }> {
    const event = await this.getOrFail(tenantId, id);
    await this.eventRepo.remove(event);
    return { deleted: true };
  }

  async cancel(tenantId: string, id: string): Promise<CalendarEvent> {
    const event = await this.getOrFail(tenantId, id);
    event.status = 'cancelled';
    return this.eventRepo.save(event);
  }

  // ── Participants ──────────────────────────────────────────────────────────

  private async saveParticipants(tenantId: string, eventId: string, participants: AddParticipantDto[]) {
    const rows = participants.map((p) =>
      this.participantRepo.create({
        tenantId,
        eventId,
        userId:        p.userId        ?? null,
        contactId:     p.contactId     ?? null,
        externalEmail: p.externalEmail ?? null,
        externalName:  p.externalName  ?? null,
        role:          p.role          ?? 'attendee',
        responseStatus: 'pending',
      }),
    );
    return this.participantRepo.save(rows);
  }

  async addParticipant(tenantId: string, eventId: string, dto: AddParticipantDto) {
    await this.getOrFail(tenantId, eventId);
    const [p] = await this.saveParticipants(tenantId, eventId, [dto]);
    return p;
  }

  async removeParticipant(tenantId: string, eventId: string, participantId: string) {
    await this.getOrFail(tenantId, eventId);
    const p = await this.participantRepo.findOne({
      where: { id: participantId, eventId, tenantId },
    });
    if (!p) throw new NotFoundException('Participante não encontrado');
    await this.participantRepo.remove(p);
    return { deleted: true };
  }

  async findByTicket(tenantId: string, ticketId: string) {
    return this.eventRepo.find({
      where: { tenantId, ticketId },
      order: { startsAt: 'ASC' },
    });
  }
}
