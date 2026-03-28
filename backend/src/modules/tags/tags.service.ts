import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TagEntity } from './entities/tag.entity';
import { CreateTagDto, FilterTagDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(TagEntity)
    private readonly repo: Repository<TagEntity>,
  ) {}

  private normalizeName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private async getOrFail(tenantId: string, id: string) {
    const item = await this.repo.findOne({ where: { tenantId, id } });
    if (!item) throw new NotFoundException('Tag não encontrada');
    return item;
  }

  async create(tenantId: string, dto: CreateTagDto) {
    const name = this.normalizeName(dto.name);
    if (!name) throw new BadRequestException('Nome da tag é obrigatório');

    const exists = await this.repo.findOne({ where: { tenantId, name } });
    if (exists) throw new ConflictException('Já existe uma tag com esse nome');

    const created = this.repo.create({
      tenantId,
      name,
      color: dto.color?.trim() || null,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.repo.save(created);
  }

  async findAll(tenantId: string, filters: FilterTagDto = {}) {
    const qb = this.repo.createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.sort_order', 'ASC')
      .addOrderBy('t.name', 'ASC');

    if (filters.active !== undefined) qb.andWhere('t.active = :active', { active: filters.active });

    return qb.getMany();
  }

  async findOne(tenantId: string, id: string) {
    return this.getOrFail(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateTagDto) {
    const current = await this.getOrFail(tenantId, id);
    const nextName = dto.name ? this.normalizeName(dto.name) : current.name;

    const exists = await this.repo.findOne({ where: { tenantId, name: nextName } });
    if (exists && exists.id !== id) throw new ConflictException('Já existe uma tag com esse nome');

    Object.assign(current, {
      ...dto,
      name: nextName,
      color: dto.color !== undefined ? (dto.color?.trim() || null) : current.color,
    });

    return this.repo.save(current);
  }

  async remove(tenantId: string, id: string) {
    const current = await this.getOrFail(tenantId, id);
    current.active = false;
    return this.repo.save(current);
  }
}
