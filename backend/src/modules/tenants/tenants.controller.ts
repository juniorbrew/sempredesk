import { Controller, Get, Post, Put, Body, Param, Req, UseGuards, Request, NotFoundException } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly svc: TenantsService,
    private readonly cfg: ConfigService,
  ) {}

  /**
   * Endpoint PÚBLICO — resolve tenant pelo subdomínio (slug).
   * Usado pelo frontend antes do login para exibir o nome da empresa.
   * Retorna apenas dados não-sensíveis: id, name, slug.
   */
  @Get('by-subdomain/:subdomain')
  async bySubdomain(@Param('subdomain') subdomain: string) {
    try {
      const t = await this.svc.findBySlug(subdomain.toLowerCase().trim());
      return { id: t.id, name: t.name, slug: t.slug };
    } catch {
      throw new NotFoundException('Subdomínio não encontrado');
    }
  }

  /**
   * Endpoint PÚBLICO — resolve tenant a partir do Host header da requisição.
   * Suporta:
   *   - domínio customizado: empresa.com.br
   *   - subdomínio padrão: techcorp.sempredesk.com.br
   *
   * Usado pelo frontend quando não há ?tenant= na URL mas o hostname já define
   * o tenant (acesso direto via subdomínio).
   */
  @Get('by-host')
  async byHost(@Req() req: ExpressRequest) {
    // Nginx repassa o host original via X-Forwarded-Host
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const baseDomain = this.cfg.get<string>('BASE_DOMAIN', 'sempredesk.com.br');
    const t = await this.svc.findByHost(host, baseDomain);
    if (!t) throw new NotFoundException('Host não corresponde a nenhum tenant');
    return { id: t.id, name: t.name, slug: t.slug, customDomain: t.customDomain };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  @Roles('super_admin')
  findAll() { return this.svc.findAll(); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @Roles('super_admin')
  create(@Body() body: any) { return this.svc.create(body); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('me')
  @Roles('super_admin', 'admin', 'manager', 'technician', 'viewer')
  me(@Request() req: any) { return this.svc.findOne(req.tenantId); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  @Roles('super_admin')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  @Roles('super_admin', 'admin')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
}
