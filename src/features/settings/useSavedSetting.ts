import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

/**
 * A setting in app data that saves as it changes: while a save is on its way
 * it shows the value being saved, then what was saved. `query` goes to
 * useQuery as given, so options it leaves out keep the client's defaults.
 */
export function useSavedSetting<T>(
  query: { queryKey: QueryKey; queryFn: () => Promise<T>; staleTime?: number },
  save: (value: T) => Promise<T>,
  /** What else changes with it. */
  invalidates: QueryKey,
) {
  const qc = useQueryClient();
  const saved = useQuery(query);
  const saving = useMutation({
    mutationFn: save,
    onSuccess: async (value) => {
      qc.setQueryData(query.queryKey, value);
      await qc.invalidateQueries({ queryKey: invalidates });
    },
  });
  return {
    value: saving.isPending ? saving.variables : saved.data,
    loaded: saved.data !== undefined,
    saving: saving.isPending,
    error:
      saved.isError || saving.isError ? (saved.error ?? saving.error) : null,
    set: saving.mutate,
  };
}
