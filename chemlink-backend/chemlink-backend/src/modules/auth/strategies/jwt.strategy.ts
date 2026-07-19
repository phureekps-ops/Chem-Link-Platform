import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RoleType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  companyId: string;
  allowedRoles: RoleType[];
}

export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  email: string;
  fullName: string;
  isCompanyAdmin: boolean;
  allowedRoles: RoleType[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or deactivated.');
    }

    return {
      userId: user.id,
      companyId: user.companyId,
      email: user.email,
      fullName: user.fullName,
      isCompanyAdmin: user.isCompanyAdmin,
      allowedRoles: user.allowedRoles,
    };
  }
}
