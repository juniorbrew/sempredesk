import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantsOnboardService } from './tenants-onboard.service';
import { CreateTenantOnboardDto } from './dto/create-tenant-onboard.dto';

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

