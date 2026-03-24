import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketSetting, TicketSettingType } from './entities/ticket-setting.entity';
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
  ) {}

  private async getOrFail(tenantId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Cadastro não encontrado');
    return item;
  }

  private async assertParentValid(tenantId: string, type: TicketSettingType, parentId?: string) {
    if (!parentId) return;

    const parent = await this.repo.findOne({ where: { id: parentId, tenantId, active: true } });
    if (!parent) throw new BadRequestException('Pai inválido para este tenant');

    if (type === TicketSettingType.CATEGORY && parent.type !== TicketSettingType.DEPARTMENT) {
      throw new BadRequestException('Categoria deve pertencer a um departamento');
    }

    if (type === TicketSettingType.SUBCATEGORY && parent.type !== TicketSettingType.CATEGORY) {
      throw new BadRequestException('Subcategoria deve pertencer a uma categoria');
    }

    if (type === TicketSettingType.DEPARTMENT) {
      throw new BadRequestException('Departamento não pode ter pai');
    }
  }

  async create(tenantId: string, dto: CreateTicketSettingDto) {
    await this.assertParentValid(tenantId, dto.type, dto.parentId);

    const exists = await this.repo.findOne({
      where: {
        tenantId,
        type: dto.type,
        name: dto.name.trim(),
        parentId: dto.parentId || null,
      },
    });

    if (exists) {
      throw new ConflictException('Já existe um cadastro com esse nome');
    }

    const item = this.repo.create({
      tenantId,
      type: dto.type,
      name: dto.name.trim(),
      parentId: dto.parentId || null,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
      color: (dto as any).color || null,
    });

    return this.repo.save(item);
  }

  async findAll(tenantId: string, filters: FilterTicketSettingDto = {}) {
    const qb = this.repo.createQueryBuilder('s')
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
  async findDepartmentsList(tenantId: string): Promise<{ id: string; name: string; color: string }[]> {
    const items = await this.repo.find({
      where: { tenantId, type: TicketSettingType.DEPARTMENT, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return items.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color || '#534AB7',
    }));
  }

  async findTree(tenantId: string) {
    const items = await this.repo.find({
      where: { tenantId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
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
    return this.getOrFail(tenantId, id);
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
        throw new ConflictException('Já existe um cadastro com esse nome');
      }
    }

    Object.assign(current, {
      ...dto,
      name: dto.name?.trim() ?? current.name,
      parentId: nextParentId,
      color: (dto as any).color !== undefined ? (dto as any).color : current.color,
    });

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
