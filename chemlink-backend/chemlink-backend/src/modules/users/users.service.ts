import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { InviteUserDto } from './dto/invite-user.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async inviteToCompany(companyId: string, dto: InviteUserDto) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('This email is already in use.');
    }

    // A teammate can only be scoped to roles the company itself has
    // activated (Section 14.1) — prevents granting SELLER access on a
    // company that never verified as a seller.
    const activatedRoles = await this.prisma.companyRole.findMany({
      where: { companyId },
    });
    const activatedRoleTypes = activatedRoles.map((r: { roleType: RoleType }) => r.roleType);
    const invalidRoles = dto.allowedRoles.filter((r: RoleType) => !activatedRoleTypes.includes(r));
    if (invalidRoles.length > 0) {
      throw new BadRequestException(
        `Company has not activated these roles yet: ${invalidRoles.join(', ')}.`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.temporaryPassword, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        position: dto.position,
        allowedRoles: dto.allowedRoles,
        isCompanyAdmin: false,
      },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      allowedRoles: user.allowedRoles,
    };
  }

  async listByCompany(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        fullName: true,
        position: true,
        allowedRoles: true,
        isCompanyAdmin: true,
        isActive: true,
        createdAt: true,
      },
    });
    return users;
  }
}
