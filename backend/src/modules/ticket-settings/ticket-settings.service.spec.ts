import { BadRequestException } from '@nestjs/common';
import { TicketSettingsService } from './ticket-settings.service';
import { TicketSettingType } from './entities/ticket-setting.entity';

describe('TicketSettingsService — defaultPriorityId', () => {
  const tenantId = 't1';

  function makeService(priorityFindResult: any) {
    const repo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
      find: jest.fn().mockResolvedValue([]),
    };
    const priorityRepo = {
      findOne: jest.fn().mockResolvedValue(priorityFindResult),
    };
    const service = new TicketSettingsService(repo as any, priorityRepo as any);
    return { service, repo, priorityRepo };
  }

  it('create com defaultPriorityId em categoria rejeita', async () => {
    const { service, repo } = makeService({ id: 'p1', tenantId });
    repo.findOne
      .mockResolvedValueOnce({
        id: 'dept-1',
        type: TicketSettingType.DEPARTMENT,
        tenantId,
        active: true,
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.create(tenantId, {
        type: TicketSettingType.CATEGORY,
        name: 'Cat',
        parentId: 'dept-1',
        defaultPriorityId: '550e8400-e29b-41d4-a716-446655440001',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create departamento com prioridade inexistente rejeita', async () => {
    const { service, repo, priorityRepo } = makeService(null);
    repo.findOne.mockResolvedValueOnce(null);
    priorityRepo.findOne.mockResolvedValue(null);

    await expect(
      service.create(tenantId, {
        type: TicketSettingType.DEPARTMENT,
        name: 'Dept',
        defaultPriorityId: '550e8400-e29b-41d4-a716-446655440099',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
