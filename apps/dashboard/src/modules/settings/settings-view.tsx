import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { getSettings, updateSettings, type TenantSettings } from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"

/**
 * Only mounted once the initial fetch has resolved, so `useState` can seed
 * straight from `initial` instead of syncing to it with an effect. `initial`
 * still updates on every render after a save (via the query invalidation in
 * `handleSave`) — the "unsaved changes" comparison below reads the current
 * prop each time, so it clears back to false once the refetch lands.
 */
function SettingsForm({ initial }: { initial: TenantSettings }) {
  const queryClient = useQueryClient()
  const [persona, setPersona] = useState(initial.persona)
  const [restrictions, setRestrictions] = useState(initial.restrictions)
  const [isSaving, setIsSaving] = useState(false)

  const dirty = persona !== initial.persona || restrictions !== initial.restrictions

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateSettings({
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        persona,
        restrictions,
      })
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success("Settings saved")
    } catch (error) {
      toast.error("Could not save settings")
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Label htmlFor="settings-persona">Persona</Label>
        <Textarea
          id="settings-persona"
          className="min-h-32"
          placeholder={`You are Aria, a friendly and upbeat support agent for Acme. Keep replies short and casual, and sign off with "— Aria".`}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Who the assistant is and how it should sound.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settings-restrictions">Restrictions</Label>
        <Textarea
          id="settings-restrictions"
          className="min-h-32"
          placeholder="Never discuss pricing for enterprise plans. Never promise a specific refund timeline. Never mention competitors."
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Things the assistant must never do, even if a visitor asks it to.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  )
}

export function SettingsView() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings({ baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
  })

  return (
    <div className="flex min-h-screen flex-col bg-muted p-8">
      <div className="mx-auto w-full max-w-screen-md">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-4xl">Settings</h1>
          <p className="text-muted-foreground">
            Shape how your AI assistant behaves — its persona, and what it must never do
          </p>
        </div>

        <div className="mt-8 rounded-lg border bg-background">
          {query.isLoading ? (
            <div className="space-y-4 p-6">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : query.data ? (
            <SettingsForm initial={query.data} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Could not load settings.</p>
          )}
        </div>
      </div>
    </div>
  )
}
