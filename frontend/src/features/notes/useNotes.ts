import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { createNote, deleteNote, getNote, listNotes, updateNote, type NoteInput } from './notesApi';

export const NOTES_KEY = ['notes'] as const;
export const noteKey = (id: string) => ['notes', id] as const;

export function useNotesList() {
  return useQuery({ queryKey: NOTES_KEY, queryFn: listNotes });
}

export function useNote(id: string) {
  return useQuery({
    queryKey: noteKey(id),
    queryFn: () => getNote(id),
    // A 404 will not fix itself; do not hammer the server with retries.
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteInput) => createNote(input),
    onSuccess: (note) => {
      qc.setQueryData(noteKey(note.id), note);
      return qc.invalidateQueries({ queryKey: NOTES_KEY, exact: true });
    },
  });
}

export function useUpdateNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<NoteInput>) => updateNote(id, input),
    onSuccess: (note) => {
      qc.setQueryData(noteKey(id), note);
      return qc.invalidateQueries({ queryKey: NOTES_KEY, exact: true });
    },
  });
}

export function useDeleteNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteNote(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: noteKey(id), exact: true });
      return qc.invalidateQueries({ queryKey: NOTES_KEY, exact: true });
    },
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}
