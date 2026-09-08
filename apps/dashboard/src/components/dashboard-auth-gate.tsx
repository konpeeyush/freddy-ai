import { useEffect, useState, type FormEvent, type ReactNode } from "react"

import { ChatRequestError, getSettings, setDashboardAuthKey } from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"
import { FreddyLogo } from "./freddy-logo"

const STORAGE_KEY = "dashboard-auth-key"

/**
 * Gates the whole dashboard behind one shared password — see
 * `packages/backend/src/auth.ts`. Not real accounts: this project has one
 * operator, so one secret is the right amount of auth, not a users table.
 *
 * Verified by calling a real gated endpoint (`/settings`) rather than a
 * dedicated `/auth/check` route — one fewer endpoint to keep in sync with
 * which routes are actually gated. This also means the gate is a no-op
 * everywhere the backend has no `DASHBOARD_PASSWORD` set (local dev, or a
 * deployment that hasn't configured one yet): the very first check succeeds
 * with no key attached at all, since the backend's own middleware only
 * rejects requests when it has a password configured to check against.
 */
export function DashboardAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "locked" | "unlocked">("checking")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) setDashboardAuthKey(saved)

    getSettings({ baseUrl: API_BASE_URL, tenantId: TENANT_ID })
      .then(() => setStatus("unlocked"))
      .catch((cause) => {
        if (!(cause instanceof ChatRequestError && cause.status === 401)) {
          console.error("dashboard auth check failed:", cause)
        }
        if (saved) {
          localStorage.removeItem(STORAGE_KEY)
          setDashboardAuthKey(null)
        }
        setStatus("locked")
      })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError("")
    setDashboardAuthKey(password)
    try {
      await getSettings({ baseUrl: API_BASE_URL, tenantId: TENANT_ID })
      localStorage.setItem(STORAGE_KEY, password)
      setStatus("unlocked")
    } catch {
      setDashboardAuthKey(null)
      setError("Wrong password")
    } finally {
      setSubmitting(false)
    }
  }

  if (status === "checking") return null

  if (status === "locked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-8">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-5 rounded-lg border bg-background p-6"
        >
          <div className="flex items-center gap-3">
            <FreddyLogo size={40} />
            <div>
              <h1 className="text-lg font-bold">Freddy dashboard</h1>
              <p className="text-sm text-muted-foreground">Enter the password to continue.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dashboard-password">Password</Label>
            <Input
              id="dashboard-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" className="w-full" disabled={!password || submitting}>
            {submitting ? "Checking..." : "Unlock"}
          </Button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}
