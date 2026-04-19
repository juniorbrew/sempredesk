import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { CalendarService } from './calendar.service';
import {
  CreateCalendarEventDto, UpdateCalendarEventDto,
  FilterCalendarEventDto, AddParticipantDto,
} from './dto/calendar-event.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Post()
  @RequirePermission('agenda.create')
  create(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.service.create(tenantId, userId, dto);
  }

  @Get()
  @RequirePermission('agenda.view')
  findAll(
    @TenantId() tenantId: string,
    @Query() filters: FilterCalendarEventDto,
  ) {
    return this.service.findAll(tenantId, filters);
  }

  @Get(':id')
  @RequirePermission('agenda.view')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('agenda.edit')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Put(':id/cancel')
  @RequirePermission('agenda.edit')
  cancel(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(tenantId, id);
  }

  @Delete(':id')
  @RequirePermission('agenda.delete')
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/participants')
  @RequirePermission('agenda.edit')
  addParticipant(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.service.addParticipant(tenantId, id, dto);
  }

  @Delete(':id/participants/:participantId')
  @RequirePermission('agenda.edit')
  removeParticipant(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ) {
    return this.service.removeParticipant(tenantId, id, participantId);
  }

  /** Eventos vinculados a um ticket específico */
  @Get('by-ticket/:ticketId')
  @RequirePermission('agenda.view')
  findByTicket(
    @TenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.service.findByTicket(tenantId, ticketId);
  }
}
