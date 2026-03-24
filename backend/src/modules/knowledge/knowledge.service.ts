import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KbCategory, KbArticle } from './entities/knowledge.entity';

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KbCategory) private readonly catRepo: Repository<KbCategory>,
    @InjectRepository(KbArticle) private readonly artRepo: Repository<KbArticle>,
  ) {}

  private async getArticleOrFail(tenantId: string, id: string): Promise<KbArticle> {
    const article = await this.artRepo.findOne({ where: { id, tenantId } });

    if (!article) {
      throw new NotFoundException('Artigo não encontrado');
    }

    return article;
  }

  private async assertCategoryBelongsToTenant(tenantId: string, categoryId?: string | null) {
    if (!categoryId) return;

    const category = await this.catRepo.findOne({
      where: { id: categoryId, tenantId },
    });

    if (!category) {
      throw new BadRequestException('Categoria inválida para este tenant');
    }
  }

  async createCategory(tenantId: string, dto: Partial<KbCategory>) {
    return this.catRepo.save(
      this.catRepo.create({
        ...dto,
        tenantId,
      }),
    );
  }

  async getCategories(tenantId: string) {
    return this.catRepo.find({
      where: { tenantId },
      order: { sortOrder: 'ASC' },
    });
  }

  async createArticle(tenantId: string, authorId: string, dto: Partial<KbArticle>) {
    await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);

    const article = this.artRepo.create({
      ...dto,
      tenantId,
      authorId,
    });

    return this.artRepo.save(article);
  }

  async findArticles(tenantId: string, filters: any = {}) {
    const qb = this.artRepo.createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status != :archived', { archived: 'archived' })
      .orderBy('a.created_at', 'DESC');

    if (filters.search) {
      qb.andWhere('(a.title ILIKE :s OR a.content ILIKE :s)', {
        s: `%${filters.search}%`,
      });
    }

    if (filters.categoryId) {
      qb.andWhere('a.category_id = :c', { c: filters.categoryId });
    }

    if (filters.visibility) {
      qb.andWhere('a.visibility = :v', { v: filters.visibility });
    }

    return qb.getMany();
  }

  async findOne(tenantId: string, id: string) {
    const article = await this.getArticleOrFail(tenantId, id);

    await this.artRepo.increment(
      { id: article.id, tenantId },
      'views',
      1,
    );

    return article;
  }

  async update(tenantId: string, id: string, dto: Partial<KbArticle>) {
    const article = await this.getArticleOrFail(tenantId, id);

    await this.assertCategoryBelongsToTenant(tenantId, dto.categoryId);

    Object.assign(article, dto);

    return this.artRepo.save(article);
  }

  async delete(tenantId: string, id: string) {
    await this.getArticleOrFail(tenantId, id);

    await this.artRepo.update(
      { id, tenantId },
      { status: 'archived' },
    );

    return { message: 'Artigo arquivado' };
  }

  async search(tenantId: string, query: string) {
    return this.artRepo.createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status = :published', { published: 'published' })
      .andWhere('(a.title ILIKE :q OR a.content ILIKE :q)', {
        q: `%${query}%`,
      })
      .orderBy('a.views', 'DESC')
      .take(10)
      .getMany();
  }
}
