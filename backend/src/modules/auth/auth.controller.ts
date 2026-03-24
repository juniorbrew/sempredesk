import {
  Controller, Post, Get, Put, Body, Param,
  UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AttendanceService } from '../attendance/attendance.service';
import { PermissionsService } from '../permissions/permissions.service';
import { LoginDto, RefreshTokenDto, CreateUserDto, UpdateUserDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles, Public } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly attendance: AttendanceService,
    private readonly permissionsService: PermissionsService,
  ) {
    this.auth.setAttendanceService(this.attendance);
    this.auth.setPermissionsService(this.permissionsService);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Request() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip;
    return this.auth.login(dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Request() req: any) {
    return this.auth.logout(req.user.tenantId, req.user.id);
  }

  @Public()
  @Post('portal-login')
  portalLogin(@Body() dto: any) {
    return this.auth.portalLogin(dto.email, dto.password, dto.tenantId, dto.tenantSlug);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) { return this.auth.refresh(dto.refreshToken); }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  async me(@Request() req: any) {
    const perms = await this.permissionsService.getPermissionsByRole(req.user?.role);
    return { ...req.user, permissions: perms };
  }

  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  @ApiBearerAuth()
  async getPermissions(@Request() req: any) {
    return this.permissionsService.getPermissionsByRole(req.user?.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('admin', 'super_admin')
  @RequirePermission('agent.create')
  @Post('users')
  @ApiBearerAuth()
  createUser(@Request() req: any, @Body() dto: CreateUserDto) {
    return this.auth.createUser(req.user.tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('admin', 'manager', 'super_admin')
  @RequirePermission('agent.view')
  @Get('users')
  @ApiBearerAuth()
  listUsers(@Request() req: any) { return this.auth.findUsers(req.user.tenantId); }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles('admin', 'super_admin')
  @RequirePermission('agent.edit')
  @Put('users/:id')
  @ApiBearerAuth()
  updateUser(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(req.user.tenantId, id, dto as any);
  }
}
