import { Module } from '@nestjs/common';
import { RfqService } from './rfq.service';
import { RfqController } from './rfq.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [NotificationsModule, CreditsModule],
  providers: [RfqService],
  controllers: [RfqController],
  exports: [RfqService],
})
export class RfqModule {}
