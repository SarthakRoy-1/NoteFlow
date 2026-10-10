import { Link } from 'react-router-dom';
import { ContactDetails } from './ContactDetails';
import { LegalPage, Section } from './LegalPage';

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms apply when you use NoteFlow. By signing in or using the service you agree to them. If you do not agree, please do not use NoteFlow."
    >
      <Section id="service" title="What NoteFlow is">
        <p>
          NoteFlow is a notes app that uses AI to suggest todos and reminders from what you write,
          shows reminder alerts, can send email and push notifications, and can add reminders to
          your Google Calendar. It is provided by the individual maintainer of the NoteFlow project
          (there is no company or registered business behind this deployment) and may change or stop
          at any time.
        </p>
      </Section>

      <Section id="accounts" title="Your account">
        <ul>
          <li>
            You sign in with a Google account. You are responsible for that account and for what
            happens in NoteFlow while you are signed in on your devices.
          </li>
          <li>You must be old enough to use Google services in your country and at least 13.</li>
          <li>Tell us if you think your account has been used without your permission.</li>
        </ul>
      </Section>

      <Section id="content" title="Your notes and content">
        <p>
          Your notes belong to you. You give NoteFlow permission to store them and to process them
          as described in the <Link to="/privacy">Privacy Policy</Link> (including sending the text
          to an AI provider) solely to operate the features you use. You are responsible for what
          you write and for having the right to store it. Do not store information you are not
          allowed to share with the providers listed in the Privacy Policy.
        </p>
      </Section>

      <Section id="use" title="Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>break the law or use NoteFlow to harm, harass or defraud anyone;</li>
          <li>
            upload malicious code or try to disrupt, overload or probe the service for weaknesses;
          </li>
          <li>access, or try to access, another person&apos;s data or account;</li>
          <li>
            use automated means to create accounts or to send bulk or unsolicited sharing requests,
            email or notifications;
          </li>
          <li>
            use the AI features to generate content that is unlawful or abusive, or to attempt to
            make the AI ignore its rules.
          </li>
        </ul>
      </Section>

      <Section id="ai" title="AI-generated results">
        <p>
          The AI reads your notes and suggests todos, reminders and answers. It can be wrong: it may
          miss an item, invent a detail, misread a date or time zone, or answer from the wrong note.
          Always check suggested items and answers yourself, especially for anything important.
          NoteFlow does not give professional, medical, legal or financial advice.
        </p>
      </Section>

      <Section id="reminders" title="Reminders and notifications are not guaranteed">
        <p>
          Reminders, in-app alerts, email and push notifications depend on many things outside our
          control, including your device and browser, your network, email and push providers, and
          the hosting service, which may be asleep or unavailable. Notifications can be late, can be
          skipped (for example if they are more than a few hours overdue) or may never arrive.
          In-app alerts only appear while NoteFlow is open and you are signed in. Do not rely on
          NoteFlow for anything where a missed or late reminder could cause harm, loss or a missed
          deadline with serious consequences.
        </p>
      </Section>

      <Section id="calendar" title="Google Calendar integration">
        <p>
          Connecting Google Calendar is your choice. By connecting it you authorize NoteFlow to
          create, update and delete the calendar events it makes for your reminders, as described in
          the <Link to="/privacy#calendar">Privacy Policy</Link>. You can disconnect it in Settings
          or revoke it in your Google Account at any time. Events are created in your calendar and
          remain under your control. Reminders saved before you connected are added only when you
          choose &ldquo;Sync existing reminders&rdquo;. If a sync or a deletion fails, a reminder
          may be missing from, different in or left behind in your calendar. Google Calendar is a
          Google service and is subject to Google&apos;s terms.
        </p>
      </Section>

      <Section id="availability" title="Availability and changes">
        <p>
          NoteFlow is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. It
          may be slow, interrupted, changed or discontinued without notice, and features can be
          added or removed. We try to keep your data safe but do not promise that it will not be
          lost, so keep a copy of anything you cannot afford to lose.
        </p>
      </Section>

      <Section id="termination" title="Suspension and ending your use">
        <p>
          You can stop using NoteFlow at any time and ask for your account to be deleted (see
          Contact). We may suspend or end access to NoteFlow, with or without notice, if we believe
          these terms are being broken, to protect the service or other users, or if the service
          ends.
        </p>
      </Section>

      <Section id="liability" title="Limits of liability">
        <p>
          To the fullest extent allowed by law, NoteFlow and its maintainer are not liable for
          indirect or consequential losses, lost data, missed reminders or deadlines, or any loss
          arising from your use of or inability to use the service, and our total liability for any
          claim is limited to the amount you paid for NoteFlow, which is zero. Nothing in these
          terms limits liability that cannot be limited by law, or any rights you have as a consumer
          that cannot be waived.
        </p>
      </Section>

      <Section id="changes" title="Changes to these terms">
        <p>
          These terms may be updated. The date at the top shows the latest version, and continuing
          to use NoteFlow after a change means you accept the updated terms.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <ContactDetails topic="legal questions about these terms and for support" />
        <p>
          See also the <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
