import { EmailDeliveryError, type EmailMessage, type EmailSender } from './types.js';

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * The key goes in a header only. Message bodies hold one-time links, so nothing here logs them.
 */
export class ResendEmailSender implements EmailSender {
  readonly configured = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EmailDeliveryError('unavailable');
    }
    if (res.ok) return;
    throw new EmailDeliveryError(
      res.status >= 500 || res.status === 429 ? 'unavailable' : 'rejected',
    );
  }
}
