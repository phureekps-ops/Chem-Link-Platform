import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleType } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../modules/auth/strategies/jwt.strategy';

// Two layers of checking, per Section 14.1 / 14.3 of the design doc:
//  1. The authenticated user's own `allowedRoles` must include the
//     required role (a sales rep might only be allowed BUYER, not SELLER).
//  2. The user's Company must actually have that CompanyRole activated.
// Role-restricted, higher-stakes actions (listing products, sending RFQs)
// should additionally check verificationStatus === VERIFIED at the
// service layer once those modules exist (Step 3+).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    const hasUserPermission = requiredRoles.some((role) => user.allowedRoles.includes(role));
    if (!hasUserPermission) {
      throw new ForbiddenException(
        `Your account is not permitted to act as: ${requiredRoles.join(', ')}.`,
      );
    }

    const activatedRole = await this.prisma.companyRole.findFirst({
      where: {
        companyId: user.companyId,
        roleType: { in: requiredRoles },
      },
    });

    if (!activatedRole) {
      throw new ForbiddenException(
        `Your company has not activated the required role: ${requiredRoles.join(', ')}.`,
      );
    }

    return true;
  }
}
