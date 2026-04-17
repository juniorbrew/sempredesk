import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Request, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantsOnboardService } from './tenants-onboard.service';
import { CreateTenantOnboardDto } from './dto/create-tenant-onboard.dto';
import { normalizeCnpj, validateCnpj } from '../../common/utils/cnpj.utils';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly onboardSvc: TenantsOnboardService) {}

  private actorFromReq(req: any) {
    return {
      userId: req.user.id,
      userEmail: req.user.email,
      userType: 'master_user' as const,
    };
  }

  /**
   * Consulta dados cadastrais de CNPJ via BrasilAPI (proxy seguro).
   * Fonte: https://brasilapi.com.br/api/cnpj/v1/{cnpj} — gratuita, sem chave de API.
   * Retorna payload normalizado; nunca bloqueia o cadastro se o serviço estiver indisponível
   * (o caller deve tratar o 422 e permitir preenchimento manual).
   */
  @Get('cnpj-lookup/:cnpj')
  @Roles('super_admin')
  async cnpjLookup(@Param('cnpj') cnpj: string) {
    const raw = normalizeCnpj(cnpj);
    if (!raw || !validateCnpj(raw)) {
      throw new BadRequestException('CNPJ inválido');
    }
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${raw}`, {
        headers: { 'User-Agent': 'SempreDesk/1.0 (+https://sempredesk.com.br)' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) throw new Error(`BrasilAPI HTTP ${resp.status}`);
      const d: any = await resp.json();
      return {
        cnpj: raw,
        razaoSocial: (d.razao_social ?? '').trim(),
        nomeFantasia: (d.nome_fantasia ?? '').trim(),
        logradouro:   (d.logradouro   ?? '').trim(),
        numero:       (d.numero       ?? '').trim(),
        complemento:  (d.complemento  ?? '').trim(),
        bairro:       (d.bairro       ?? '').trim(),
        cidade:       (d.municipio    ?? '').trim(),
        uf:           (d.uf           ?? '').trim().toUpperCase(),
        cep:          (d.cep          ?? '').replace(/\D/g, ''),
        telefone:     (d.ddd_telefone_1 ?? '').replace(/\D/g, ''),
        email:        (d.email        ?? '').trim().toLowerCase(),
      };
    } catch {
      throw new UnprocessableEntityException('Não foi possível consultar os dados do CNPJ. Preencha manualmente.');
    }
  }

  @Get()
  @Roles('super_admin')
  async list(@Query('search') search?: string, @Query('status') status?: string) {
    return this.onboardSvc.list(search, status);
  }

  @Get(':id')
  @Roles('super_admin')
  async getOne(@Param('id') id: string) {
    return this.onboardSvc.getById(id);
  }

  @Post()
  @Roles('super_admin')
  async create(@Body() dto: CreateTenantOnboardDto, @Request() req: any) {
    return this.onboardSvc.onboard(dto, this.actorFromReq(req));
  }

  @Patch(':id/suspend')
  @Roles('super_admin')
  async suspend(@Param('id') id: string, @Request() req: any) {
    return this.onboardSvc.setStatus(id, 'suspended', this.actorFromReq(req));
  }

  @Patch(':id/reactivate')
  @Roles('super_admin')
  async reactivate(@Param('id') id: string, @Request() req: any) {
    return this.onboardSvc.setStatus(id, 'active', this.actorFromReq(req));
  }

  @Post(':id/renew-license')
  @Roles('super_admin')
  async renew(
    @Param('id') id: string,
    @Body() body: { periodDays?: number },
    @Request() req: any,
  ) {
    const periodDays = Number(body?.periodDays || 30);
    return this.onboardSvc.renew(id, periodDays, this.actorFromReq(req));
  }
}

