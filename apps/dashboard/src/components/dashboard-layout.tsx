import { Outlet } from "react-router-dom"

import { SidebarProvider } from "@workspace/ui/components/sidebar"

import { DashboardSidebar } from "./dashboard-sidebar"

export function DashboardLayout() {
  return (
    <SidebarProvider>
      <DashboardSidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </SidebarProvider>
  )
}
