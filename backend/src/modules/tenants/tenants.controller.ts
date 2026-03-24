import { Controller, Get, Post, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly svc: TenantsService) {}

  @Get()
  @Roles('super_admin')
  findAll() { return this.svc.findAll(); }

  @Post()
  @Roles('super_admin')
  create(@Body() body: any) { return this.svc.create(body); }

  @Get('me')
  @Roles('super_admin', 'admin', 'manager', 'technician', 'viewer')
  me(@Request() req: any) { return this.svc.findOne(req.tenantId); }

  @Get(':id')
  @Roles('super_admin')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Put(':id')
  @Roles('super_admin', 'admin')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
}
