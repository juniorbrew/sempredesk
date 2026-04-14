import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgentPausesService } from './agent-pauses.service';
import { CreatePauseReasonDto, UpdatePauseReasonDto } from './dto/create-pause-reason.dto';
import { RequestPauseDto } from './dto/request-pause.dto';
import { ReviewPauseDto } from './dto/review-pause.dto';

const REVIEWER_ROLES = ['admin', 'super_admin', 'manager'];

@UseGuards(JwtAuthGuard)
@Controller('agent-pauses')
export class AgentPausesController {
  constructor(private readonly svc: AgentPausesService) {}

  // ─── Motivos de pausa ─────────────────────────────────────────────────────────

  /** Lista motivos ativos — disponível para todos (agente usa no modal) */
  @Get('reasons')
  listReasons(@Request() req: any) {
    return this.svc.listReasons(req.tenantId);
  }

  /** Lista todos os motivos (ativos + inativos) — supervisor/admin */
  @Get('reasons/all')
  listAllReasons(@Request() req: any) {
    this.requireReviewer(req);
    return this.svc.listAllReasons(req.tenantId);
  }

  /** Cria motivo personalizado — supervisor/admin */
  @Post('reasons')
  createReason(@Request() req: any, @Body() dto: CreatePauseReasonDto) {
    this.requireReviewer(req);
    return this.svc.createReason(req.tenantId, dto);
  }

  /** Atualiza motivo — supervisor/admin */
  @Patch('reasons/:id')
  updateReason(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePauseReasonDto,
  ) {
    this.requireReviewer(req);
    return this.svc.updateReason(req.tenantId, id, dto);
  }

  // ─── Solicitações ────────────────────────────────────────────────────────────

  /**
   * Agente solicita pausa.
   * Se o motivo não exige aprovação, a pausa é ativada imediatamente.
   */
  @Post('request')
  requestPause(@Request() req: any, @Body() dto: RequestPauseDto) {
    const { id, name } = req.user;
    return this.svc.requestPause(req.tenantId, id, name, dto);
  }

  /** Agente cancela sua solicitação pendente */
  @Post('cancel')
  cancelRequest(@Request() req: any) {
    return this.svc.cancelRequest(req.tenantId, req.user.id);
  }

  /** Retorna o estado atual de pausa do próprio agente */
  @Get('my')
  getMyPause(@Request() req: any) {
    return this.svc.getMyPauseState(req.tenantId, req.user.id);
  }

  /** Encerra a própria pausa ativa */
  @Post('end')
  endMyPause(@Request() req: any) {
    return this.svc.endPause(req.tenantId, req.user.id, req.user.role);
  }

  // ─── Painel supervisor/admin ─────────────────────────────────────────────────

  /** Lista solicitações pendentes — supervisor/admin */
  @Get('pending')
  getPending(@Request() req: any) {
    this.requireReviewer(req);
    return this.svc.getPendingRequests(req.tenantId);
  }

  /** Aprova uma solicitação — supervisor/admin */
  @Post(':id/approve')
  approve(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewPauseDto,
  ) {
    this.requireReviewer(req);
    const { id: reviewerId, name: reviewerName } = req.user;
    return this.svc.approvePause(req.tenantId, id, reviewerId, reviewerName, dto);
  }

  /** Rejeita uma solicitação — supervisor/admin */
  @Post(':id/reject')
  reject(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ReviewPauseDto,
  ) {
    this.requireReviewer(req);
    const { id: reviewerId, name: reviewerName } = req.user;
    return this.svc.rejectPause(req.tenantId, id, reviewerId, reviewerName, dto);
  }

  /** Supervisor encerra pausa de qualquer agente */
  @Post('end/:agentId')
  endAgentPause(@Request() req: any, @Param('agentId') agentId: string) {
    this.requireReviewer(req);
    return this.svc.endPauseForAgent(req.tenantId, agentId, req.user.id);
  }

  /** Histórico de pausas */
  @Get('history')
  getHistory(@Request() req: any, @Query() query: any) {
    // Agente vê apenas o próprio histórico; supervisor/admin vê todos
    const isReviewer = REVIEWER_ROLES.includes(req.user.role);
    const agentId = isReviewer ? (query.agentId ?? undefined) : req.user.id;
    return this.svc.getHistory(req.tenantId, {
      agentId,
      page: query.page ? Number(query.page) : 1,
      perPage: query.perPage ? Number(query.perPage) : 30,
    });
  }

  // ─── Guard helper ────────────────────────────────────────────────────────────

  private requireReviewer(req: any) {
    if (!REVIEWER_ROLES.includes(req.user?.role)) {
      throw new ForbiddenException('Apenas supervisores e administradores podem executar esta ação');
    }
  }
}
