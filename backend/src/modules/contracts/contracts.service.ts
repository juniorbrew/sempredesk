import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Contract, ContractStatus } from './entities/contract.entity';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
  ) {}

  private async getContractOrFail(tenantId: string, id: string): Promise<Contract> {
    const contract = await this.contractRepo.findOne({
      where: { id, tenantId },
    });

    if (!contract) {
      throw new NotFoundException('Contrato não encontrado');
    }

    return contract;
  }

  private async assertClientBelongsToTenant(tenantId: string, clientId?: string | null) {
    if (!clientId) return;

    const rows = await this.contractRepo.manager.query(
      'SELECT id FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, clientId],
    );

    if (!rows.length) {
      throw new BadRequestException('Cliente inválido para este tenant');
    }
  }

  async create(tenantId: string, dto: CreateContractDto): Promise<Contract> {
    const {
      tenantId: _tenantId,
      tenant_id: _tenant_id,
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      hoursUsed: _hoursUsed,
      ticketsUsed: _ticketsUsed,
      status: _status,
      ...safeDto
    } = dto as any;

    await this.assertClientBelongsToTenant(tenantId, safeDto.clientId);

    const contract = this.contractRepo.create({
      ...safeDto,
      tenantId,
    } as any);

    return this.contractRepo.save(contract as any) as any;
  }

  async findByTenant(tenantId: string): Promise<Contract[]> {
    return this.contractRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Contract> {
    return this.getContractOrFail(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateContractDto): Promise<Contract> {
    const contract = await this.getContractOrFail(tenantId, id);

    const {
      tenantId: _tenantId,
      tenant_id: _tenant_id,
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      hoursUsed: _hoursUsed,
      ticketsUsed: _ticketsUsed,
      ...safeDto
    } = dto as any;

    await this.assertClientBelongsToTenant(tenantId, safeDto.clientId);

    Object.assign(contract, safeDto);

    return this.contractRepo.save(contract as any) as any;
  }

  async findActiveContractForClient(tenantId: string, clientId: string): Promise<Contract | null> {
    await this.assertClientBelongsToTenant(tenantId, clientId);

    return this.contractRepo.findOne({
      where: {
        tenantId,
        clientId,
        status: ContractStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** Consome horas do contrato. Exige tenantId para garantir escopo. */
  async consumeHours(tenantId: string, id: string, minutes: number): Promise<void> {
    const contract = await this.getContractOrFail(tenantId, id);

    await this.contractRepo.increment(
      { id: contract.id, tenantId },
      'hoursUsed',
      minutes / 60,
    );

    await this.contractRepo.increment(
      { id: contract.id, tenantId },
      'ticketsUsed',
      1,
    );
  }

  async getConsumption(tenantId: string, id: string) {
    const contract = await this.getContractOrFail(tenantId, id);

    const hoursAvailable = contract.monthlyHours - Number(contract.hoursUsed);
    const ticketsAvailable = contract.ticketLimit > 0
      ? contract.ticketLimit - contract.ticketsUsed
      : null;

    return {
      contract,
      hoursUsed: Number(contract.hoursUsed),
      hoursAvailable: Math.max(0, hoursAvailable),
      hoursPercentage: contract.monthlyHours > 0
        ? Math.round((Number(contract.hoursUsed) / contract.monthlyHours) * 100)
        : 0,
      ticketsUsed: contract.ticketsUsed,
      ticketsAvailable,
      ticketsPercentage: contract.ticketLimit > 0
        ? Math.round((contract.ticketsUsed / contract.ticketLimit) * 100)
        : 0,
    };
  }

  async getExpiringSoon(tenantId: string, days = 30): Promise<Contract[]> {
    const future = new Date();
    future.setDate(future.getDate() + days);

    return this.contractRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.status = :status', { status: ContractStatus.ACTIVE })
      .andWhere('c.end_date <= :future', { future: future.toISOString().split('T')[0] })
      .andWhere('c.end_date >= :today', { today: new Date().toISOString().split('T')[0] })
      .orderBy('c.end_date', 'ASC')
      .getMany();
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkExpiringContracts() {
    const today = new Date().toISOString().split('T')[0];

    const tenants = await this.contractRepo.manager.query(
      'SELECT DISTINCT tenant_id FROM contracts WHERE tenant_id IS NOT NULL',
    );

    for (const row of tenants) {
      const tenantId = row.tenant_id;

      await this.contractRepo
        .createQueryBuilder()
        .update(Contract)
        .set({ status: ContractStatus.EXPIRED })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :status', { status: ContractStatus.ACTIVE })
        .andWhere('end_date < :today', { today })
        .execute();
    }
  }
}
