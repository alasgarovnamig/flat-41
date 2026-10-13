import { Global, Injectable, Logger, Module } from '@nestjs/common';

export interface MailMessage { to: string; subject: string; text: string; html?: string }
export interface MailProvider { readonly name: string; send(msg: MailMessage & { from: string }): Promise<void> }

/** Dev provider: logs the mail. */
export class ConsoleMailProvider implements MailProvider {
  readonly name = 'console';
  private readonly log = new Logger('Mail:console');
  async send(m: MailMessage & { from: string }) {
    this.log.log(`to=${m.to} subject="${m.subject}"\n${m.text}`);
  }
}

/** SMTP stub — wire a real transport (e.g. nodemailer with SMTP_URL) here when needed. Does not send. */
export class SmtpMailProvider implements MailProvider {
  readonly name = 'smtp';
  private readonly log = new Logger('Mail:smtp');
  constructor(readonly url: string | undefined) {}
  async send(m: MailMessage & { from: string }) {
    this.log.warn(`SMTP not implemented — dropping mail to ${m.to} ("${m.subject}")`);
  }
}

/** Transactional e-mail (future: password reset, e-mail verification). MAIL_PROVIDER = console | smtp. */
@Injectable()
export class MailService {
  readonly from = process.env.MAIL_FROM || 'EvTap <no-reply@evtap.az>';
  readonly provider: MailProvider = process.env.MAIL_PROVIDER === 'smtp' ? new SmtpMailProvider(process.env.SMTP_URL) : new ConsoleMailProvider();

  send(msg: MailMessage) {
    return this.provider.send({ ...msg, from: this.from });
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
