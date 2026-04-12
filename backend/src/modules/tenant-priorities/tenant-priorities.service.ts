import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantPriority } from './entities/tenant-priority.entity';
import { SlaPolicy } from '../sla/entities/sla-policy.entity';
import {
  CreateTenantPriorityDto,
  UpdateTenantPriorityDto,
} from './dto/tenant-priority.dto';

@Injectable()
export class TenantPrioritiesService {
  constructor(
    @InjectRepository(TenantPriority)
    private readonly repo: Repository<TenantPriority>,
    @InjectRepository(SlaPolicy)
    private readonly slaRepo: Repository<SlaPolicy>,
  ) {}

  async findAll(tenantId: string): Promise<TenantPriority[]> {
    return this.repo.find({
      where: { tenantId },
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['slaPolicy'],
    });
  }

  /**
   * Prioridades ativas para formulários de ticket/atendimento.
   * Se `includeCurrentId` for um UUID de prioridade inativa (ou ativa) do tenant,
   * garante que essa entrada apareça na lista (para o select de edição não ficar vazio).
   */
  async findAllForTicketUi(
    tenantId: string,
    includeCurrentId?: string | null,
  ): Promise<TenantPriority[]> {
    const active = await this.repo.find({
      where: { tenantId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const cur = (includeCurrentId || '').trim();
    if (!cur) return active;
    if (active.some((p) => p.id === cur)) return active;

    const extra = await this.repo.findOne({ where: { id: cur, tenantId } });
    if (!extra) return active;

    return [...active, extra];
  }

  async findOne(tenantId: string, id: string): Promise<TenantPriority> {
    const row = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['slaPolicy'],
    });
    if (!row) throw new NotFoundException('Prioridade não encontrada');
    return row;
  }

  async create(tenantId: string, dto: CreateTenantPriorityDto): Promise<TenantPriority> {
    const exists = await this.repo.exist({ where: { tenantId, slug: dto.slug } });
    if (exists) {
      throw new ConflictException(`Já existe prioridade com slug "${dto.slug}" neste tenant`);
    }
    await this.assertSlaPolicyBelongsToTenant(tenantId, dto.slaPolicyId);

    const row = this.repo.create({
      tenantId,
      name: dto.name,
      slug: dto.slug,
      color: dto.color,
      sortOrder: dto.sortOrder,
      active: dto.active ?? true,
      slaPolicyId: dto.slaPolicyId ?? null,
    });
    return this.repo.save(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTenantPriorityDto,
  ): Promise<TenantPriority> {
    const row = await this.findOne(tenantId, id);

    if (dto.slug !== undefined && dto.slug !== row.slug) {
      const taken = await this.repo.exist({ where: { tenantId, slug: dto.slug } });
      if (taken) {
        throw new ConflictException(`Já existe prioridade com slug "${dto.slug}" neste tenant`);
      }
    }

    if (dto.slaPolicyId !== undefined) {
      await this.assertSlaPolicyBelongsToTenant(tenantId, dto.slaPolicyId);
    }

    Object.assign(row, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.slug !== undefined && { slug: dto.slug }),
      ...(dto.color !== undefined && { color: dto.color }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.slaPolicyId !== undefined && { slaPolicyId: dto.slaPolicyId }),
    });

    return this.repo.save(row);
  }

  async setActive(tenantId: string, id: string, active: boolean): Promise<TenantPriority> {
    const row = await this.findOne(tenantId, id);
    row.active = active;
    return this.repo.save(row);
  }

  private async assertSlaPolicyBelongsToTenant(
    tenantId: string,
    slaPolicyId: string | null | undefined,
  ): Promise<void> {
    if (slaPolicyId === undefined || slaPolicyId === null) return;
    const policy = await this.slaRepo.findOne({
      where: { id: slaPolicyId, tenantId },
    });
    if (!policy) {
      throw new BadRequestException('Política SLA não encontrada ou não pertence ao tenant');
    }
  }
}
