import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function buildContext(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const prismaMock = { companyRole: { findFirst: jest.fn() } };

  const makeGuard = (requiredRoles: RoleType[] | undefined) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector, prismaMock as any);
  };

  beforeEach(() => jest.clearAllMocks());

  it('allows the request through when no roles are required', async () => {
    const guard = makeGuard(undefined);
    const ctx = buildContext({ allowedRoles: [] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a user whose own allowedRoles do not include the required role', async () => {
    const guard = makeGuard([RoleType.SELLER]);
    const ctx = buildContext({ companyId: 'co-1', allowedRoles: [RoleType.BUYER] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the user has the role but the company has not activated it', async () => {
    prismaMock.companyRole.findFirst.mockResolvedValueOnce(null);
    const guard = makeGuard([RoleType.SELLER]);
    const ctx = buildContext({ companyId: 'co-1', allowedRoles: [RoleType.SELLER] });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows when both the user and the company have the required role', async () => {
    prismaMock.companyRole.findFirst.mockResolvedValueOnce({ id: 'role-1' });
    const guard = makeGuard([RoleType.SELLER]);
    const ctx = buildContext({ companyId: 'co-1', allowedRoles: [RoleType.SELLER] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
