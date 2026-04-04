import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PermissionsController } from './permissions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Permission, Role, RolePermission])],
  providers: [PermissionsService, PermissionsGuard],
  controllers: [PermissionsController],
  exports: [PermissionsService, PermissionsGuard],
})
export class PermissionsModule implements OnModuleInit {
  private readonly logger = new Logger(PermissionsModule.name);

  constructor(private readonly permissionsService: PermissionsService) {}

  async onModuleInit() {
    const maxAttempts = 12;
    const delayMs = 1500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.permissionsService.seed();
        if (attempt > 1) {
          this.logger.log(`Seed de permissões concluído na tentativa ${attempt}.`);
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt >= maxAttempts) {
          this.logger.error(
            `Seed de permissões falhou após ${maxAttempts} tentativas. A API pode responder 403 até corrigir o Postgres e reiniciar o backend. Último erro: ${msg}`,
          );
          return;
        }
        this.logger.warn(
          `Seed de permissões tentativa ${attempt}/${maxAttempts} falhou; a aguardar ${delayMs}ms… (${msg})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
}
