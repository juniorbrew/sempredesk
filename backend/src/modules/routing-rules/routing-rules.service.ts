import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutingRule } from './routing-rule.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';

@Injectable()
export class RoutingRulesService {
  private readonly logger = new Logger(RoutingRulesService.name);

  constructor(
    @InjectRepository(RoutingRule)
    private readonly repo: Repository<RoutingRule>,
    @InjectRepository(TenantPriority)
    private readonly tenantPriorityRepo: Repository<TenantPriority>,
  ) {}

  findAll(tenantId: string): Promise<RoutingRule[]> {
    return this.repo.find({ where: { tenantId }, order: { priority: 'ASC' } });
  }

  create(tenantId: string, dto: Partial<RoutingRule>): Promise<RoutingRule> {
    const rule = this.repo.create({ ...dto, tenantId });
    return this.repo.save(rule);
  }

  async update(tenantId: string, id: string, dto: Partial<RoutingRule>): Promise<RoutingRule> {
    await this.repo.update({ id, tenantId }, dto);
    return this.repo.findOne({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.repo.delete({ id, tenantId });
  }

  async applyRules(tenantId: string, ticket: any): Promise<{ assignTo?: string; priority?: string; notifyEmail?: string }> {
    const rules = await this.repo.find({ where: { tenantId, active: true }, order: { priority: 'ASC' } });
    let ticketPrioritySlug: string | null = null;
    if (ticket.priorityId) {
      const tp = await this.tenantPriorityRepo.findOne({
        where: { id: ticket.priorityId, tenantId },
        select: ['slug'],
      });
      ticketPrioritySlug = tp?.slug ?? null;
    }
    const result: any = {};
    for (const rule of rules) {
      const condPriorityOk =
        !rule.condPriority ||
        rule.condPriority === ticket.priority ||
        (!!ticketPrioritySlug && rule.condPriority === ticketPrioritySlug);
      const deptMatch = rule.condDepartmentId
        ? rule.condDepartmentId === ticket.departmentId
        : (!rule.condDepartment || rule.condDepartment === ticket.department);
      const match =
        deptMatch &&
        (!rule.condCategory || rule.condCategory === ticket.category) &&
        condPriorityOk &&
        (!rule.condOrigin || rule.condOrigin === ticket.origin);
      if (match) {
        this.logger.log(
          `[routing:match] rule="${rule.name}" dept="${ticket.department ?? '-'}" deptId=${ticket.departmentId ?? 'null'} → assign=${rule.actionAssignTo ?? '-'} priority=${rule.actionSetPriority ?? '-'}`,
        );
        if (rule.actionAssignTo) result.assignTo = rule.actionAssignTo;
        if (rule.actionSetPriority) result.priority = rule.actionSetPriority;
        if (rule.actionNotifyEmail) result.notifyEmail = rule.actionNotifyEmail;
        break; // first match wins
      }
    }
    return result;
  }
}
