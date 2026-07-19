import { SetMetadata } from '@nestjs/common';
import { RoleType } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Marks an endpoint as requiring the caller to hold at least one of the
// given roles (BUYER / SELLER) — enforced by RolesGuard.
// Section 14.1: a user's allowedRoles must be a subset of their company's
// activated CompanyRole types, and the specific CompanyRole must be VERIFIED
// for role-restricted actions (e.g. sending an RFQ, listing a product).
export const Roles = (...roles: RoleType[]) => SetMetadata(ROLES_KEY, roles);
