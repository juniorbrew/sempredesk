import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Lista agentes do tenant. Se networkId informado, restringe ao escopo da rede (supervisor). */
  async findTechnicians(tenantId: string, networkId?: string | null) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.tenant_id = :tenantId', { tenantId })
      .orderBy('u.name', 'ASC')
      .select(['u.id', 'u.name', 'u.email', 'u.role', 'u.phone', 'u.avatar', 'u.status',
        'u.distributionAvailabilityEnabled', 'u.distributionStartTime', 'u.distributionEndTime']);
    if (networkId) {
      qb.andWhere('(u.network_id = :networkId OR u.network_id IS NULL)', { networkId });
    }
    return qb.getMany();
  }

  async findOne(tenantId: string, id: string) {
    return this.userRepo.findOne({
      where: { id, tenantId },
      select: ['id', 'name', 'email', 'role', 'phone', 'avatar', 'status', 'lastLogin',
        'distributionAvailabilityEnabled', 'distributionStartTime', 'distributionEndTime'],
    });
  }

  async create(tenantId: string, dto: any, requesterRole?: string) {
    if (requesterRole === 'admin' && dto.role === 'super_admin') {
      throw new ForbiddenException('Apenas super_admin pode criar usuários com role super_admin');
    }
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('E-mail já cadastrado');
    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      password: dto.password || 'Mudar@123',
      role: dto.role || 'technician',
      phone: dto.phone,
      tenantId,
      status: 'active',
      distributionAvailabilityEnabled: dto.distributionAvailabilityEnabled ?? false,
      distributionStartTime: dto.distributionStartTime ?? null,
      distributionEndTime: dto.distributionEndTime ?? null,
    } as any);
    const saved: any = await this.userRepo.save(user as any);
    return typeof saved?.toJSON === 'function' ? saved.toJSON() : saved;
  }

  async update(tenantId: string, id: string, dto: any, requesterRole?: string) {
    const user = await this.userRepo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('Membro não encontrado');
    if (requesterRole === 'admin' && (dto.role === 'super_admin' || (user as any).role === 'super_admin')) {
      throw new ForbiddenException('Apenas super_admin pode alterar role super_admin');
    }
    const { password, ...rest } = dto;
    if (Object.keys(rest).length > 0) await this.userRepo.update({ id, tenantId }, rest);
    if (password) {
      const u = await this.userRepo.findOne({ where: { id, tenantId } });
      if (u) { u.password = password; await this.userRepo.save(u as any); }
    }
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, id: string, requesterRole?: string) {
    const user = await this.userRepo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('Membro não encontrado');
    if (requesterRole === 'admin' && (user as any).role === 'super_admin') {
      throw new ForbiddenException('Apenas super_admin pode inativar usuários super_admin');
    }
    await this.userRepo.update({ id, tenantId }, { status: 'inactive' as any });
  }
}
