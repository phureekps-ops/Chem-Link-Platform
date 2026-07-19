import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EmailChannel } from './channels/email.channel';

@Module({
  providers: [NotificationsService, EmailChannel],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
