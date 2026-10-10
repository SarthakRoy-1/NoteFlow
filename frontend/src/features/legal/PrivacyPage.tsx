import { Link } from 'react-router-dom';
import { ContactDetails } from './ContactDetails';
import { LegalPage, Section } from './LegalPage';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="NoteFlow turns your notes into todos and reminders. This page explains what data NoteFlow handles to do that, who else receives it, and the choices you have. It describes how the service actually works today."
    >
      <nav className="legal-toc" aria-label="On this page">
        <ol>
          <li>
            <a href="#collect">What we collect</a>
          </li>
          <li>
            <a href="#ai">AI processing</a>
          </li>
          <li>
            <a href="#signin">Sign-in and sessions</a>
          </li>
          <li>
            <a href="#calendar">Google Calendar</a>
          </li>
          <li>
            <a href="#notifications">Email and push notifications</a>
          </li>
          <li>
            <a href="#sharing">Sharing a reminder</a>
          </li>
          <li>
            <a href="#providers">Services we use</a>
          </li>
          <li>
            <a href="#retention">Storage, retention and deletion</a>
          </li>
          <li>
            <a href="#choices">Your choices</a>
          </li>
          <li>
            <a href="#security">Security</a>
          </li>
          <li>
            <a href="#children">Children</a>
          </li>
          <li>
            <a href="#changes">Changes</a>
          </li>
          <li>
            <a href="#contact">Contact</a>
          </li>
        </ol>
      </nav>

      <Section id="collect" title="What we collect">
        <p>NoteFlow stores the following about you:</p>
        <ul>
          <li>
            <strong>Account details from Google:</strong> your name, your email address and Google's
            internal account identifier. We never receive your Google password.
          </li>
          <li>
            <strong>Your time zone,</strong> taken from your browser when you sign in and editable
            in Settings. It is used to read phrases like &ldquo;tomorrow at 5pm&rdquo; correctly.
          </li>
          <li>
            <strong>Your notes:</strong> the title and text you write.
          </li>
          <li>
            <strong>Items derived from your notes:</strong> todos, reminders (text, optional person,
            date and time, repeat days, status), reminders still waiting for a date and time, and a
            record of items you deleted so the same item is not created again.
          </li>
          <li>
            <strong>Ask AI history:</strong> each question you ask, the answer, and which of your
            notes were used.
          </li>
          <li>
            <strong>Notification settings and records:</strong> your email/push preferences, the
            push subscriptions of the browsers you enabled, and a delivery log (reminder id,
            channel, status, time; not the message content).
          </li>
          <li>
            <strong>Google Calendar connection,</strong> if you choose to connect one (see below).
          </li>
        </ul>
        <p>
          We do not run advertising or analytics trackers, and we do not sell your data. The only
          things kept in your browser are a sign-in cookie, short-lived cookies that complete the
          Google sign-in, your light/dark choice, and the service worker that shows push
          notifications if you turn them on.
        </p>
      </Section>

      <Section id="ai" title="AI processing">
        <p>
          When you save a note, its title and text, your time zone and the current date and time are
          sent to an AI model to find todos and reminders. When you use Ask AI, your question and
          the text of the notes found to be relevant are sent to the model. Your name, email address
          and Google identifier are not included.
        </p>
        <p>
          This deployment currently uses <strong>Groq</strong> as the AI provider. NoteFlow can also
          be configured to use Google Gemini instead. The provider processes the text under its own
          terms and privacy policy, which we do not control; please read them if your notes are
          sensitive. Do not put information in notes that you are not comfortable sending to an AI
          provider.
        </p>
        <p>
          The AI&apos;s output is checked by NoteFlow before anything is saved, and it cannot read
          other users&apos; data or take actions on its own.
        </p>
      </Section>

      <Section id="signin" title="Sign-in and sessions">
        <p>
          You sign in with Google (name, email and profile only). NoteFlow does not offer its own
          password login. After you sign in, NoteFlow creates a session: a random token is kept in
          an HttpOnly cookie in your browser, and only a hash of it is stored on the server. A
          session lasts about 24 hours (it ends when you close the browser), or about 30 days if you
          tick &ldquo;Remember me on this device&rdquo;. Signing out deletes the session on the
          server.
        </p>
      </Section>

      <Section id="calendar" title="Google Calendar (separate, optional)">
        <p>
          Connecting Google Calendar is optional and is a separate authorization from signing in.
          Signing in never gives NoteFlow access to your calendar. Nothing is requested until you
          click &ldquo;Connect Google Calendar&rdquo; in Settings and approve it on Google&apos;s
          consent screen.
        </p>
        <p>
          <strong>Permission requested:</strong> <code>{CALENDAR_SCOPE}</code> (&ldquo;see, create,
          change and delete events on Google calendars you own&rdquo;). NoteFlow needs it to create,
          change and delete events on your primary calendar. Google also offers narrower
          permissions, for example one limited to separate calendars an app creates itself; NoteFlow
          does not use those because it adds reminders to your own calendar.
        </p>
        <p>
          <strong>What NoteFlow does with it:</strong>
        </p>
        <ul>
          <li>
            While the calendar is connected, creates one event on your primary calendar for a
            reminder that has a date and time when that reminder is saved or edited, and updates
            that same event when you edit it. Reminders you saved before connecting are added only
            when you press &ldquo;Sync existing reminders&rdquo; in Settings, and a reminder without
            a time is never added.
          </li>
          <li>
            Deletes the event when you delete the reminder or its note. This is best effort: if
            Google cannot be reached at that moment, the event can stay in your calendar and you can
            delete it there yourself.
          </li>
          <li>
            The event contains the reminder text (and the person&apos;s name if the reminder names
            one), its start time and a 30-minute duration, your time zone, the repeat rule if the
            reminder repeats, and a short note that it was created by NoteFlow. It does not contain
            your note&apos;s text.
          </li>
          <li>
            NoteFlow does <strong>not</strong> read, list or search your other calendar events. It
            only creates, updates and deletes the events it created itself.
          </li>
          <li>
            Calendar data is used only to provide this feature: it is not used for advertising, not
            shared with third parties, and not used to train AI models.
          </li>
        </ul>
        <p>
          <strong>How the connection is stored:</strong> we keep a Google refresh token, the Google
          account email, the granted permission and a status. The token is encrypted (AES-256-GCM)
          before it is saved, the encryption key is derived from a server secret that is not stored
          in the database, and the token is never sent to your browser. Its use is limited by the
          server code to the calls described above. Like any encrypted-at-rest scheme, this protects
          the database contents; it does not protect against someone who gets access to both the
          database and the server&apos;s secrets.
        </p>
        <p>
          <strong>Disconnecting:</strong> click &ldquo;Disconnect Google Calendar&rdquo; in
          Settings. NoteFlow then deletes the stored token, asks Google to revoke the permission and
          stops creating events. Events already in your calendar are <em>not</em> removed; you can
          delete them in Google Calendar. You can also revoke access at any time in your Google
          Account under{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer noopener"
          >
            Security → Third-party apps &amp; services
          </a>
          ; NoteFlow then shows the connection as needing reconnection.
        </p>
        <p>
          NoteFlow&apos;s use of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer noopener"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section id="notifications" title="Email and push notifications">
        <p>
          NoteFlow can tell you when a reminder is due even when the app is closed. In Settings you
          choose whether to receive them.
        </p>
        <ul>
          <li>
            <strong>Email:</strong> a message to your account email with the reminder text, the
            person (if any), the due time and a link to NoteFlow. Messages are sent through Resend
            (an email delivery service), which processes them under its own policy.
          </li>
          <li>
            <strong>Web push:</strong> a notification delivered through your browser vendor&apos;s
            push service (for example Google for Chrome, Mozilla for Firefox, Apple for Safari). By
            default the notification only says a reminder is due; the reminder text is included only
            if you turn on &ldquo;Show the reminder text in the notification&rdquo;. Your browser
            asks for permission first, and you can turn it off for a device at any time.
          </li>
        </ul>
        <p>
          Reminders can arrive late or not at all (see the Terms of Service). In-app alerts need no
          email or push permission.
        </p>
      </Section>

      <Section id="sharing" title="Sharing a reminder with another user">
        <p>
          If you share a reminder with another NoteFlow user, that person can see the reminder text,
          its time and repeat schedule, and your name. They cannot see the note it came from or
          anything else in your account. You can stop sharing at any time.
        </p>
      </Section>

      <Section id="providers" title="Services we use">
        <p>NoteFlow relies on these providers to run. Each handles data under its own terms:</p>
        <ul>
          <li>
            <strong>Google</strong>: sign-in and, if you connect it, Google Calendar.
          </li>
          <li>
            <strong>Vercel</strong>: serves the website and forwards requests to the server.
          </li>
          <li>
            <strong>Render</strong>: runs the server and the PostgreSQL database that stores your
            data (hosted in Render&apos;s Oregon, United States region).
          </li>
          <li>
            <strong>Groq</strong>: AI processing of note text and questions (see above).
          </li>
          <li>
            <strong>Resend</strong>: delivery of reminder emails.
          </li>
          <li>
            <strong>Browser push services</strong> (Google, Mozilla, Apple or Microsoft, depending
            on your browser): delivery of push notifications.
          </li>
        </ul>
        <p>
          Hosting providers also keep their own operational logs (for example IP addresses and
          request times). NoteFlow&apos;s own server logs are written to avoid note text, tokens and
          secrets.
        </p>
      </Section>

      <Section id="retention" title="Storage, retention and deletion">
        <ul>
          <li>
            <strong>Your notes, todos and reminders</strong> are kept until you delete them.
            Deleting a note also deletes the todos, reminders and pending reminders that came from
            it. If you had connected a calendar, NoteFlow also tries to remove their Google Calendar
            events; if Google cannot be reached at that moment an event can remain in your calendar
            and you can delete it there.
          </li>
          <li>
            <strong>Sessions</strong> expire as described above and are deleted when you sign out.
          </li>
          <li>
            <strong>Ask AI history</strong> is kept. There is currently no button to delete
            individual questions; ask us to remove it (see Contact).
          </li>
          <li>
            <strong>Delivery records</strong> (status only) are kept for diagnostics.
          </li>
          <li>
            <strong>Account deletion:</strong> there is currently no &ldquo;delete my account&rdquo;
            button. To have your account and all its data removed, contact us (see below); this is
            done by hand. Deleting an account removes its notes, derived items, history, settings,
            subscriptions and Google Calendar connection from the database. Events that NoteFlow
            already created stay in your Google Calendar until you delete them there.
          </li>
          <li>
            <strong>Backups:</strong> the database host may keep backups for a period set by that
            provider; deleted data can persist there until they expire. NoteFlow does not control
            that period.
          </li>
        </ul>
      </Section>

      <Section id="choices" title="Your choices">
        <ul>
          <li>Edit or delete any note, todo or reminder in the app.</li>
          <li>Turn email and push notifications on or off in Settings.</li>
          <li>
            Connect or disconnect Google Calendar in Settings, or revoke it in your Google Account.
          </li>
          <li>Stop sharing a reminder, or turn off push on a device.</li>
          <li>Ask us to export, correct or delete your data (see Contact).</li>
        </ul>
      </Section>

      <Section id="security" title="Security">
        <p>
          Connections use HTTPS. Sign-in cookies are HttpOnly and Secure, every request is checked
          against your session so you can only reach your own data, secrets are kept out of the
          code, and Google Calendar tokens are encrypted as described above. No online service is
          perfectly secure. In particular, your notes are stored in a database that the operator can
          technically read; they are not end-to-end encrypted. We cannot guarantee that data will
          never be lost, exposed or unavailable.
        </p>
      </Section>

      <Section id="children" title="Children">
        <p>
          NoteFlow is not directed at children under 13 (or the minimum age in your country), and
          you should not use it if you are below that age.
        </p>
      </Section>

      <Section id="changes" title="Changes to this policy">
        <p>
          If this policy changes in a meaningful way, the date at the top will change and the
          updated text will be published on this page. Check the Terms of Service as well:{' '}
          <Link to="/terms">Terms of Service</Link>.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <ContactDetails topic="privacy questions, data requests, account deletion and support" />
      </Section>
    </LegalPage>
  );
}
