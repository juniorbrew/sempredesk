import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { KnowledgeService } from './knowledge.service';

@Controller('public/knowledge')
export class PublicKnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  getPublicArticles(@Query('tenantId') tenantId: string, @Query('search') search?: string) {
    if (!tenantId) return [];
    if (search) return this.knowledgeService.search(tenantId, search);
    return this.knowledgeService.findArticles(tenantId, { visibility: 'public', status: 'published' });
  }

  @Get('categories')
  getPublicCategories(@Query('tenantId') tenantId: string) {
    if (!tenantId) return [];
    return this.knowledgeService.getCategories(tenantId);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('search')
  @RequirePermission('knowledge.view')
  search(@TenantId() tenantId: string, @Query('q') q: string) {
    return this.knowledgeService.search(tenantId, q || '');
  }

  @Get('categories')
  @RequirePermission('knowledge.view')
  getCategories(@TenantId() tenantId: string) {
    return this.knowledgeService.getCategories(tenantId);
  }

  @Post('categories')
  @RequirePermission('knowledge.edit')
  createCategory(@TenantId() tenantId: string, @Body() dto: any) {
    return this.knowledgeService.createCategory(tenantId, dto);
  }

  @Get()
  @RequirePermission('knowledge.view')
  findAll(@TenantId() tenantId: string, @Query() filters: any) {
    return this.knowledgeService.findArticles(tenantId, filters);
  }

  @Post()
  @RequirePermission('knowledge.edit')
  create(@Request() req, @Body() dto: any) {
    return this.knowledgeService.createArticle(req.tenantId, req.user.id, dto);
  }

  @Get(':id')
  @RequirePermission('knowledge.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.knowledgeService.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('knowledge.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any) {
    return this.knowledgeService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermission('knowledge.edit')
  delete(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.knowledgeService.delete(tenantId, id);
  }
}
