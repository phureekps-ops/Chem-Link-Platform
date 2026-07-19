import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { DealsModule } from './modules/deals/deals.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Basic rate limiting from day one — every credit-metered endpoint added
    // in later build steps (Section 13) will layer stricter limits on top.
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    RfqModule,
    DealsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
