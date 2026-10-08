import { api } from '../../lib/api';

export const TODO_TITLE_MAX = 200;

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  completedAt: string | null;
  /** UTC instant. When dueHasTime is false it is the end of the due day in the user's timezone. */
  dueAt: string | null;
  dueHasTime: boolean;
  createdByAi: boolean;
  createdAt: string;
  updatedAt: string;
  sourceNote: { id: string; title: string };
}

/** A due date as the user typed it (their timezone). `null` clears it. */
export type DueInput = { date: string; time: string | null } | null;

export interface TodoChanges {
  title?: string;
  completed?: boolean;
  due?: DueInput;
}

export const listTodos = async () => (await api<{ todos: Todo[] }>('/todos')).todos;

export const updateTodo = async (id: string, changes: TodoChanges) =>
  (
    await api<{ todo: Todo }>(`/todos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    })
  ).todo;

export const deleteTodo = (id: string) =>
  api<void>(`/todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
