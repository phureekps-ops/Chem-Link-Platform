-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationDocType" AS ENUM ('TRADE_REGISTRATION', 'HAZMAT_LICENSE', 'ISO_CERTIFICATE', 'AUTHORIZED_BUYER_LETTER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductDocType" AS ENUM ('SDS', 'COA', 'TDS');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'MADE_TO_ORDER', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "ProductSpecGroup" AS ENUM ('PHYSICAL_CHEMICAL', 'APPLICATION', 'REGULATORY', 'STORAGE_TRANSPORT');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'QUOTED', 'NEGOTIATING', 'VERIFICATION', 'CLOSED_WON', 'CLOSED_LOST', 'CANCELLED', 'RATED');

-- CreateEnum
CREATE TYPE "RfqDistributionType" AS ENUM ('TARGETED', 'MARKET');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('INVITED', 'ACKNOWLEDGED', 'QUOTED', 'NEGOTIATING', 'WON', 'LOST', 'DECLINED');

-- CreateEnum
CREATE TYPE "DealMessageType" AS ENUM ('TEXT', 'QUOTE', 'DOCUMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RFQ_RECEIVED', 'DEAL_ACKNOWLEDGED', 'QUOTE_RECEIVED', 'MESSAGE_RECEIVED', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "CreditActionType" AS ENUM ('SEND_RFQ', 'DOWNLOAD_TECH_DOCUMENT', 'AI_SOURCING_QUERY', 'DEAL_ROOM_ACCESS', 'EXPORT_PRICE_INDEX', 'UNLOCK_CONTACT', 'MARKET_INTELLIGENCE_REPORT', 'UNLOCK_LEAD');

-- CreateEnum
CREATE TYPE "CreditTxnType" AS ENUM ('DEBIT', 'CREDIT', 'REFUND');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "address" TEXT,
    "province" TEXT,
    "industryType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_roles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleType" "RoleType" NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verificationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "behavioralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "compositeTrustScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" TEXT NOT NULL,
    "companyRoleId" TEXT NOT NULL,
    "docType" "VerificationDocType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedNote" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "isCompanyAdmin" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" "RoleType"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "casNumber" TEXT,
    "grade" TEXT,
    "description" TEXT,
    "moqValue" DOUBLE PRECISION,
    "moqUnit" TEXT,
    "priceMin" DOUBLE PRECISION,
    "priceMax" DOUBLE PRECISION,
    "priceUnit" TEXT,
    "leadTimeDays" INTEGER,
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'MADE_TO_ORDER',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_specs" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "group" "ProductSpecGroup" NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_documents" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "docType" "ProductDocType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "version" TEXT,
    "issuedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "casNumber" TEXT,
    "gradeRequirement" TEXT,
    "purityRequirement" TEXT,
    "quantityValue" DOUBLE PRECISION NOT NULL,
    "quantityUnit" TEXT NOT NULL,
    "deliveryLocation" TEXT NOT NULL,
    "deliveryDeadline" TIMESTAMP(3),
    "paymentTermsNote" TEXT,
    "notes" TEXT,
    "distributionType" "RfqDistributionType" NOT NULL DEFAULT 'TARGETED',
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'INVITED',
    "matchedViaMarket" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "priceUnit" TEXT NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "moqValue" DOUBLE PRECISION,
    "validUntil" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_messages" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" "DealMessageType" NOT NULL,
    "senderUserId" TEXT,
    "content" TEXT,
    "attachmentUrl" TEXT,
    "relatedQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dealId" TEXT,
    "rfqId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "nameTh" TEXT NOT NULL,
    "monthlyFreeCredits" INTEGER NOT NULL,
    "priceMonthly" DECIMAL(12,2) NOT NULL,
    "priceYearly" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planId" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "monthlyFreeQuota" INTEGER NOT NULL DEFAULT 0,
    "monthlyFreeQuotaUsed" INTEGER NOT NULL DEFAULT 0,
    "quotaResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "CreditTxnType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "actionType" "CreditActionType",
    "fromQuota" BOOLEAN NOT NULL DEFAULT false,
    "roleContext" "RoleType",
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_rate_cards" (
    "id" TEXT NOT NULL,
    "actionType" "CreditActionType" NOT NULL,
    "creditsCost" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "priceThb" DECIMAL(12,2) NOT NULL,
    "bonusCredits" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_taxId_key" ON "companies"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "company_roles_companyId_roleType_key" ON "company_roles"("companyId", "roleType");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_sellerCompanyId_idx" ON "products"("sellerCompanyId");

-- CreateIndex
CREATE INDEX "product_specs_productId_idx" ON "product_specs"("productId");

-- CreateIndex
CREATE INDEX "product_documents_productId_idx" ON "product_documents"("productId");

-- CreateIndex
CREATE INDEX "deals_sellerCompanyId_idx" ON "deals"("sellerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "deals_rfqId_sellerCompanyId_key" ON "deals"("rfqId", "sellerCompanyId");

-- CreateIndex
CREATE INDEX "quotes_dealId_idx" ON "quotes"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_dealId_version_key" ON "quotes"("dealId", "version");

-- CreateIndex
CREATE INDEX "deal_messages_dealId_idx" ON "deal_messages"("dealId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_tier_key" ON "subscription_plans"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_companyId_key" ON "credit_wallets"("companyId");

-- CreateIndex
CREATE INDEX "credit_transactions_walletId_createdAt_idx" ON "credit_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_rate_cards_actionType_effectiveFrom_idx" ON "credit_rate_cards"("actionType", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "company_roles" ADD CONSTRAINT "company_roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_companyRoleId_fkey" FOREIGN KEY ("companyRoleId") REFERENCES "company_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_specs" ADD CONSTRAINT "product_specs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_relatedQuoteId_fkey" FOREIGN KEY ("relatedQuoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
