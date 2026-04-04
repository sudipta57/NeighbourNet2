type UpsertOptions = {
  onConflict?: string
}

type SupabaseError = {
  message: string
}

type SupabaseResponse = {
  data: unknown[] | null
  error: SupabaseError | null
}

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://npwdgcjukdwxffubkmeo.supabase.co"
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "sb_publishable_3qPrMUDHPEm1mCJeg8La-w_A0XjjVQc"

const buildError = (message: string): SupabaseResponse => ({
  data: null,
  error: { message },
})

const buildHeaders = (): Record<string, string> => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
})

const from = (table: string) => ({
  upsert: async (
    payload: Record<string, unknown>,
    options?: UpsertOptions
  ): Promise<SupabaseResponse> => {
    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return buildError('Supabase env is not configured')
      }

      const query = options?.onConflict
        ? `?on_conflict=${encodeURIComponent(options.onConflict)}`
        : ''

      const response = await fetch(
        `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${table}${query}`,
        {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify(payload),
        }
      )

      if (!response.ok) {
        const body = await response.text()
        return buildError(`Supabase upsert failed (${response.status}): ${body}`)
      }

      return { data: null, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return buildError(message)
    }
  },
})

const supabase = {
  from,
}

export default supabase
