import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskLog } from './entities/task-log.entity';
import {
  CreateTaskDto, UpdateTaskDto, FilterTaskDto, AddTaskCommentDto,
} from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskLog)
    private readonly logRepo: Repository<TaskLog>,
  ) {}

  private async getOrFail(tenantId: string, id: string): Promise<Task> {
    const task = await this.taskRepo.findOne({ where: { tenantId, id } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    return task;
  }

  private async writeLog(
    tenantId: string,
    taskId: string,
    authorId: string | null,
    authorName: string | null,
    action: string,
    fromValue?: string,
    toValue?: string,
    comment?: string,
  ) {
    const log = this.logRepo.create({
      tenantId, taskId, authorId, authorName,
      action, fromValue: fromValue ?? null,
      toValue: toValue ?? null, comment: comment ?? null,
    });
    return this.logRepo.save(log);
  }

  async create(tenantId: string, userId: string, authorName: string, dto: CreateTaskDto): Promise<Task> {
    const task = this.taskRepo.create({
      tenantId,
      createdBy: userId,
      title:           dto.title,
      description:     dto.description     ?? null,
      priority:        dto.priority        ?? 'medium',
      status:          'pending',
      dueAt:           dto.dueAt           ? new Date(dto.dueAt)       : null,
      reminderAt:      dto.reminderAt      ? new Date(dto.reminderAt)  : null,
      assignedUserId:  dto.assignedUserId  ?? null,
      departmentId:    dto.departmentId    ?? null,
      ticketId:        dto.ticketId        ?? null,
      contactId:       dto.contactId       ?? null,
      clientId:        dto.clientId        ?? null,
      calendarEventId: dto.calendarEventId ?? null,
      origin:          dto.origin          ?? 'manual',
      checklist:       dto.checklist       ?? null,
      notes:           dto.notes           ?? null,
      metadata:        dto.metadata        ?? null,
    });

    const saved = await this.taskRepo.save(task);
    await this.writeLog(tenantId, saved.id, userId, authorName, 'created', undefined, 'pending');
    return saved;
  }

  async findAll(tenantId: string, filters: FilterTaskDto) {
    const page    = filters.page    ?? 1;
    const perPage = filters.perPage ?? 20;

    const qb = this.taskRepo.createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('t.created_at', 'DESC');

    if (filters.status)         qb.andWhere('t.status = :status',             { status: filters.status });
    if (filters.priority)       qb.andWhere('t.priority = :priority',         { priority: filters.priority });
    if (filters.assignedUserId) qb.andWhere('t.assigned_user_id = :uid',      { uid: filters.assignedUserId });
    if (filters.departmentId)   qb.andWhere('t.department_id = :deptId',      { deptId: filters.departmentId });
    if (filters.ticketId)       qb.andWhere('t.ticket_id = :ticketId',        { ticketId: filters.ticketId });
    if (filters.clientId)       qb.andWhere('t.client_id = :clientId',        { clientId: filters.clientId });
    if (filters.dueBefore)      qb.andWhere('t.due_at <= :dueBefore',         { dueBefore: filters.dueBefore });
    if (filters.dueAfter)       qb.andWhere('t.due_at >= :dueAfter',          { dueAfter: filters.dueAfter });

    const [items, total] = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    const totalPages = Math.ceil(total / perPage) || 1;
    return { data: items, total, page, perPage, totalPages };
  }

  async findOne(tenantId: string, id: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { tenantId, id },
      relations: ['logs'],
      order: { logs: { createdAt: 'ASC' } } as any,
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    return task;
  }

  async update(
    tenantId: string, id: string,
    userId: string, authorName: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.getOrFail(tenantId, id);

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new BadRequestException(`Não é possível editar uma tarefa com status "${task.status}"`);
    }

    const prevStatus = task.status;

    Object.assign(task, {
      ...(dto.title          !== undefined && { title: dto.title }),
      ...(dto.description    !== undefined && { description: dto.description }),
      ...(dto.priority       !== undefined && { priority: dto.priority }),
      ...(dto.dueAt          !== undefined && { dueAt: dto.dueAt ? new Date(dto.dueAt) : null }),
      ...(dto.reminderAt     !== undefined && { reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null }),
      ...(dto.assignedUserId !== undefined && { assignedUserId: dto.assignedUserId }),
      ...(dto.departmentId   !== undefined && { departmentId: dto.departmentId }),
      ...(dto.ticketId       !== undefined && { ticketId: dto.ticketId }),
      ...(dto.contactId      !== undefined && { contactId: dto.contactId }),
      ...(dto.clientId       !== undefined && { clientId: dto.clientId }),
      ...(dto.calendarEventId !== undefined && { calendarEventId: dto.calendarEventId }),
      ...(dto.checklist      !== undefined && { checklist: dto.checklist }),
      ...(dto.notes          !== undefined && { notes: dto.notes }),
      ...(dto.metadata       !== undefined && { metadata: dto.metadata }),
      ...(dto.status         !== undefined && { status: dto.status }),
    });

    const saved = await this.taskRepo.save(task);

    if (dto.status && dto.status !== prevStatus) {
      await this.writeLog(tenantId, id, userId, authorName, 'status_changed', prevStatus, dto.status);
    }

    return saved;
  }

  async complete(tenantId: string, id: string, userId: string, authorName: string): Promise<Task> {
    const task = await this.getOrFail(tenantId, id);
    if (task.status === 'completed') return task;
    if (task.status === 'cancelled') {
      throw new BadRequestException('Não é possível concluir uma tarefa cancelada');
    }
    const prev = task.status;
    task.status      = 'completed';
    task.completedAt = new Date();
    const saved = await this.taskRepo.save(task);
    await this.writeLog(tenantId, id, userId, authorName, 'completed', prev, 'completed');
    return saved;
  }

  async cancel(tenantId: string, id: string, userId: string, authorName: string): Promise<Task> {
    const task = await this.getOrFail(tenantId, id);
    if (task.status === 'cancelled') return task;
    if (task.status === 'completed') {
      throw new BadRequestException('Não é possível cancelar uma tarefa já concluída');
    }
    const prev = task.status;
    task.status      = 'cancelled';
    task.cancelledAt = new Date();
    const saved = await this.taskRepo.save(task);
    await this.writeLog(tenantId, id, userId, authorName, 'cancelled', prev, 'cancelled');
    return saved;
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: boolean }> {
    const task = await this.getOrFail(tenantId, id);
    await this.taskRepo.remove(task);
    return { deleted: true };
  }

  async addComment(
    tenantId: string, id: string,
    userId: string, authorName: string,
    dto: AddTaskCommentDto,
  ) {
    await this.getOrFail(tenantId, id);
    return this.writeLog(tenantId, id, userId, authorName, 'commented', undefined, undefined, dto.comment);
  }

  async findByTicket(tenantId: string, ticketId: string) {
    return this.taskRepo.find({
      where: { tenantId, ticketId },
      order: { createdAt: 'DESC' },
    });
  }
}
