import { NavLink, useLocation } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { InboxIcon, LibraryIcon } from "@hugeicons/core-free-icons"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"

import { FreddyLogo } from "./freddy-logo"

const customerSupportItems = [
  { title: "Conversations", url: "/conversations", icon: InboxIcon },
  { title: "Knowledge Base", url: "/files", icon: LibraryIcon },
]

export function DashboardSidebar() {
  const location = useLocation()
  const isActive = (url: string) => location.pathname.startsWith(url)

  return (
    <Sidebar className="group" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between gap-2 py-1.5 pl-1 pr-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="flex min-w-0 items-center gap-3">
                <FreddyLogo size={40} className="shrink-0" />
                <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-lg font-bold tracking-wide uppercase">
                    freddy-ai
                  </p>
                  <p className="truncate text-xs text-sidebar-foreground/50">
                    Support dashboard
                  </p>
                </div>
              </div>
              <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:hidden" />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-xs text-sidebar-foreground/50 uppercase">
            Customer Support
          </SidebarGroupLabel>
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
