import { DEFAULT_TENANT } from "@workspace/api"

/** The backend's origin — no path suffix, matches every `packages/api`
 *  client function's `baseUrl` option. */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:8788"

/** Single-tenant today — see `DEFAULT_TENANT`'s own comment in the wire
 *  schema. Centralised here so a real tenant picker is a one-line change
 *  later, not a search-and-replace. */
export const TENANT_ID: string = DEFAULT_TENANT
