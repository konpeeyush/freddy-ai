import { createMiddleware } from "hono/factory"

/*
 * A single shared password gating the dashboard's own management surface —
 * not a real accounts system. This project has exactly one operator, so
 * "only I can access settings" means one secret, not a users table, session
 * store, or login flow. See the note on `/settings`'s own routes for which
 * ones this actually needs to cover.
 *
 * Left off entirely when `DASHBOARD_PASSWORD` is unset, same as
 * `DATABASE_URL`'s opt-in shape elsewhere in this file's siblings — local
 * dev and a fresh clone stay frictionless by default; setting the env var is
 * what turns this on for a real deployment.
 */
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD

/**
 * `createMiddleware` rather than a plain `(c, next) => ...` function: Hono
 * infers a route's path-param types (`c.req.param("id")`) from the whole
 * `app.get(path, ...middleware, handler)` call together, and a middleware
 * typed against the bare `Context`/`Next` from `"hono"` breaks that chain —
 * every param on a gated route would silently widen to `string | undefined`.
 */
export const requireDashboardAuth = createMiddleware(async (c, next) => {
  if (!DASHBOARD_PASSWORD) return next()

  const provided = c.req.header("x-dashboard-key")
  if (provided !== DASHBOARD_PASSWORD) {
    return c.json({ error: "unauthorized", retryable: false }, 401)
  }
  return next()
})
