import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

const PLAN_LIMITS: Record<string, any> = {
  starter:      { technicians:  3, clients:  50, ticketsPerMonth:  200, devices:  20, storageGb:   5 },
  professional: { technicians: 10, clients: 500, ticketsPerMonth: 2000, devices: 200, storageGb:  50 },
  enterprise:   { technicians: -1, clients:  -1, ticketsPerMonth:   -1, devices:  -1, storageGb: 500 },
};

@Injectable()
export class TenantsService {
  constructor(@InjectRepository(Tenant) private readonly repo: Repository<Tenant>) {}

  async create(data: Partial<Tenant>) {
    const exists = await this.repo.findOne({ where: { slug: data.slug } });
    if (exists) throw new ConflictException('Slug já utilizado');
    const t = this.repo.create({ ...data, limits: PLAN_LIMITS[data.plan ?? 'starter'] });
    return this.repo.save(t);
  }

  findAll()              { return this.repo.find({ order: { name: 'ASC' } }); }
  async findOne(id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tenant não encontrado');
    return t;
  }
  async findBySlug(slug: string) {
    const t = await this.repo.findOne({ where: { slug } });
    if (!t) throw new NotFoundException('Tenant não encontrado');
    return t;
  }
  async update(id: string, data: Partial<Tenant>) {
    await this.findOne(id);
    await this.repo.update(id, data);
    return this.findOne(id);
  }
}
