import { QueryClient, type QueryKey } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /** Короткий staleTime, чтобы после invalidate данные не считались «ещё свежими» без refetch */
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Помечает запросы устаревшими и один раз перезапрашивает их.
 * Важно: один вызов `invalidateQueries` без `refetchType: "none"` уже триггерит refetch активных
 * запросов; второй `refetchQueries` дублировал GET и мог гоняться с только что завершившимся DELETE.
 */
export async function invalidateAndRefetch(qc: QueryClient, queryKey: QueryKey) {
  await qc.invalidateQueries({ queryKey, refetchType: "none" });
  await qc.refetchQueries({ queryKey, type: "all" });
}
