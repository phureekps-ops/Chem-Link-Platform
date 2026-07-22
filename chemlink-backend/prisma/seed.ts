import {
  CreditActionType,
  CreditTxnType,
  PrismaClient,
  RoleType,
  ProductSpecGroup,
  ProductDocType,
  SubscriptionTier,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { computeCompositeTrustScore } from '../src/common/util/trust-score';

const prisma = new PrismaClient();

// Step 6 (Section 13) — starter rate card. These figures are illustrative
// placeholders, not a finalized price list: Section 13.5 explicitly calls
// for a willingness-to-pay test with pilot users before setting real
// rates. 5 credits for a document download matches the example figure
// used in Section 13.1's own price-transparency confirm-dialog copy.
const SUBSCRIPTION_PLANS: Array<{
  tier: SubscriptionTier;
  nameTh: string;
  monthlyFreeCredits: number;
  priceMonthly: number;
  priceYearly: number;
}> = [
  { tier: SubscriptionTier.BASIC, nameTh: 'Basic', monthlyFreeCredits: 50, priceMonthly: 0, priceYearly: 0 },
  { tier: SubscriptionTier.PRO, nameTh: 'Pro', monthlyFreeCredits: 300, priceMonthly: 990, priceYearly: 9900 },
  {
    tier: SubscriptionTier.ENTERPRISE,
    nameTh: 'Enterprise',
    monthlyFreeCredits: 1500,
    priceMonthly: 4990,
    priceYearly: 49900,
  },
];

const CREDIT_RATE_CARD: Array<{ actionType: CreditActionType; creditsCost: number }> = [
  { actionType: CreditActionType.SEND_RFQ, creditsCost: 3 },
  { actionType: CreditActionType.DOWNLOAD_TECH_DOCUMENT, creditsCost: 5 },
  { actionType: CreditActionType.AI_SOURCING_QUERY, creditsCost: 2 },
  { actionType: CreditActionType.DEAL_ROOM_ACCESS, creditsCost: 1 },
  { actionType: CreditActionType.EXPORT_PRICE_INDEX, creditsCost: 10 },
  { actionType: CreditActionType.UNLOCK_CONTACT, creditsCost: 15 },
  { actionType: CreditActionType.MARKET_INTELLIGENCE_REPORT, creditsCost: 20 },
  { actionType: CreditActionType.UNLOCK_LEAD, creditsCost: 8 },
];

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

  // --- Step 6: Credit & Billing (Section 13) ---

  for (const plan of SUBSCRIPTION_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { tier: plan.tier },
      update: {
        nameTh: plan.nameTh,
        monthlyFreeCredits: plan.monthlyFreeCredits,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
      },
      create: plan,
    });
  }
  const basicPlan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { tier: SubscriptionTier.BASIC },
  });

  for (const rate of CREDIT_RATE_CARD) {
    const active = await prisma.creditRateCard.findFirst({
      where: { actionType: rate.actionType, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!active) {
      await prisma.creditRateCard.create({ data: rate });
    }
  }

  // Sign-up bonus so both seed companies can exercise metered actions
  // (e.g. POST /rfqs/:id/submit) immediately in a fresh dev environment,
  // matching Section 13.5's "แจกเครดิตฟรีปริมาณมากให้... ผู้ใช้งานนำร่อง"
  // mitigation for the credits-as-paywall chicken-and-egg risk.
  for (const company of [dualRoleCo, buyerOnlyCo]) {
    const wallet = await prisma.creditWallet.upsert({
      where: { companyId: company.id },
      update: {},
      create: {
        companyId: company.id,
        planId: basicPlan.id,
        monthlyFreeQuota: basicPlan.monthlyFreeCredits,
        quotaResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
      },
    });
    const alreadyGranted = await prisma.creditTransaction.findFirst({
      where: { walletId: wallet.id, type: CreditTxnType.CREDIT, note: 'seed: pilot sign-up bonus' },
    });
    if (!alreadyGranted) {
      const topped = await prisma.creditWallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: 100 } },
      });
      await prisma.creditTransaction.create({
        data: {
          walletId: wallet.id,
          type: CreditTxnType.CREDIT,
          amount: 100,
          balanceAfter: topped.balance,
          note: 'seed: pilot sign-up bonus',
        },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log('Seeded categories:', CATEGORIES.length);
  // eslint-disable-next-line no-console
  console.log('Seeded companies:', dualRoleCo.legalName, buyerOnlyCo.legalName);
  // eslint-disable-next-line no-console
  console.log('Seeded subscription plans + credit rate card (Step 6)');
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
