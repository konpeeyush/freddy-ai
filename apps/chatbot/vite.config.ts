import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * Rewrites bare dev routes (/floating, /inline, …) to the harness entry so the
 * dev server can serve them. Vite has no SPA history fallback for a non-root
 * html entry, and a real customer never sees these paths — they exist only for
 * `pnpm dev`.
 */
function devRoutes(): Plugin {
  const routes = [
    "/floating",
    "/inline",
    "/fullscreen",
    "/hostile",
    "/playground",
    "/rag",
  ]
  return {
    name: "widget-dev-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = (req.url ?? "").split("?")[0] ?? ""
        const url = raw.length > 1 ? raw.replace(/\/+$/, "") : raw
        if (url === "/" || routes.includes(url)) {
          req.url = "/dev/index.html"
        }
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), devRoutes()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // Only the library build inlines NODE_ENV; the dev server needs development
  // mode for React's warnings and fast refresh.
  ...(command === "build"
    ? { define: { "process.env.NODE_ENV": JSON.stringify("production") } }
    : {}),
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    // Library build: one self-contained IIFE that customers drop in via
    // <script>. React is bundled in (not externalised) — the host page must
    // not need it.
    lib: {
      entry: path.resolve(import.meta.dirname, "src/index.ts"),
      // Internal only. The public API is assigned to window.FreddyChat in
      // src/index.ts — an IIFE `name` matching it would clobber that with the
      // module's export object.
      name: "__FreddyChatBundle",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    // CSS is imported with ?inline and injected into the shadow root,
    // so no separate stylesheet should be emitted.
    cssCodeSplit: false,
    emptyOutDir: true,
  },
}))
