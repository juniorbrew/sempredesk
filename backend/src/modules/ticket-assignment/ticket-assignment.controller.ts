import {
  Controller, Get, Put, Patch, Post, Param, Body, Request,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { IsArray, IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { TicketAssignmentService, AgentPresenceStatus } from './ticket-assignment.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

const VALID_STATUSES: AgentPresenceStatus[] = ['online', 'away', 'busy', 'offline'];

class SetDepartmentsDto {
  @IsArray()
  @IsString({ each: true })
  departments: string[] = [];
}

class UpdateStatusDto {
  @IsIn(VALID_STATUSES)
  status!: AgentPresenceStatus;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Endpoints de presença de agentes e gestão de departamentos.
 *
 * Presença via WebSocket (principal): eventos join-tenant / disconnect no RealtimeGateway.
 * Presença via HTTP (fallback):
 *   PATCH /agents/me/status   — atualiza status manualmente
 *   POST  /agents/me/heartbeat — confirma que agente está ativo (a cada ≤ 5 min)
 */
@Controller('agents')
@UseGuards(JwtAuthGuard)
export class TicketAssignmentController {
  constructor(private readonly assignmentService: TicketAssignmentService) {}

  // ─── Endpoints de presença (HTTP fallback) ────────────────────────────────

  /**
   * PATCH /api/v1/agents/me/status
   * Body: { "status": "online" | "away" | "busy" | "offline" }
   *
   * Atualiza presença no DB + Redis e dispara rebalance/redistribute se necessário.
   */
  @Patch('me/status')
  @HttpCode(HttpStatus.OK)
  updateMyStatus(
    @TenantId() tenantId: string,
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateStatusDto,
  ) {
    return this.assignmentService.updatePresenceStatus(tenantId, req.user.id, dto.status);
  }

  /**
   * POST /api/v1/agents/me/heartbeat
   *
   * Confirma que o agente está ativo. Atualiza last_seen_at.
   * Se estava offline, volta automaticamente para online e rebalanceia tickets.
   * Deve ser chamado a cada ≤ 5 minutos para manter presença ativa via HTTP.
   */
  @Post('me/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @TenantId() tenantId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.assignmentService.heartbeatFromHttp(tenantId, req.user.id);
  }

  // ─── Departamentos ────────────────────────────────────────────────────────

  /** GET /api/v1/agents/me/departments — departamentos do próprio agente */
  @Get('me/departments')
  getMyDepartments(
    @TenantId() tenantId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.assignmentService.getAgentDepartments(tenantId, req.user.id);
  }

  /** GET /api/v1/agents/:userId/departments */
  @Get(':userId/departments')
  getDepartments(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.assignmentService.getAgentDepartments(tenantId, userId);
  }

  /** PUT /api/v1/agents/:userId/departments */
  @Put(':userId/departments')
  @HttpCode(HttpStatus.OK)
  setDepartments(
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
    @Body() dto: SetDepartmentsDto,
  ) {
    return this.assignmentService.setAgentDepartments(
      tenantId,
      userId,
      Array.isArray(dto.departments) ? dto.departments : [],
    );
  }

  /** GET /api/v1/agents/departments/:department — agentes de um departamento com status */
  @Get('departments/:department')
  getDepartmentAgents(
    @TenantId() tenantId: string,
    @Param('department') department: string,
  ) {
    return this.assignmentService.getDepartmentAgents(tenantId, department);
  }
}
