export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Lets a provider that supports it collapse a retried send of the same message into one. */
  idempotencyKey?: string;
}

export interface EmailSender {
  /** False when no provider is configured; callers must then not pretend mail was sent. */
  readonly configured: boolean;
  /** Throws EmailDeliveryError when the provider does not accept the message. */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Why a send failed, in terms that are safe to log: a provider name, a category and a code or HTTP
 * status. Never a message, header, address or message body (provider errors can echo those).
 */
export interface EmailFailureDetail {
  provider: 'smtp' | 'resend';
  category: string;
  code?: string;
  status?: number;
  /** Resend's machine-readable error name, e.g. "validation_error". */
  name?: string;
}

export class EmailDeliveryError extends Error {
  constructor(
    public readonly kind: 'not_configured' | 'rejected' | 'unavailable',
    public readonly detail?: EmailFailureDetail,
  ) {
    super(kind);
    this.name = 'EmailDeliveryError';
  }
}
