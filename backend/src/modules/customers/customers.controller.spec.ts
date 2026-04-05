import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController', () => {
  describe('getContacts (Etapa 7 — includeArchived)', () => {
    it('deve repassar includeArchived=false ao service', async () => {
      const svc = { findContacts: jest.fn().mockResolvedValue([]) };
      const controller = new CustomersController(svc as unknown as CustomersService);
      await controller.getContacts('tenant-1', 'client-1', false);
      expect(svc.findContacts).toHaveBeenCalledWith('tenant-1', 'client-1', false);
    });

    it('deve repassar includeArchived=true ao service', async () => {
      const svc = { findContacts: jest.fn().mockResolvedValue([]) };
      const controller = new CustomersController(svc as unknown as CustomersService);
      await controller.getContacts('tenant-1', 'client-1', true);
      expect(svc.findContacts).toHaveBeenCalledWith('tenant-1', 'client-1', true);
    });
  });
});
