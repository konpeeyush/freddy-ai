import "@workspace/ui/globals.css"
import "@claykit/react/styles.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router-dom"
import { Toaster } from "sonner"

import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { App } from "./App"
import { DashboardAuthGate } from "./components/dashboard-auth-gate"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every list/detail query here re-polls on its own interval — a global
      // refetch-on-focus on top of that is redundant, not additive.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DashboardAuthGate>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </DashboardAuthGate>
        <Toaster position="top-right" richColors theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
)
