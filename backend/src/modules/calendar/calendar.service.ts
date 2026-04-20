import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventParticipant } from './entities/calendar-event-participant.entity';
import { Client } from '../customers/entities/customer.entity';
import { User } from '../auth/user.entity';
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
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private async getOrFail(tenantId: string, id: string): Promise<CalendarEvent> {
    const event = await this.eventRepo.findOne({ where: { tenantId, id } });
    if (!event) throw new NotFoundException('Evento não encontrado');
    return event;
  }

  // Valida que o cliente pertence ao mesmo tenant
  private async validateClient(tenantId: string, clientId: string): Promise<void> {
    const exists = await this.clientRepo.findOne({ where: { id: clientId, tenantId } });
    if (!exists) throw new BadRequestException('Cliente não encontrado no tenant');
  }

  // Valida que todos os usuários pertencem ao mesmo tenant
  private async validateUsers(tenantId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    const found = await this.userRepo.findBy({ id: In(unique), tenantId });
    if (found.length !== unique.length) {
      throw new BadRequestException('Um ou mais usuários não pertencem ao tenant atual');
    }
  }

  async create(tenantId: string, userId: string, dto: CreateCalendarEventDto): Promise<CalendarEvent> {
    const resolvedEndsAt = dto.endsAt ?? dto.startsAt;
    if (new Date(resolvedEndsAt) < new Date(dto.startsAt)) {
      throw new BadRequestException('A data de término deve ser igual ou posterior à data de início');
    }

    if (dto.clientId) await this.validateClient(tenantId, dto.clientId);
    if (dto.userIds?.length) await this.validateUsers(tenantId, dto.userIds);

    const metadata = {
      ...(dto.metadata ?? {}),
      ...(dto.reminderAt !== undefined
        ? {
            reminderAt: dto.reminderAt ?? null,
            reminderSentAt: null,
          }
        : {}),
    };

    const event = this.eventRepo.create({
      tenantId,
      createdBy: userId,
      title: dto.title,
      description: dto.description ?? null,
      location: dto.location ?? null,
      notes: dto.notes ?? null,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(resolvedEndsAt),
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
      metadata: Object.keys(metadata).length ? metadata : null,
    });

    const saved = await this.eventRepo.save(event);

    // Merge participants explícitos + userIds (sem duplicidade)
    const allParticipants: AddParticipantDto[] = [...(dto.participants ?? [])];
    if (dto.userIds?.length) {
      const explicitUids = new Set(allParticipants.filter(p => p.userId).map(p => p.userId));
      for (const uid of [...new Set(dto.userIds)]) {
        if (!explicitUids.has(uid)) {
          allParticipants.push({ userId: uid, role: 'attendee' });
        }
      }
    }
    if (allParticipants.length) {
      await this.saveParticipants(tenantId, saved.id, allParticipants);
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

  async findOne(tenantId: string, id: string): Promise<any> {
    const event = await this.eventRepo.findOne({
      where: { tenantId, id },
      relations: ['participants', 'client'],
    }) as any;
    if (!event) throw new NotFoundException('Evento não encontrado');

    // Enriquece participantes com nome/email do usuário (evita N+1)
    const userIds = (event.participants as CalendarEventParticipant[])
      .filter(p => p.userId)
      .map(p => p.userId as string);

    if (userIds.length) {
      const users = await this.userRepo.find({
        where: { id: In([...new Set(userIds)]) },
        select: ['id', 'name', 'email', 'avatar'],
      });
      const userMap = new Map(users.map(u => [u.id, u]));
      event.participants = (event.participants as CalendarEventParticipant[]).map(p => ({
        ...p,
        user: p.userId ? (userMap.get(p.userId) ?? null) : null,
      }));
    }

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

    // Validações tenant-safe
    if (dto.clientId != null) await this.validateClient(tenantId, dto.clientId);
    if (dto.userIds?.length)  await this.validateUsers(tenantId, dto.userIds);

    const nextMetadata = {
      ...(event.metadata ?? {}),
      ...(dto.metadata ?? {}),
    } as Record<string, any>;

    if (dto.reminderAt !== undefined) {
      nextMetadata.reminderAt = dto.reminderAt ?? null;
      nextMetadata.reminderSentAt = null;
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
      ...(dto.clientId       !== undefined && { clientId: dto.clientId ?? null }),
      ...((dto.metadata !== undefined || dto.reminderAt !== undefined) && {
        metadata: Object.keys(nextMetadata).length ? nextMetadata : null,
      }),
    });

    await this.eventRepo.save(event);

    // Sync de usuários vinculados (só atualiza se userIds veio no payload)
    if (dto.userIds !== undefined) {
      await this.participantRepo
        .createQueryBuilder()
        .delete()
        .from(CalendarEventParticipant)
        .where('event_id = :eventId AND tenant_id = :tenantId AND user_id IS NOT NULL', { eventId: id, tenantId })
        .execute();

      if (dto.userIds.length) {
        const unique = [...new Set(dto.userIds)];
        await this.saveParticipants(tenantId, id, unique.map(uid => ({ userId: uid, role: 'attendee' })));
      }
    }

    return this.findOne(tenantId, id);
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
    if (dto.userId) await this.validateUsers(tenantId, [dto.userId]);
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
