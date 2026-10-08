import { api } from '../../lib/api';

// Keep in sync with backend/src/modules/notes/notes.schemas.ts (the server is authoritative).
export const TITLE_MAX = 200;
export const CONTENT_MAX = 20_000;

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  content: string;
}

export const listNotes = async () => (await api<{ notes: NoteSummary[] }>('/notes')).notes;

export const getNote = async (id: string) =>
  (await api<{ note: Note }>(`/notes/${encodeURIComponent(id)}`)).note;

export const createNote = async (input: NoteInput) =>
  (await api<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) })).note;

export const updateNote = async (id: string, input: Partial<NoteInput>) =>
  (
    await api<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  ).note;

export const deleteNote = (id: string) =>
  api<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
