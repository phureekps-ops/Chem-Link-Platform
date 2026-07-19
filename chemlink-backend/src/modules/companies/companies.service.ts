import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleType } from '@prisma/client';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { roles: true },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  // Section 14.1: "เปิดให้เพิ่มบทบาทที่สองภายหลังได้ตลอดเวลาโดยไม่ต้องสมัครบัญชีใหม่"
  // Adds a new CompanyRole to an existing company without touching any
  // other company data. Does NOT automatically grant existing users
  // access to the new role — a company admin must explicitly update each
  // user's allowedRoles via the Users module, keeping the
  // least-privilege boundary from Section 14.3 intact.
  async activateRole(companyId: string, roleType: RoleType) {
    const existing = await this.prisma.companyRole.findUnique({
      where: { companyId_roleType: { companyId, roleType } },
    });
    if (existing) {
      throw new ConflictException(`Role ${roleType} is already activated for this company.`);
    }

    return this.prisma.companyRole.create({
      data: { companyId, roleType },
    });
  }

  async listRoles(companyId: string) {
    return this.prisma.companyRole.findMany({ where: { companyId } });
  }
}
