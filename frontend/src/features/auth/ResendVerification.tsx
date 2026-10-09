import { useMutation } from '@tanstack/react-query';
import { resendVerification } from './authApi';

/** "Send a new link" with honest feedback, including the server's rate-limit message. */
export function ResendVerification({
  email,
  label = 'Send a new link',
}: {
  email: string;
  label?: string;
}) {
  const resend = useMutation({ mutationFn: resendVerification });

  return (
    <div className="resend">
      <button
        type="button"
        className="button"
        disabled={resend.isPending}
        onClick={() => resend.mutate(email)}
      >
        {resend.isPending ? 'Sending…' : resend.isSuccess ? 'Send again' : label}
      </button>
      {resend.isSuccess && (
        <p role="status" className="field-hint">
          If that address is waiting to be confirmed, a new link is on its way. Check your spam
          folder too.
        </p>
      )}
      {resend.isError && (
        <p role="alert" className="alert alert-error">
          {resend.error.message}
        </p>
      )}
    </div>
  );
}

export function VerificationSent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="auth-sent" role="status" aria-live="polite">
      <h2>Check your email</h2>
      <p>
        If <strong>{email}</strong> can be used for a new account, we have sent a confirmation link
        to it. Open the link and enter the password you just chose to finish. It works once and
        expires in 24 hours.
      </p>
      <ResendVerification email={email} />
      <button type="button" className="link-button" onClick={onBack}>
        Use a different email
      </button>
    </div>
  );
}
