import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige uma ou mais permissões para acessar o endpoint.
 * O usuário precisa ter pelo menos uma das permissões listadas.
 * super_admin sempre passa.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
