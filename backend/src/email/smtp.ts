import nodemailer, { type Transporter } from 'nodemailer';
import { EmailDeliveryError, type EmailMessage, type EmailSender } from './types.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

type Transport = Pick<Transporter, 'sendMail'>;

const TIMEOUT_MS = 10_000;

/**
 * Plain SMTP (Gmail with an App Password needs no domain). Credentials live only in the
 * transport. Message bodies hold one-time links, and nodemailer errors can echo the server
 * reply, so errors are reduced to a kind and never forwarded.
 */
export class SmtpEmailSender implements EmailSender {
  readonly configured = true;
  private readonly transport: Transport;

  constructor(
    private readonly config: SmtpConfig,
    transport?: Transport,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (err) {
      const { code, responseCode } = err as { code?: string; responseCode?: number };
      // Bad credentials or a refused recipient will not fix themselves; network and 4xx may.
      const permanent = code === 'EAUTH' || (responseCode !== undefined && responseCode >= 500);
      throw new EmailDeliveryError(permanent ? 'rejected' : 'unavailable');
    }
  }
}
