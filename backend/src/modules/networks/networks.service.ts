import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Network } from './network.entity';

@Injectable()
export class NetworksService {
  constructor(@InjectRepository(Network) private readonly repo: Repository<Network>) {}

  private async nextCode(tenantId: string): Promise<string> {
    const last = await this.repo.createQueryBuilder('n')
      .where('n.tenant_id = :tenantId', { tenantId })
      .andWhere('n.code IS NOT NULL')
      .orderBy('n.code', 'DESC')
      .getOne();
    const next = last?.code ? parseInt(last.code, 10) + 1 : 1;
    return String(next).padStart(6, '0');
  }

  async create(tenantId: string, dto: any) {
    const code = await this.nextCode(tenantId);
    const { tenantId: _tenantId, tenant_id: _tenant_id, code: _code, ...safeDto } = dto as any;
    return this.repo.save(this.repo.create({ ...safeDto, tenantId, code }));
  }

  async findAll(tenantId: string, search?: string) {
    const qb = this.repo.createQueryBuilder('n')
      .where('n.tenant_id = :tenantId', { tenantId })
      .orderBy('n.name', 'ASC');
    if (search) qb.andWhere('n.name ILIKE :s', { s: `%${search}%` });
    const data = await qb.getMany();
    return { data, total: data.length };
  }

  async findOne(tenantId: string, id: string) {
    const n = await this.repo.findOne({ where: { id, tenantId } });
    if (!n) throw new NotFoundException('Rede não encontrada');
    return n;
  }

  async update(tenantId: string, id: string, dto: any) {
    await this.findOne(tenantId, id);
    await this.repo.update({ id, tenantId }, dto);
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.repo.update({ id, tenantId }, { status: 'inactive' });
  }
}
