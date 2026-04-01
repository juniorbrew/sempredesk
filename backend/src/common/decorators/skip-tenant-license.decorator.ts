import { SetMetadata } from '@nestjs/common';

/** Rotas sem JWT (ex.: health) ou que não devem validar licença do tenant */
export const SKIP_TENANT_LICENSE_KEY = 'skipTenantLicenseCheck';
export const SkipTenantLicenseCheck = () => SetMetadata(SKIP_TENANT_LICENSE_KEY, true);
