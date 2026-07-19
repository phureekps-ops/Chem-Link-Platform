import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Registers a Company, activates the chosen roles (Section 14.1), and
  // creates the first user as company admin with access to all chosen
  // roles. All three writes happen in a single transaction so a partial
  // company-without-admin-user state is never possible.
  async register(dto: RegisterDto) {
    const existingCompany = await this.prisma.company.findUnique({
      where: { taxId: dto.companyTaxId },
    });
    if (existingCompany) {
      throw new ConflictException('A company with this tax ID is already registered.');
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('This email is already in use.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const { company, user } = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const company = await tx.company.create({
        data: {
          legalName: dto.companyLegalName,
          taxId: dto.companyTaxId,
          address: dto.companyAddress,
          province: dto.companyProvince,
          roles: {
            create: dto.roles.map((roleType) => ({ roleType })),
          },
        },
        include: { roles: true },
      });

      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          position: dto.position,
          isCompanyAdmin: true,
          allowedRoles: dto.roles,
        },
      });

      return { company, user };
    });

    const tokens = await this.issueTokens(user.id, company.id, user.allowedRoles);
    return {
      company: { id: company.id, legalName: company.legalName, roles: dto.roles },
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const tokens = await this.issueTokens(user.id, user.companyId, user.allowedRoles);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revoked: false },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    // rotate: revoke the used token, issue a new pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    const tokens = await this.issueTokens(
      stored.user.id,
      stored.user.companyId,
      stored.user.allowedRoles,
    );
    return { user: this.toPublicUser(stored.user), ...tokens };
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revoked: true },
    });
    return { success: true };
  }

  private async issueTokens(userId: string, companyId: string, allowedRoles: any[]) {
    const payload: JwtPayload = { sub: userId, companyId, allowedRoles };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const refreshTokenRaw = randomBytes(48).toString('hex');
    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') ?? '30d';

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshTokenRaw),
        expiresAt: this.addDuration(new Date(), refreshExpiresIn),
      },
    });

    return { accessToken, refreshToken: refreshTokenRaw };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // Minimal "30d" / "15m" style duration parser so refresh-token expiry
  // stays in sync with JWT_REFRESH_EXPIRES_IN without adding a dependency.
  private addDuration(base: Date, duration: string): Date {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
    const value = parseInt(match[1], 10);
    const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]] ?? 86400000;
    return new Date(base.getTime() + value * unitMs);
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    fullName: string;
    companyId: string;
    isCompanyAdmin: boolean;
    allowedRoles: any[];
  }) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      companyId: user.companyId,
      isCompanyAdmin: user.isCompanyAdmin,
      allowedRoles: user.allowedRoles,
    };
  }
}
