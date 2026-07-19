import { PrismaClient, RoleType, ProductSpecGroup, ProductDocType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { computeCompositeTrustScore } from '../src/common/util/trust-score';

const prisma = new PrismaClient();

// The 10 industry categories from the business plan (Section 5.1).
const CATEGORIES = [
  { slug: 'petrochemicals', nameTh: 'ปิโตรเคมีขั้นต้น-ขั้นกลาง', nameEn: 'Petrochemicals' },
  { slug: 'resins', nameTh: 'เม็ดพลาสติก (Resin)', nameEn: 'Plastic Resins' },
  { slug: 'industrial-chemicals', nameTh: 'เคมีภัณฑ์อุตสาหกรรมทั่วไป', nameEn: 'Industrial Chemicals' },
  { slug: 'coatings-pigments', nameTh: 'วัตถุดิบสีและสารเคลือบผิว', nameEn: 'Coatings & Pigments' },
  { slug: 'paper-chemicals', nameTh: 'เคมีภัณฑ์อุตสาหกรรมกระดาษ', nameEn: 'Paper Chemicals' },
  { slug: 'consumer-raw-materials', nameTh: 'วัตถุดิบสินค้าอุปโภคบริโภค', nameEn: 'Consumer Raw Materials' },
  { slug: 'packaging', nameTh: 'บรรจุภัณฑ์อุตสาหกรรม', nameEn: 'Industrial Packaging' },
  { slug: 'minerals', nameTh: 'แร่ธาตุอุตสาหกรรม', nameEn: 'Industrial Minerals' },
  { slug: 'recycled-materials', nameTh: 'วัสดุรีไซเคิล', nameEn: 'Recycled Materials' },
  { slug: 'specialty-imports', nameTh: 'สารเคมีนำเข้าเฉพาะทาง', nameEn: 'Specialty Imported Chemicals' },
];

async function main() {
  const passwordHash = await bcrypt.hash('Passw0rd!', 12);

  for (const [i, cat] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: { ...cat, sortOrder: i },
    });
  }
  const resinCategory = await prisma.category.findUniqueOrThrow({ where: { slug: 'resins' } });

  const sellerVerification = 92;
  const sellerRating = 88; // placeholder until Step 9 (ratings) is live
  const sellerBehavioral = 90;

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
          {
            roleType: RoleType.SELLER,
            verificationStatus: 'VERIFIED',
            verificationScore: sellerVerification,
            ratingScore: sellerRating,
            behavioralScore: sellerBehavioral,
            compositeTrustScore: computeCompositeTrustScore(
              sellerVerification,
              sellerRating,
              sellerBehavioral,
            ),
          },
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

  // Sample product matching the product.html mockup, so the frontend
  // and API agree on at least one real record end-to-end.
  const existingProduct = await prisma.product.findFirst({
    where: { sellerCompanyId: dualRoleCo.id, name: 'เม็ดพลาสติก PP รีไซเคิล เกรด Injection' },
  });
  if (!existingProduct) {
    await prisma.product.create({
      data: {
        sellerCompanyId: dualRoleCo.id,
        categoryId: resinCategory.id,
        name: 'เม็ดพลาสติก PP รีไซเคิล เกรด Injection',
        casNumber: '9003-07-0',
        grade: 'Injection grade',
        description:
          'เม็ดพลาสติก PP รีไซเคิลคุณภาพสูง เหมาะสำหรับงานฉีดขึ้นรูปที่ต้องการความแข็งแรงระดับกลางถึงสูง',
        moqValue: 5000,
        moqUnit: 'กก.',
        priceMin: 36,
        priceMax: 40,
        priceUnit: 'บาท/กก.',
        leadTimeDays: 7,
        stockStatus: 'IN_STOCK',
        isPublished: true,
        specs: {
          create: [
            {
              group: ProductSpecGroup.PHYSICAL_CHEMICAL,
              label: 'ลักษณะ (Appearance)',
              value: 'Off-white pellet, 3-4mm',
              sortOrder: 0,
            },
            {
              group: ProductSpecGroup.PHYSICAL_CHEMICAL,
              label: 'ความบริสุทธิ์ (Purity)',
              value: '99.2%',
              sortOrder: 1,
            },
            {
              group: ProductSpecGroup.PHYSICAL_CHEMICAL,
              label: 'MFI (230°C / 2.16kg)',
              value: '8.2 g/10min',
              sortOrder: 2,
            },
            {
              group: ProductSpecGroup.REGULATORY,
              label: 'มาตรฐานผลิตภัณฑ์',
              value: 'มอก. 1888-2560',
              sortOrder: 0,
            },
            {
              group: ProductSpecGroup.STORAGE_TRANSPORT,
              label: 'การจัดเก็บ',
              value: 'พื้นที่แห้ง อุณหภูมิห้อง อายุเก็บรักษา 24 เดือน',
              sortOrder: 0,
            },
          ],
        },
        documents: {
          create: [
            {
              docType: ProductDocType.TDS,
              fileUrl: 'https://example-storage.chemlink.dev/docs/pp-recycled-tds.pdf',
              version: '2.1',
            },
            {
              docType: ProductDocType.SDS,
              fileUrl: 'https://example-storage.chemlink.dev/docs/pp-recycled-sds.pdf',
              version: '1.0',
            },
          ],
        },
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('Seeded categories:', CATEGORIES.length);
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
