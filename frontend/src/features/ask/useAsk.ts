import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { askQuestion, listAskHistory } from './askApi';

export const ASK_HISTORY_KEY = ['ask', 'history'] as const;

export const useAskHistory = () => useQuery({ queryKey: ASK_HISTORY_KEY, queryFn: listAskHistory });

export function useAskQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: askQuestion,
    onSuccess: () => qc.invalidateQueries({ queryKey: ASK_HISTORY_KEY }),
  });
}
