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
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Resend drops a repeat of the same key for 24 h, so a retry after a timeout cannot double-send.
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = (err as Error).name === 'TimeoutError';
      throw new EmailDeliveryError('unavailable', {
        provider: 'resend',
        category: timedOut ? 'timeout' : 'network',
      });
    }
    if (res.ok) return;
    // Resend answers with { name, message }. Only the machine-readable name is kept: the message
    // can quote the recipient or sender address.
    const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
    const name =
      typeof body?.name === 'string' && /^[a-z_]{1,60}$/.test(body.name) ? body.name : undefined;
    const transient = res.status >= 500 || res.status === 429;
    throw new EmailDeliveryError(transient ? 'unavailable' : 'rejected', {
      provider: 'resend',
      category: transient ? 'provider_unavailable' : 'provider_rejected',
      status: res.status,
      ...(name ? { name } : {}),
    });
  }
}
