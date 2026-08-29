export const persistWorkspaceSessionStateBeforeHistory = async (
  persistSession: () => Promise<unknown>,
  persistHistory: () => Promise<unknown>,
) => {
  await persistSession()
  await persistHistory()
}
