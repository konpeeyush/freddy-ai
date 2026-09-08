import type { DbAdapter } from "./adapter"

/*
 * Per-tenant assistant configuration: persona (who/how it is) and
 * restrictions (what it must not do). Read by `/chat` and layered onto the
 * system prompt for every turn — see `index.ts`.
 */

export type SettingsRow = {
  tenant_id: string
  persona: string
  restrictions: string
  updated_at: number
}

export type TenantSettings = { persona: string; restrictions: string }

const DEFAULTS: TenantSettings = { persona: "", restrictions: "" }

/** Empty strings when nothing has been configured yet, rather than
 *  `undefined` — callers (the dashboard form, `/chat`'s prompt assembly)
 *  never have to special-case "not configured." */
export async function getSettings(db: DbAdapter, tenantId: string): Promise<TenantSettings> {
  const row = await db.get<SettingsRow>("SELECT * FROM settings WHERE tenant_id = ?", [
    tenantId,
  ])
  if (!row) return DEFAULTS
  return { persona: row.persona, restrictions: row.restrictions }
}

export async function upsertSettings(
  db: DbAdapter,
  tenantId: string,
  settings: TenantSettings
): Promise<TenantSettings> {
  await db.run(
    `INSERT INTO settings (tenant_id, persona, restrictions, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id) DO UPDATE SET
       persona = excluded.persona,
       restrictions = excluded.restrictions,
       updated_at = excluded.updated_at`,
    [tenantId, settings.persona, settings.restrictions, Date.now()]
  )
  return settings
}
