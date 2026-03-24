import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutingRule } from './routing-rule.entity';

@Injectable()
export class RoutingRulesService {
  constructor(
    @InjectRepository(RoutingRule)
    private readonly repo: Repository<RoutingRule>,
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
    const result: any = {};
    for (const rule of rules) {
      const match =
        (!rule.condDepartment || rule.condDepartment === ticket.department) &&
        (!rule.condCategory || rule.condCategory === ticket.category) &&
        (!rule.condPriority || rule.condPriority === ticket.priority) &&
        (!rule.condOrigin || rule.condOrigin === ticket.origin);
      if (match) {
        if (rule.actionAssignTo) result.assignTo = rule.actionAssignTo;
        if (rule.actionSetPriority) result.priority = rule.actionSetPriority;
        if (rule.actionNotifyEmail) result.notifyEmail = rule.actionNotifyEmail;
        break; // first match wins
      }
    }
    return result;
  }
}
