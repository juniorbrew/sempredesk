import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe,
  Post, Put, Query, UseGuards, Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { TasksService } from './tasks.service';
import {
  CreateTaskDto, UpdateTaskDto, FilterTaskDto, AddTaskCommentDto,
} from './dto/task.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Post()
  @RequirePermission('tasks.create')
  create(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Request() req: any,
    @Body() dto: CreateTaskDto,
  ) {
    const authorName: string = req.user?.name ?? req.user?.email ?? 'Sistema';
    return this.service.create(tenantId, userId, authorName, dto);
  }

  @Get()
  @RequirePermission('tasks.view')
  findAll(
    @TenantId() tenantId: string,
    @Query() filters: FilterTaskDto,
  ) {
    return this.service.findAll(tenantId, filters);
  }

  @Get(':id')
  @RequirePermission('tasks.view')
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('tasks.edit')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateTaskDto,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub;
    const authorName: string = req.user?.name ?? req.user?.email ?? 'Sistema';
    return this.service.update(tenantId, id, userId, authorName, dto);
  }

  @Put(':id/complete')
  @RequirePermission('tasks.edit')
  complete(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub;
    const authorName: string = req.user?.name ?? req.user?.email ?? 'Sistema';
    return this.service.complete(tenantId, id, userId, authorName);
  }

  @Put(':id/cancel')
  @RequirePermission('tasks.edit')
  cancel(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub;
    const authorName: string = req.user?.name ?? req.user?.email ?? 'Sistema';
    return this.service.cancel(tenantId, id, userId, authorName);
  }

  @Delete(':id')
  @RequirePermission('tasks.delete')
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/comments')
  @RequirePermission('tasks.edit')
  addComment(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: AddTaskCommentDto,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub;
    const authorName: string = req.user?.name ?? req.user?.email ?? 'Sistema';
    return this.service.addComment(tenantId, id, userId, authorName, dto);
  }

  /** Tarefas vinculadas a um ticket específico */
  @Get('by-ticket/:ticketId')
  @RequirePermission('tasks.view')
  findByTicket(
    @TenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.service.findByTicket(tenantId, ticketId);
  }
}
