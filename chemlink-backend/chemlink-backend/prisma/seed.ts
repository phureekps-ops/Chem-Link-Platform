import { PrismaClient, RoleType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Passw0rd!', 12);

  // A dual-role company, matching the Section 14 scenario: an importer
  // that sells chemicals but also buys certain specialty inputs.
  const dualRoleCo = await prisma.company.upsert({
    where: { taxId: '0105500000001' },
    update: {},
    create: {
      legalName: 'บจก. ไทยโพลีไซเคิล',
      taxId: '0105500000001',
      province: 'สมุทรปราการ',
      roles: {
        create: [
          { roleType: RoleType.SELLER, verificationStatus: 'VERIFIED', verificationScore: 92 },
          { roleType: RoleType.BUYER, verificationStatus: 'VERIFIED', verificationScore: 88 },
        ],
      },
      users: {
        create: {
          email: 'owner@thaipolyrecycle.example',
          passwordHash,
          fullName: 'สมชาย วิริยะ',
          position: 'กรรมการผู้จัดการ',
          isCompanyAdmin: true,
          allowedRoles: [RoleType.SELLER, RoleType.BUYER],
        },
      },
    },
  });

  const buyerOnlyCo = await prisma.company.upsert({
    where: { taxId: '0105500000002' },
    update: {},
    create: {
      legalName: 'บจก. สยามแพ็กเกจจิ้ง',
      taxId: '0105500000002',
      province: 'ชลบุรี',
      roles: {
        create: [{ roleType: RoleType.BUYER, verificationStatus: 'VERIFIED' }],
      },
      users: {
        create: {
          email: 'procurement@siampackaging.example',
          passwordHash,
          fullName: 'วิภา ตั้งจิตร',
          position: 'เจ้าหน้าที่จัดซื้อ',
          isCompanyAdmin: true,
          allowedRoles: [RoleType.BUYER],
        },
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded companies:', dualRoleCo.legalName, buyerOnlyCo.legalName);
  // eslint-disable-next-line no-console
  console.log('All seeded users share the password: Passw0rd!');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
