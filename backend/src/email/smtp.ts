import nodemailer, { type Transporter } from 'nodemailer';
import {
  EmailDeliveryError,
  type EmailFailureDetail,
  type EmailMessage,
  type EmailSender,
} from './types.js';

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

const CODE_CATEGORY: Record<string, string> = {
  EAUTH: 'auth',
  ETIMEDOUT: 'timeout',
  ESOCKETTIMEDOUT: 'timeout',
  ECONNREFUSED: 'connection_refused',
  ECONNRESET: 'connection_reset',
  ECONNECTION: 'connection',
  ESOCKET: 'connection',
  ENETUNREACH: 'network_unreachable',
  EHOSTUNREACH: 'network_unreachable',
  ENOTFOUND: 'dns',
  EDNS: 'dns',
  ETLS: 'tls',
  ESTARTTLS: 'tls',
  EENVELOPE: 'envelope',
  EMESSAGE: 'message',
};

/** A category plus nodemailer's short error code (e.g. ETIMEDOUT) or the SMTP reply class. */
export function smtpDetail(code?: string, responseCode?: number): EmailFailureDetail {
  const safeCode = code && /^[A-Z_]{2,24}$/.test(code) ? code : undefined;
  let category = (safeCode && CODE_CATEGORY[safeCode]) || 'unknown';
  if (category === 'unknown' && responseCode !== undefined) {
    category = responseCode >= 500 ? 'smtp_5xx' : responseCode >= 400 ? 'smtp_4xx' : 'unknown';
  }
  const detail: EmailFailureDetail = { provider: 'smtp', category };
  if (safeCode) detail.code = safeCode;
  if (responseCode !== undefined) detail.status = responseCode;
  return detail;
}

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
      throw new EmailDeliveryError(
        permanent ? 'rejected' : 'unavailable',
        smtpDetail(code, responseCode),
      );
    }
  }
}
