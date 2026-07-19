import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Best-effort email channel (Section 16.2 step 5: "อีเมล/แอป/LINE").
// LINE and push notifications are separate follow-up integrations once a
// provider is chosen — this file is the one place to add them, since
// NotificationsService only calls EmailChannel.send(), never a transport
// library directly.
//
// If SMTP_HOST is not set, this channel logs instead of sending — that's
// intentional so the rest of the notification flow (in-app rows, read
// state) works in any environment without requiring real mail credentials.
@Injectable()
export class EmailChannel {
  private readonly logger = new Logger('EmailChannel');
  private transporterReady: boolean;

  constructor(private readonly config: ConfigService) {
    this.transporterReady = Boolean(this.config.get<string>('smtp.host'));
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporterReady) {
      this.logger.debug(`[SMTP not configured] would email ${to}: ${subject}`);
      return;
    }

    try {
      // Intentionally dependency-light: require() the transport lazily so
      // environments without `nodemailer` installed (or without SMTP
      // configured) never fail on module load, only on an actual send
      // attempt with SMTP configured but the package missing.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.config.get<string>('smtp.host'),
        port: this.config.get<number>('smtp.port'),
        secure: this.config.get<boolean>('smtp.secure'),
        auth: {
          user: this.config.get<string>('smtp.user'),
          pass: this.config.get<string>('smtp.pass'),
        },
      });
      await transporter.sendMail({
        from: this.config.get<string>('smtp.from'),
        to,
        subject,
        text: body,
      });
    } catch (err) {
      // Never let an email failure break the request that triggered it —
      // the in-app Notification row was already committed by this point.
      this.logger.warn(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }
}
