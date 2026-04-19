import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

export const PLAN_LIMITS: Record<string, any> = {
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

  /**
   * Resolve o tenant pelo hostname da requisição.
   * Ordem de tentativa:
   *   1. custom_domain exato (ex.: empresa.com.br)
   *   2. subdomínio do baseDomain (ex.: techcorp.sempredesk.com.br → slug "techcorp")
   * Retorna null se não encontrar (não lança exceção — caller decide o fallback).
   */
  async findByHost(host: string, baseDomain: string): Promise<Tenant | null> {
    // Remove porta, se houver (ex.: "localhost:3000" → "localhost")
    const cleanHost = host.split(':')[0].toLowerCase().trim();

    // 1. Tenta custom_domain exato
    const byCustom = await this.repo.findOne({ where: { customDomain: cleanHost } });
    if (byCustom) return byCustom;

    // 2. Tenta extrair slug do subdomínio (ex.: techcorp.sempredesk.com.br)
    const base = baseDomain.toLowerCase().trim();
    if (cleanHost.endsWith(`.${base}`)) {
      const sub = cleanHost.slice(0, cleanHost.length - base.length - 1); // remove ".baseDomain"
      // Ignora subdomínios fixos do sistema
      const systemHosts = ['suporte', 'cliente', 'adminpanel', 'www', 'api', 'app', 'mail'];
      if (sub && !systemHosts.includes(sub) && !sub.includes('.')) {
        const bySlug = await this.repo.findOne({ where: { slug: sub } });
        return bySlug ?? null;
      }
    }

    return null;
  }
  async update(id: string, data: Partial<Tenant>) {
    await this.findOne(id);
    await this.repo.update(id, data);
    return this.findOne(id);
  }
}
