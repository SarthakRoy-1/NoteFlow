export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  /** False when no provider is configured; callers must then not pretend mail was sent. */
  readonly configured: boolean;
  /** Throws EmailDeliveryError when the provider does not accept the message. */
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(public readonly kind: 'not_configured' | 'rejected' | 'unavailable') {
    super(kind);
    this.name = 'EmailDeliveryError';
  }
}
