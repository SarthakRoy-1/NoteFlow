/**
 * Facts shown on the legal pages that the owner must be able to change in one place.
 * Nothing here is invented: each value is either a real public fact about the project or a clearly
 * marked gap the owner still has to decide (see CONTACT_EMAIL).
 */

/** Update this whenever the Privacy Policy or the Terms change in substance. */
export const LEGAL_LAST_UPDATED = '11 October 2026';

/**
 * The address published for privacy, legal, support and account requests. If it is set to null the
 * pages fall back to the public project page and say so honestly.
 */
export const CONTACT_EMAIL: string | null = 'sarthakroy40@gmail.com';

/** The public home of the project (the repository owner is who runs this deployment). */
export const PROJECT_URL = 'https://github.com/SarthakRoy-1/NoteFlow';
export const PROJECT_ISSUES_URL = `${PROJECT_URL}/issues`;
