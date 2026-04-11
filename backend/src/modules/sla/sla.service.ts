import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SlaPolicy, SlaPriority } from './entities/sla-policy.entity';
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from './dto/sla-policy.dto';

/** Status SLA calculado para uma conversa. */
export type SlaStatus = 'within' | 'at_risk' | 'breached';

/**
 * Percentual restante do prazo de resolução abaixo do qual
 * a conversa é considerada "em risco". Ex: 20% = menos de 1/5 do tempo restante.
 */
const AT_RISK_THRESHOLD = 0.20;

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    @InjectRepository(SlaPolicy)
    private readonly policyRepo: Repository<SlaPolicy>,
    private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────
  // CRUD de políticas
  // ──────────────────────────────────────────────

  async findAll(tenantId: string): Promise<SlaPolicy[]> {
    return this.policyRepo.find({
      where: { tenantId },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<SlaPolicy> {
    const policy = await this.policyRepo.findOne({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException('Política SLA não encontrada');
    return policy;
  }

  async create(tenantId: string, dto: CreateSlaPolicyDto): Promise<SlaPolicy> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SlaPolicy);
      // Se esta política for marcada como default, remove o flag das outras
      if (dto.isDefault) {
        await repo.update({ tenantId, isDefault: true }, { isDefault: false });
      }
      const policy = repo.create({ ...dto, tenantId });
      return repo.save(policy);
    });
  }

  async update(tenantId: string, id: string, dto: UpdateSlaPolicyDto): Promise<SlaPolicy> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SlaPolicy);
      const policy = await repo.findOne({ where: { id, tenantId } });
      if (!policy) throw new NotFoundException('Política SLA não encontrada');

      // Se esta política vai virar default, remove o flag das outras
      if (dto.isDefault && !policy.isDefault) {
        await repo.update({ tenantId, isDefault: true }, { isDefault: false });
      }

      Object.assign(policy, dto);
      return repo.save(policy);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const policy = await this.policyRepo.findOne({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException('Política SLA não encontrada');
    await this.policyRepo.remove(policy);
  }

  // ──────────────────────────────────────────────
  // Lógica de negócio SLA
  // ──────────────────────────────────────────────

  /**
   * Retorna a política SLA mais adequada para um tenant + prioridade.
   * Ordem de preferência:
   *   1. Política com prioridade exata.
   *   2. Política marcada como isDefault.
   *   3. null (sem política configurada).
   */
  async findBestPolicy(
    tenantId: string,
    priority?: SlaPriority,
  ): Promise<SlaPolicy | null> {
    const policies = await this.policyRepo.find({ where: { tenantId } });
    if (!policies.length) return null;

    if (priority) {
      const exact = policies.find((p) => p.priority === priority);
      if (exact) return exact;
    }

    const defaultPolicy = policies.find((p) => p.isDefault);
    return defaultPolicy ?? null;
  }

  /**
   * Calcula os deadlines (primeira resposta e resolução) a partir de um instante base.
   */
  calcDeadlines(
    policy: SlaPolicy,
    from: Date = new Date(),
  ): { firstResponseDeadline: Date; resolutionDeadline: Date } {
    return {
      firstResponseDeadline: new Date(from.getTime() + policy.firstResponseMinutes * 60_000),
      resolutionDeadline:    new Date(from.getTime() + policy.resolutionMinutes    * 60_000),
    };
  }

  /**
   * Calcula o status SLA atual com base nos deadlines e timestamps reais.
   *
   * Regras:
   *  - breached: deadline de resolução já passou sem resolução OU deadline de 1ª resposta
   *              passou e ainda não houve resposta.
   *  - at_risk:  menos de AT_RISK_THRESHOLD do prazo de resolução restante.
   *  - within:   tudo OK.
   */
  /**
   * Calcula o status SLA atual ou histórico de uma conversa.
   *
   * O método serve tanto para:
   *  a) Status em tempo real (conversa aberta) → slaResolvedAt = null
   *  b) Status histórico ao fechar ou registrar resposta → slaResolvedAt/slaFirstResponseAt preenchidos
   *
   * Regras (em ordem de prioridade):
   *  1. breached — resolução ou primeira resposta aconteceu DEPOIS do prazo
   *  2. breached — prazo passou sem ação alguma
   *  3. at_risk  — menos de AT_RISK_THRESHOLD do prazo de resolução restante (só conversas abertas)
   *  4. within   — tudo OK
   */
  computeStatus(conv: {
    slaFirstResponseDeadline: Date | null;
    slaResolutionDeadline:    Date | null;
    slaFirstResponseAt:       Date | null;
    slaResolvedAt:            Date | null;
    createdAt:                Date;
  }): SlaStatus {
    const now = Date.now();

    const firstDeadline   = conv.slaFirstResponseDeadline?.getTime() ?? null;
    const resDeadline     = conv.slaResolutionDeadline?.getTime() ?? null;
    const firstResponseAt = conv.slaFirstResponseAt?.getTime() ?? null;
    const resolvedAt      = conv.slaResolvedAt?.getTime() ?? null;

    // Breach histórico: resolução ocorreu após o prazo
    if (resDeadline && resolvedAt && resolvedAt > resDeadline) return 'breached';

    // Breach histórico: primeira resposta ocorreu após o prazo
    if (firstDeadline && firstResponseAt && firstResponseAt > firstDeadline) return 'breached';

    // Breach atual: prazo de resolução estourou sem resolução
    if (resDeadline && !resolvedAt && now > resDeadline) return 'breached';

    // Breach atual: prazo de 1ª resposta estourou sem nenhuma resposta
    if (firstDeadline && !firstResponseAt && now > firstDeadline) return 'breached';

    // At risk: menos de AT_RISK_THRESHOLD do prazo de resolução restante (somente conv. abertas)
    if (resDeadline && !resolvedAt) {
      const createdAt   = conv.createdAt.getTime();
      const totalWindow = resDeadline - createdAt;
      const remaining   = resDeadline - now;
      if (totalWindow > 0 && remaining / totalWindow < AT_RISK_THRESHOLD) {
        return 'at_risk';
      }
    }

    return 'within';
  }

  /**
   * Aplica a política SLA a uma conversa recém-criada:
   * busca a melhor política, calcula deadlines e persiste.
   *
   * Operação não-crítica: erros são logados com contexto mas nunca propagados.
   * A guarda `AND sla_policy_id IS NULL` torna a operação idempotente.
   */
  async applyToConversation(
    tenantId: string,
    conversationId: string,
    priority?: SlaPriority,
  ): Promise<void> {
    try {
      const policy = await this.findBestPolicy(tenantId, priority);
      if (!policy) {
        this.logger.debug(
          `[SLA] applyToConversation: tenant=${tenantId} sem política configurada — conv=${conversationId} sem SLA`,
        );
        return;
      }

      const { firstResponseDeadline, resolutionDeadline } = this.calcDeadlines(policy);

      const result = await this.dataSource.query(
        `UPDATE conversations
            SET sla_policy_id              = $1,
                sla_first_response_deadline = $2,
                sla_resolution_deadline     = $3,
                sla_status                  = 'within'
          WHERE id = $4
            AND tenant_id = $5
            AND sla_policy_id IS NULL`,
        [policy.id, firstResponseDeadline, resolutionDeadline, conversationId, tenantId],
      );

      const affected = result?.[1] ?? 0;
      if (affected > 0) {
        this.logger.log(
          `[SLA] aplicado conv=${conversationId} policy=${policy.id} (${policy.name}) ` +
          `firstResponse=${firstResponseDeadline.toISOString()} resolution=${resolutionDeadline.toISOString()}`,
        );
      } else {
        this.logger.debug(
          `[SLA] applyToConversation: conv=${conversationId} já possui sla_policy_id — ignorado`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `[SLA] applyToConversation falhou — conv=${conversationId} tenant=${tenantId}: ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Reaplica a política SLA de uma conversa já existente.
   * Usado quando um ticket vinculado define/muda a prioridade que deve orientar o SLA da conversa.
   * Prazos são calculados a partir de conversation.created_at (âncora independente do ticket.createdAt).
   */
  async reapplyConversationPolicy(
    tenantId: string,
    conversationId: string,
    priority?: SlaPriority,
  ): Promise<void> {
    try {
      const rows: Array<{
        created_at: Date;
        sla_first_response_at: Date | null;
        sla_resolved_at: Date | null;
      }> = await this.dataSource.query(
        `SELECT created_at, sla_first_response_at, sla_resolved_at
           FROM conversations
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [conversationId, tenantId],
      );

      if (!rows.length) return;

      const conv = rows[0];
      const policy = await this.findBestPolicy(tenantId, priority);
      if (!policy) {
        await this.dataSource.query(
          `UPDATE conversations
              SET sla_policy_id = NULL,
                  sla_first_response_deadline = NULL,
                  sla_resolution_deadline = NULL,
                  sla_status = NULL
            WHERE id = $1 AND tenant_id = $2`,
          [conversationId, tenantId],
        );
        return;
      }

      const { firstResponseDeadline, resolutionDeadline } = this.calcDeadlines(policy, conv.created_at);
      const status = this.computeStatus({
        slaFirstResponseDeadline: firstResponseDeadline,
        slaResolutionDeadline: resolutionDeadline,
        slaFirstResponseAt: conv.sla_first_response_at,
        slaResolvedAt: conv.sla_resolved_at,
        createdAt: conv.created_at,
      });

      await this.dataSource.query(
        `UPDATE conversations
            SET sla_policy_id = $1,
                sla_first_response_deadline = $2,
                sla_resolution_deadline = $3,
                sla_status = $4
          WHERE id = $5 AND tenant_id = $6`,
        [policy.id, firstResponseDeadline, resolutionDeadline, status, conversationId, tenantId],
      );
    } catch (err: any) {
      this.logger.warn(
        `[SLA] reapplyConversationPolicy falhou — conv=${conversationId} tenant=${tenantId}: ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Registra o instante da primeira resposta do agente (se ainda não registrado)
   * e recalcula o sla_status.
   *
   * Só deve ser chamado para mensagens de atendentes humanos (authorType='user').
   * Mensagens automáticas (boas-vindas, chatbot, avaliação) não passam por aqui.
   *
   * Guards de idempotência:
   *  - SELECT filtra `sla_policy_id IS NOT NULL AND sla_first_response_at IS NULL`
   *  - UPDATE filtra `sla_first_response_at IS NULL` (proteção contra corrida)
   *
   * Operação não-crítica: erros são logados com contexto mas nunca propagados.
   */
  async recordFirstResponse(tenantId: string, conversationId: string): Promise<void> {
    try {
      // Busca a conversa — filtra apenas conversas com política e sem resposta registrada
      const rows: Array<{
        sla_first_response_deadline: Date | null;
        sla_resolution_deadline:     Date | null;
        sla_first_response_at:       Date | null;
        sla_resolved_at:             Date | null;
        created_at:                  Date;
      }> = await this.dataSource.query(
        `SELECT sla_first_response_deadline,
                sla_resolution_deadline,
                sla_first_response_at,
                sla_resolved_at,
                created_at
           FROM conversations
          WHERE id = $1 AND tenant_id = $2
            AND sla_policy_id IS NOT NULL
            AND sla_first_response_at IS NULL`,
        [conversationId, tenantId],
      );

      if (!rows.length) {
        // Já registrado ou sem política — nenhuma ação necessária
        return;
      }

      const now = new Date();
      const conv = rows[0];

      if (!conv.sla_first_response_deadline || !conv.sla_resolution_deadline) {
        this.logger.warn(
          `[SLA] recordFirstResponse: conv=${conversationId} tem sla_policy_id mas sem deadlines — ignorado`,
        );
        return;
      }

      const status = this.computeStatus({
        slaFirstResponseDeadline: conv.sla_first_response_deadline,
        slaResolutionDeadline:    conv.sla_resolution_deadline,
        slaFirstResponseAt:       now,   // simula como se já tivesse respondido agora
        slaResolvedAt:            conv.sla_resolved_at,
        createdAt:                conv.created_at,
      });

      await this.dataSource.query(
        `UPDATE conversations
            SET sla_first_response_at = $1,
                sla_status            = $2
          WHERE id = $3
            AND tenant_id = $4
            AND sla_first_response_at IS NULL`,
        [now, status, conversationId, tenantId],
      );

      const withinSla = now <= conv.sla_first_response_deadline;
      this.logger.log(
        `[SLA] primeira resposta registrada conv=${conversationId} ` +
        `status=${status} dentro_prazo=${withinSla} at=${now.toISOString()}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[SLA] recordFirstResponse falhou — conv=${conversationId} tenant=${tenantId}: ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Calcula o status SLA final no momento de resolução da conversa.
   * Usado pelo conversations.service apenas como referência — o status é aplicado
   * diretamente a partir dos dados já em memória (convLocked) dentro da transação.
   * Mantido para uso externo (relatórios, testes).
   */
  async computeResolutionStatus(
    tenantId: string,
    conversationId: string,
    resolvedAt: Date,
  ): Promise<SlaStatus | null> {
    try {
      const rows: Array<{
        sla_first_response_deadline: Date | null;
        sla_resolution_deadline:     Date | null;
        sla_first_response_at:       Date | null;
        created_at:                  Date;
      }> = await this.dataSource.query(
        `SELECT sla_first_response_deadline,
                sla_resolution_deadline,
                sla_first_response_at,
                created_at
           FROM conversations
          WHERE id = $1 AND tenant_id = $2
            AND sla_policy_id IS NOT NULL`,
        [conversationId, tenantId],
      );
      if (!rows.length) return null;

      const conv = rows[0];
      return this.computeStatus({
        slaFirstResponseDeadline: conv.sla_first_response_deadline,
        slaResolutionDeadline:    conv.sla_resolution_deadline,
        slaFirstResponseAt:       conv.sla_first_response_at,
        slaResolvedAt:            resolvedAt,
        createdAt:                conv.created_at,
      });
    } catch (err: any) {
      this.logger.warn(
        `[SLA] computeResolutionStatus falhou — conv=${conversationId} tenant=${tenantId}: ${err?.message}`,
        err?.stack,
      );
      return null;
    }
  }
}
