import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Ticket, TicketStatus } from './entities/ticket.entity';

@Injectable()
export class TicketSatisfactionService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly dataSource: DataSource,
  ) {}

  private async getTicketOrFail(ticketId: string): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  async applyPortalSatisfaction(ticketId: string, approved: boolean): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(ticketId);

    if (ticket.status !== TicketStatus.RESOLVED) {
      throw new BadRequestException('Somente tickets resolvidos podem receber avaliação');
    }

    if (ticket.satisfactionScore) {
      throw new BadRequestException('Avaliação já registrada para este ticket');
    }

    ticket.satisfactionScore = approved ? 'approved' : 'rejected';
    ticket.satisfactionAt = new Date();

    if (approved) {
      ticket.status = TicketStatus.CLOSED;
      ticket.closedAt = new Date();
    } else {
      ticket.status = TicketStatus.IN_PROGRESS;
      ticket.resolvedAt = null;
    }

    return this.ticketRepo.save(ticket);
  }

  async applyWhatsappRating(ticketId: string, rating: number, comment?: string): Promise<void>;
  async applyWhatsappRating(ticketId: string, tenantId: string, rating: number, comment?: string): Promise<void>;
  async applyWhatsappRating(
    ticketId: string,
    tenantIdOrRating: string | number,
    ratingOrComment?: number | string,
    commentArg?: string,
  ): Promise<void> {
    const hasTenantId = typeof tenantIdOrRating === 'string';
    const tenantId = hasTenantId ? tenantIdOrRating : null;
    const rating = hasTenantId ? Number(ratingOrComment) : Number(tenantIdOrRating);
    const comment = hasTenantId ? commentArg : (ratingOrComment as string | undefined);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('A nota deve ser um número inteiro entre 1 e 5');
    }

    const trimmedComment = comment?.trim();

    const qb = this.ticketRepo
      .createQueryBuilder()
      .update(Ticket)
      .set({
        satisfactionRating: rating,
        satisfactionComment: trimmedComment?.length ? trimmedComment : null,
        satisfactionAt: () => 'NOW()',
      })
      .where('id = :ticketId', { ticketId })
      .andWhere('satisfaction_rating IS NULL');

    if (tenantId) {
      qb.andWhere('tenant_id = :tenantId', { tenantId });
    }

    const result = await qb.execute();

    if ((result.affected ?? 0) > 0) return;

    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException('Ticket não encontrado');
    }

    if (tenantId && ticket.tenantId !== tenantId) {
      throw new BadRequestException('Ticket pertence a outro tenant ou acesso inválido');
    }

    if (ticket.satisfactionRating !== null) {
      throw new BadRequestException('Avaliação já registrada para este ticket');
    }

    throw new BadRequestException('Não foi possível registrar a avaliação');
  }
}
