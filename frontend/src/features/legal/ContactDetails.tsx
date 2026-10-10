import { CONTACT_EMAIL, PROJECT_ISSUES_URL, PROJECT_URL } from './legalInfo';

/**
 * How to reach whoever runs this deployment. With no published mailbox it points to the public
 * project page and warns not to post private details there.
 */
export function ContactDetails({ topic }: { topic: string }) {
  if (CONTACT_EMAIL) {
    return (
      <p>
        For {topic}, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    );
  }
  return (
    <p>
      NoteFlow is run by the maintainer of the project at{' '}
      <a href={PROJECT_URL} target="_blank" rel="noreferrer noopener">
        {PROJECT_URL}
      </a>
      . For {topic}, open an issue at{' '}
      <a href={PROJECT_ISSUES_URL} target="_blank" rel="noreferrer noopener">
        {PROJECT_ISSUES_URL}
      </a>
      . Issues there are public, so please do not include your notes, tokens or other private
      details; say only that you have a privacy request and ask for a private way to continue.
    </p>
  );
}
