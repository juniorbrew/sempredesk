import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KbCategory, KbArticle } from './entities/knowledge.entity';
import { PermissionsModule } from '../permissions/permissions.module';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController, PublicKnowledgeController } from './knowledge.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KbCategory, KbArticle]), PermissionsModule],
  providers: [KnowledgeService],
  controllers: [KnowledgeController, PublicKnowledgeController],
})
export class KnowledgeModule {}
