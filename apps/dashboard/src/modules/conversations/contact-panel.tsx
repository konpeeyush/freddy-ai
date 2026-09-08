import { useMemo } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import Bowser from "bowser"
import { HugeiconsIcon } from "@hugeicons/react"
import { Clock01Icon, Globe02Icon, LaptopIcon } from "@hugeicons/core-free-icons"

import { getConversation } from "@workspace/api"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { DicebearAvatar } from "@workspace/ui/components/dicebear-avatar"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"
import { getCountryFlagUrl, getCountryFromTimezone } from "@/lib/country-utils"

type InfoItem = { label: string; value: React.ReactNode }
type InfoSection = {
  id: string
  icon: typeof LaptopIcon
  title: string
  items: InfoItem[]
}

export function ContactPanel() {
  const { conversationId } = useParams()

  const { data: conversation } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () =>
      getConversation(conversationId!, { baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
    enabled: Boolean(conversationId),
  })

  const meta = conversation?.visitorMeta

  const userAgentInfo = useMemo(() => {
    if (!meta?.userAgent) {
      return { browser: "Unknown", browserVersion: "", os: "Unknown", osVersion: "" }
    }
    const result = Bowser.getParser(meta.userAgent).getResult()
    return {
      browser: result.browser.name || "Unknown",
      browserVersion: result.browser.version || "",
      os: result.os.name || "Unknown",
      osVersion: result.os.version || "",
    }
  }, [meta?.userAgent])

  const countryInfo = useMemo(() => getCountryFromTimezone(meta?.timezone), [meta?.timezone])

  const sections = useMemo<InfoSection[]>(() => {
    if (!meta) return []

    return [
      {
        id: "device-info",
        icon: LaptopIcon,
        title: "Device Information",
        items: [
          {
            label: "Browser",
            value:
              userAgentInfo.browser +
              (userAgentInfo.browserVersion ? ` ${userAgentInfo.browserVersion}` : ""),
          },
          {
            label: "OS",
            value:
              userAgentInfo.os + (userAgentInfo.osVersion ? ` ${userAgentInfo.osVersion}` : ""),
          },
          ...(meta.viewportWidth && meta.viewportHeight
            ? [{ label: "Viewport", value: `${meta.viewportWidth} × ${meta.viewportHeight}` }]
            : []),
          ...(meta.currentUrl ? [{ label: "Page", value: meta.currentUrl }] : []),
          ...(meta.referrer ? [{ label: "Referrer", value: meta.referrer }] : []),
        ],
      },
      {
        id: "location-info",
        icon: Globe02Icon,
        title: "Location & Language",
        items: [
          ...(countryInfo ? [{ label: "Country", value: countryInfo.name }] : []),
          ...(meta.language ? [{ label: "Language", value: meta.language }] : []),
          ...(meta.timezone ? [{ label: "Timezone", value: meta.timezone }] : []),
        ],
      },
      {
        id: "session-details",
        icon: Clock01Icon,
        title: "Session details",
        items: conversation
          ? [{ label: "Started", value: new Date(conversation.createdAt).toLocaleString() }]
          : [],
      },
    ]
  }, [meta, userAgentInfo, countryInfo, conversation])

  if (!conversation) return null

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex flex-col gap-y-4 p-4">
        <div className="flex items-center gap-x-2">
          <DicebearAvatar
            seed={conversation.id}
            badgeImageUrl={countryInfo?.code ? getCountryFlagUrl(countryInfo.code) : undefined}
            size={42}
          />
          <div className="flex-1 overflow-hidden">
            <h4 className="line-clamp-1">{conversation.visitorName || "Visitor"}</h4>
            <p className="line-clamp-1 text-sm text-muted-foreground capitalize">
              {conversation.status}
            </p>
          </div>
        </div>
      </div>

      {sections.some((s) => s.items.length > 0) ? (
        <Accordion className="w-full rounded-none border-y" multiple defaultValue={[]}>
          {sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <AccordionItem
                key={section.id}
                value={section.id}
                className="rounded-none outline-none"
              >
                <AccordionTrigger className="flex w-full flex-1 items-start justify-between gap-4 rounded-none bg-accent px-5 py-4 text-left text-sm font-medium outline-none transition-all hover:no-underline">
                  <div className="flex items-center gap-4">
                    <HugeiconsIcon icon={section.icon} className="size-4 shrink-0" />
                    <span>{section.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-5 py-4">
                  <div className="space-y-2 text-sm">
                    {section.items.map((item) => (
                      <div className="flex justify-between gap-4" key={item.label}>
                        <span className="shrink-0 text-muted-foreground">{item.label}:</span>
                        <span className="min-w-0 truncate text-right">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      ) : null}
    </div>
  )
}
