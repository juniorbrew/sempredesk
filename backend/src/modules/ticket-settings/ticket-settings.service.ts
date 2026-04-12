import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketSetting, TicketSettingType } from './entities/ticket-setting.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';
import {
  CreateTicketSettingDto,
  UpdateTicketSettingDto,
  FilterTicketSettingDto,
} from './dto/ticket-setting.dto';

@Injectable()
export class TicketSettingsService {
  constructor(
    @InjectRepository(TicketSetting)
    private readonly repo: Repository<TicketSetting>,
    @InjectRepository(TenantPriority)
    private readonly priorityRepo: Repository<TenantPriority>,
  ) {}

  private async getOrFail(tenantId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Cadastro nÃ£o encontrado');
    return item;
  }

  /**
   * Resolve departamento canÃ³nico pelo nome (case-insensitive, trim), para fluxo chatbot/WhatsApp.
   */
  async findDepartmentByCanonicalName(tenantId: string, name: string): Promise<TicketSetting | null> {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const row = await this.repo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.type = :type', { type: TicketSettingType.DEPARTMENT })
      .andWhere('LOWER(TRIM(s.name)) = LOWER(:name)', { name: trimmed })
      .getOne();
    return row ?? null;
  }

  /**
   * Departamento usado para prioridade padrÃ£o + SLA da conversa (Fase 3).
   * Aceita nome (menu chatbot) ou id (portal).
   */
  async resolveDepartmentSettingForSla(
    tenantId: string,
    opts: { department?: string | null; departmentId?: string | null },
  ): Promise<TicketSetting | null> {
    const did = (opts.departmentId || '').trim();
    if (did) {
      return this.repo.findOne({
        where: { id: did, tenantId, type: TicketSettingType.DEPARTMENT },
      });
    }
    const dname = (opts.department || '').trim();
    if (dname) {
      return this.findDepartmentByCanonicalName(tenantId, dname);
    }
    return null;
  }

  private async assertParentValid(tenantId: string, type: TicketSettingType, parentId?: string) {
    if (!parentId) return;

    const parent = await this.repo.findOne({ where: { id: parentId, tenantId, active: true } });
    if (!parent) throw new BadRequestException('Pai invÃ¡lido para este tenant');

    if (type === TicketSettingType.CATEGORY && parent.type !== TicketSettingType.DEPARTMENT) {
      throw new BadRequestException('Categoria deve pertencer a um departamento');
    }

    if (type === TicketSettingType.SUBCATEGORY && parent.type !== TicketSettingType.CATEGORY) {
      throw new BadRequestException('Subcategoria deve pertencer a uma categoria');
    }

    if (type === TicketSettingType.DEPARTMENT) {
      throw new BadRequestException('Departamento nÃ£o pode ter pai');
    }
  }

  private normalizeOptionalId(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private async findActiveSettingByCanonicalName(
    tenantId: string,
    type: TicketSettingType,
    name?: string | null,
    parentId?: string | null,
  ): Promise<TicketSetting | null> {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;

    const qb = this.repo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.type = :type', { type })
      .andWhere('s.active = true')
      .andWhere('LOWER(TRIM(s.name)) = LOWER(:name)', { name: trimmed });

    if (parentId) {
      qb.andWhere('s.parent_id = :parentId', { parentId });
    }

    return (await qb.getOne()) ?? null;
  }

  private async assertDefaultPriorityValid(
    tenantId: string,
    _type: TicketSettingType,
    value: string | null | undefined,
  ): Promise<void> {
    const normalized = this.normalizeOptionalId(value);
    if (!normalized) {
      return;
    }
    const p = await this.priorityRepo.findOne({
      where: { id: normalized, tenantId },
    });
    if (!p) {
      throw new BadRequestException('Prioridade nÃ£o encontrada ou nÃ£o pertence ao tenant');
    }
  }

  async create(tenantId: string, dto: CreateTicketSettingDto) {
    await this.assertParentValid(tenantId, dto.type, dto.parentId);
    await this.assertDefaultPriorityValid(tenantId, dto.type, dto.defaultPriorityId);

    const exists = await this.repo.findOne({
      where: {
        tenantId,
        type: dto.type,
        name: dto.name.trim(),
        parentId: dto.parentId || null,
      },
    });

    if (exists) {
      throw new ConflictException('JÃ¡ existe um cadastro com esse nome');
    }

    const defaultPriorityId = this.normalizeOptionalId(dto.defaultPriorityId);

    const item = this.repo.create({
      tenantId,
      type: dto.type,
      name: dto.name.trim(),
      parentId: dto.parentId || null,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
      color: (dto as any).color || null,
      defaultPriorityId,
    });

    return this.repo.save(item);
  }

  async findAll(tenantId: string, filters: FilterTicketSettingDto = {}) {
    const qb = this.repo.createQueryBuilder('s')
      .leftJoinAndSelect('s.defaultPriority', 'dp')
      .where('s.tenant_id = :tenantId', { tenantId })
      .orderBy('s.type', 'ASC')
      .addOrderBy('s.sort_order', 'ASC')
      .addOrderBy('s.name', 'ASC');

    if (filters.type) qb.andWhere('s.type = :type', { type: filters.type });
    if (filters.parentId) qb.andWhere('s.parent_id = :parentId', { parentId: filters.parentId });
    if (filters.active !== undefined) qb.andWhere('s.active = :active', { active: filters.active });

    return qb.getMany();
  }

  /** Lista plana de departamentos para o widget (id, name, color) */
  async findDepartmentsList(tenantId: string): Promise<{
    id: string;
    name: string;
    color: string;
    defaultPriorityId: string | null;
  }[]> {
    const items = await this.repo.find({
      where: { tenantId, type: TicketSettingType.DEPARTMENT, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['defaultPriority'],
    });
    return items.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color || '#534AB7',
      defaultPriorityId: d.defaultPriorityId ?? null,
    }));
  }

  async resolveDefaultPriorityIdForClassification(
    tenantId: string,
    opts: {
      department?: string | null;
      category?: string | null;
      subcategory?: string | null;
    },
  ): Promise<string | null> {
    const department = await this.findActiveSettingByCanonicalName(
      tenantId,
      TicketSettingType.DEPARTMENT,
      opts.department,
    );
    const category = await this.findActiveSettingByCanonicalName(
      tenantId,
      TicketSettingType.CATEGORY,
      opts.category,
      department?.id ?? null,
    );
    const subcategory = await this.findActiveSettingByCanonicalName(
      tenantId,
      TicketSettingType.SUBCATEGORY,
      opts.subcategory,
      category?.id ?? null,
    );

    return (
      subcategory?.defaultPriorityId ??
      category?.defaultPriorityId ??
      department?.defaultPriorityId ??
      null
    );
  }

  async findTree(tenantId: string) {
    const items = await this.repo.find({
      where: { tenantId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['defaultPriority'],
    });

    const departments = items
      .filter((i) => i.type === TicketSettingType.DEPARTMENT)
      .map((department) => {
        const categories = items
          .filter((i) => i.type === TicketSettingType.CATEGORY && i.parentId === department.id)
          .map((category) => ({
            ...category,
            subcategories: items.filter(
              (i) => i.type === TicketSettingType.SUBCATEGORY && i.parentId === category.id,
            ),
          }));

        return { ...department, categories };
      });

    return { departments };
  }

  async findOne(tenantId: string, id: string) {
    const item = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['defaultPriority'],
    });
    if (!item) throw new NotFoundException('Cadastro nÃ£o encontrado');
    return item;
  }

  async update(tenantId: string, id: string, dto: UpdateTicketSettingDto) {
    const current = await this.getOrFail(tenantId, id);

    const nextParentId = dto.parentId === '' ? null : (dto.parentId ?? current.parentId);
    await this.assertParentValid(tenantId, current.type, nextParentId || undefined);

    if (dto.name && dto.name.trim() !== current.name) {
      const exists = await this.repo.findOne({
        where: {
          tenantId,
          type: current.type,
          name: dto.name.trim(),
          parentId: nextParentId,
        },
      });

      if (exists && exists.id !== id) {
        throw new ConflictException('JÃ¡ existe um cadastro com esse nome');
      }
    }

    if (dto.defaultPriorityId !== undefined) {
      await this.assertDefaultPriorityValid(tenantId, current.type, dto.defaultPriorityId);
      current.defaultPriorityId = this.normalizeOptionalId(dto.defaultPriorityId);
    }

    if (dto.name !== undefined) current.name = dto.name.trim();
    current.parentId = nextParentId;
    if (dto.sortOrder !== undefined) current.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) current.active = dto.active;
    if ((dto as any).color !== undefined) current.color = (dto as any).color;

    return this.repo.save(current);
  }

  async remove(tenantId: string, id: string) {
    const current = await this.getOrFail(tenantId, id);

    const child = await this.repo.findOne({
      where: {
        tenantId,
        parentId: current.id,
        active: true,
      },
    });

    if (child) {
      throw new BadRequestException('Existem itens vinculados a este cadastro');
    }

    current.active = false;
    return this.repo.save(current);
  }
}

