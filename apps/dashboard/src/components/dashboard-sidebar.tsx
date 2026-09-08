import { NavLink, useLocation } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Globe02Icon,
  InboxIcon,
  LibraryIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"

import { FreddyLogo } from "./freddy-logo"

const customerSupportItems = [
  { title: "Conversations", url: "/conversations", icon: InboxIcon },
  { title: "Knowledge Base", url: "/files", icon: LibraryIcon },
  { title: "Links", url: "/links", icon: Globe02Icon },
  { title: "Settings", url: "/settings", icon: Settings02Icon },
]

export function DashboardSidebar() {
  const location = useLocation()
  const { state } = useSidebar()
  const isActive = (url: string) => location.pathname.startsWith(url)

  return (
    <Sidebar className="group" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between gap-2 py-1.5 pl-1 pr-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              {/*
                `shrink-0` here, not just on the logo itself: the collapsed
                rail only has 32px to give this row (48px rail − SidebarHeader's
                own p-2), and without it this wrapper's default flex-shrink
                would squeeze the logo well below its intended size — the
                avatar canvas has its own `max-width: 100%`, so it dutifully
                shrinks to whatever space it's left with.
              */}
              <div className="flex min-w-0 shrink-0 items-center gap-3">
                <FreddyLogo
                  size={state === "collapsed" ? 32 : 64}
                  className="shrink-0"
                />
                <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-lg font-bold">Freddy</p>
                </div>
              </div>
              <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:hidden" />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {customerSupportItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive(item.url)}
                    render={<NavLink to={item.url} />}
                    className={cn(
                      isActive(item.url) &&
                        "bg-sidebar-primary! text-sidebar-primary-foreground!"
                    )}
                  >
                    <HugeiconsIcon icon={item.icon} size={16} />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
