import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RootCauseEntity } from './entities/root-cause.entity';
import { CreateRootCauseDto, FilterRootCauseDto, UpdateRootCauseDto } from './dto/root-cause.dto';

@Injectable()
export class RootCausesService {
  constructor(
    @InjectRepository(RootCauseEntity)
    private readonly repo: Repository<RootCauseEntity>,
  ) {}

  private normalizeName(name: string) {
    return name.trim().replace(/\s+/g, ' ');
  }

  private async getOrFail(tenantId: string, id: string) {
    const item = await this.repo.findOne({ where: { tenantId, id } });
    if (!item) throw new NotFoundException('Causa raiz não encontrada');
    return item;
  }

  async create(tenantId: string, dto: CreateRootCauseDto) {
    const name = this.normalizeName(dto.name);
    if (!name) throw new BadRequestException('Nome da causa raiz é obrigatório');

    const exists = await this.repo.findOne({ where: { tenantId, name } });
    if (exists) throw new ConflictException('Já existe uma causa raiz com esse nome');

    const created = this.repo.create({
      tenantId,
      name,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.repo.save(created);
  }

  async findAll(tenantId: string, filters: FilterRootCauseDto = {}) {
    const qb = this.repo.createQueryBuilder('r')
      .where('r.tenant_id = :tenantId', { tenantId })
      .orderBy('r.sort_order', 'ASC')
      .addOrderBy('r.name', 'ASC');

    if (filters.active !== undefined) qb.andWhere('r.active = :active', { active: filters.active });

    return qb.getMany();
  }

  async findOne(tenantId: string, id: string) {
    return this.getOrFail(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateRootCauseDto) {
    const current = await this.getOrFail(tenantId, id);
    const nextName = dto.name ? this.normalizeName(dto.name) : current.name;

    const exists = await this.repo.findOne({ where: { tenantId, name: nextName } });
    if (exists && exists.id !== id) throw new ConflictException('Já existe uma causa raiz com esse nome');

    Object.assign(current, {
      ...dto,
      name: nextName,
    });

    return this.repo.save(current);
  }

  async remove(tenantId: string, id: string) {
    const current = await this.getOrFail(tenantId, id);
    current.active = false;
    return this.repo.save(current);
  }
}
