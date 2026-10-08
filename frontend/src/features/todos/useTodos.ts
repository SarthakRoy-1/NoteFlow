import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteTodo, listTodos, updateTodo, type TodoChanges } from './todosApi';

export const TODOS_KEY = ['todos'] as const;

export function useTodos() {
  return useQuery({ queryKey: TODOS_KEY, queryFn: listTodos });
}

export function useUpdateTodo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: TodoChanges) => updateTodo(id, changes),
    onSuccess: () => qc.invalidateQueries({ queryKey: TODOS_KEY }),
  });
}

export function useDeleteTodo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteTodo(id),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: TODOS_KEY }),
        // A note shows how many todos came from it; keep that count honest.
        qc.invalidateQueries({ queryKey: ['notes'] }),
      ]),
  });
}
