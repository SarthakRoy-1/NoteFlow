import { api } from '../../lib/api';

export const QUESTION_MAX = 500;

export interface AskSource {
  /** null once the note has been deleted (the title is then the saved one). */
  noteId: string | null;
  title: string;
}

export interface Ask {
  id: string;
  question: string;
  answer: string;
  /** no_info = the notes did not contain the answer. */
  status: 'answered' | 'no_info' | 'failed';
  createdAt: string;
  /** The notes the server actually retrieved for this answer. */
  sources: AskSource[];
}

export const askQuestion = async (question: string) =>
  (await api<{ ask: Ask }>('/ask', { method: 'POST', body: JSON.stringify({ question }) })).ask;

export const listAskHistory = async () => (await api<{ history: Ask[] }>('/ask/history')).history;
