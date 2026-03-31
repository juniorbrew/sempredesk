import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantsOnboardService } from './tenants-onboard.service';
import { CreateTenantOnboardDto } from './dto/create-tenant-onboard.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly onboardSvc: TenantsOnboardService) {}

  @Post()
  @Roles('super_admin')
  async create(@Body() dto: CreateTenantOnboardDto, @Request() req: any) {
    const actor = {
      userId: req.user.id,
      userEmail: req.user.email,
      userType: 'master_user' as const,
    };
    return this.onboardSvc.onboard(dto, actor);
  }
}

