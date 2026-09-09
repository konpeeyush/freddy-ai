# Dashboard App Architecture — how the operator UI is structured
_One password, one sidebar, and four features — a complete control room for the operator._

## What is this?

`apps/dashboard` is the internal tool the support operator uses — to review customer conversations, manage the knowledge base (Files/Links), and configure the bot's personality (Settings). It's a Vite + React 19 app that manages its routes with React Router v6 and, through `packages/api`, hits the same Hono backend the widget uses.

The simplest way to think about it: the widget (`apps/chatbot`) is customer-facing — the chat bubble visible on the website. The dashboard is its "backstage" — where the operator monitors those conversations and trains/configures the bot.

## Why it exists

Backend routes like `/settings`, `/rag/ingest`, and `/conversations` are sensitive — not just anyone should be able to hit them. But there's no point building "real" multi-user auth (a login system, roles, a sessions table) here, because this project has exactly **one operator**. The code gives that reasoning itself:

```ts
// packages/backend/src/auth.ts:3-8
* A single shared password gating the dashboard's own management surface —
* not a real accounts system. This project has exactly one operator, so
* "only I can access settings" means one secret, not a users table, session
* store, or login flow.
```

In the same spirit, the gate doesn't have a dedicated `/auth/check` endpoint either — it calls a real gated route (`/settings`) instead and checks whether the request passed or returned 401. The comment spells it out (`dashboard-auth-gate.tsx:18-19`): "one fewer endpoint to keep in sync with which routes are actually protected." Meaning — if a new route were added tomorrow and someone forgot to protect it, a separate `/auth/check` endpoint would tell you nothing about whether the real routes are protected. Using a real endpoint makes that drift impossible.

The feature-folder structure (`modules/conversations`, `modules/files`, `modules/links`, `modules/settings`) comes from the same thinking — instead of one giant shared `components/` folder, each feature keeps its own views/components, so things stay close together and easy to follow as the codebase grows.

## How it works, step by step

1. **Boot sequence** — `main.tsx` wraps the app in a stack of providers: `QueryClientProvider` (TanStack Query, for server state) → `TooltipProvider` → `DashboardAuthGate` → inside it `BrowserRouter` → `App`. So the auth gate is outermost — until it unlocks, no routes render at all (`main.tsx:26-38`).

2. **The auth check runs** — as soon as `DashboardAuthGate` mounts it reads the saved password from `localStorage` (`dashboard-auth-key`), and if there is one, sets it into the `packages/api` client via `setDashboardAuthKey()`. Then it makes a real API call: `getSettings(...)`, which hits `GET /settings` (`dashboard-auth-gate.tsx:32-48`).

3. **The result decides the screen** — if the call succeeded, `status` becomes "unlocked" and `<App/>` renders. On a 401 (or any error), the saved key is cleared and the "locked" state shows — a simple password form.

4. **Submitting the password** — on form submit, `setDashboardAuthKey(password)` is called first (optimistically), then `getSettings()` is tried. On success the password is saved to `localStorage` and it unlocks; on failure the key goes back to `null` and a "Wrong password" error shows (`dashboard-auth-gate.tsx:50-66`).

5. **Every subsequent request carries the auth** — the `packages/api` client holds a module-level `dashboardAuthKey` variable. `withAuthHeader()` attaches an `x-dashboard-key` header to every request whenever the key is set (`packages/api/src/client.ts:307-316`). On the backend side, the `requireDashboardAuth` middleware compares that header against the `DASHBOARD_PASSWORD` env var (`packages/backend/src/auth.ts:24-32`).

6. **Routing after unlock** — in `App.tsx` all routes are nested inside a single `<DashboardLayout>`, which renders the sidebar (`DashboardSidebar`) and the child route via `<Outlet/>`. `/` → redirects to `/conversations`; `/conversations` is a layout containing an index route (the empty state) and `/conversations/:conversationId` (the actual chat view); `/files`, `/links`, and `/settings` are flat top-level routes; and any unknown path `*` redirects back to `/conversations` (`App.tsx:23-42`).

7. **Sidebar navigation** — `DashboardSidebar` renders a static list (`customerSupportItems`) — Conversations, Knowledge Base, Links, Settings — each a `NavLink` that matches the current path to show its active state (`dashboard-sidebar.tsx:27-32, 37`).

## Code walkthrough

- **`apps/dashboard/src/App.tsx:23-42`** — the entire route tree in one `<Routes>` block, all nested inside `<DashboardLayout>`. `ConversationIdRoute` is a helper component that pulls `conversationId` out of `useParams()` and falls back to the empty view if it's missing:
  ```tsx
  function ConversationIdRoute() {
    const { conversationId } = useParams()
    if (!conversationId) return <ConversationsEmptyView />
    ...
  }
  ```

- **`apps/dashboard/src/components/dashboard-auth-gate.tsx:26-48`** — the whole gate logic. Three states: `"checking"` (the API call is still pending and nothing renders — `status === "checking"` returns `null`, line 68), `"locked"`, and `"unlocked"`.

- **`packages/backend/src/auth.ts:24-32`** — the server-side middleware that actually checks the password:
  ```ts
  export const requireDashboardAuth = createMiddleware(async (c, next) => {
    if (!DASHBOARD_PASSWORD) return next()
    const provided = c.req.header("x-dashboard-key")
    if (provided !== DASHBOARD_PASSWORD) {
      return c.json({ error: "unauthorized", retryable: false }, 401)
    }
    return next()
  })
  ```
  Line 25 is the important edge case — if `DASHBOARD_PASSWORD` isn't set at all, the middleware calls `next()` straight through without checking any header.

- **`apps/dashboard/src/lib/api.ts:5-11`** — `API_BASE_URL` and `TENANT_ID` are centralized, so switching the backend origin or the tenant is a one-place change rather than a find-and-replace across the codebase.

- **`apps/dashboard/src/components/dashboard-layout.tsx:7-16`** — the layout is just `SidebarProvider` + `DashboardSidebar` + `<Outlet/>`. It's the common shell for every route — the sidebar stays visible, only the middle content changes.

- **`apps/dashboard/src/main.tsx:15-24`** — the `QueryClient`'s `refetchOnWindowFocus: false` — the comment notes that every list/detail query already re-polls on its own interval, so a global window-focus refetch would be redundant.

## Diagram

The diagram (`05-dashboard-app-architecture.excalidraw`) shows that when the browser loads the dashboard, the first thing is a `DashboardAuthGate` decision diamond — "saved password + GET /settings succeeds?" — splitting into two paths: to the left/top "Locked (password form)" (failure or no password), and to the right/bottom "Unlocked → App routes". From the unlocked side, an arrow leads to `DashboardLayout` (the sidebar wrapper), under which sits a small route tree — a `/` → redirect → `/conversations` box, from which two smaller boxes branch: index (empty state) and `/:conversationId`; plus three separate flat routes — `/files`, `/links`, `/settings`. All of them live inside `DashboardLayout`, which is why the diagram groups them inside one large "DashboardLayout (sidebar)" container. Read the diagram top to bottom: entry point, auth check, decision, two outcomes, and the route tree on the unlocked side.

Shapes: 1 title text, a "Browser loads /dashboard" box, a "DashboardAuthGate" diamond, a "Locked: password form" box (red), an "Unlocked" box (green) leading into a "DashboardLayout (sidebar)" container box, and beneath it 5 route boxes (`/conversations`, index, `:conversationId`, `/files`+`/links`+`/settings` grouped, and `*` → redirect).

## Interview questions

**Q: Why is there no login system in the dashboard — no email/password accounts table?**
A: Because only one operator uses the dashboard in this product — there's no need for multi-user roles or permissions. The comment in `packages/backend/src/auth.ts` says it explicitly: one shared secret is enough; a users table, session store, and login flow would be over-engineering at this scale.

**Q: How does `DashboardAuthGate` verify the password — is there an `/auth/check` endpoint?**
A: No. It directly calls a real gated endpoint, `GET /settings`, and sees whether it succeeds or returns 401. That way there's no dedicated auth-check endpoint to maintain and separately keep in sync with which routes are actually protected — the real route becomes the source of truth.

**Q: What happens if the `DASHBOARD_PASSWORD` env var isn't set on the backend?**
A: The `requireDashboardAuth` middleware (`packages/backend/src/auth.ts:25`) calls `next()` straight through without checking any header. So the frontend's first unauthenticated `GET /settings` call succeeds with no key at all, and the gate goes straight to "unlocked" — in local dev this effectively makes auth a no-op, which is intentional.

**Q: Where is the password stored, and how does it persist across reloads?**
A: In `localStorage` under the key `"dashboard-auth-key"` (`dashboard-auth-gate.tsx:11`). On a page reload the `useEffect` reads it, sets it into the `packages/api` client via `setDashboardAuthKey()`, and then calls `/settings` to verify it.

**Q: Who attaches the `x-dashboard-key` header to every request, and how?**
A: `packages/api/src/client.ts` holds a module-level `dashboardAuthKey` variable. The `withAuthHeader()` helper merges that header into every request's `init.headers` whenever the key is non-null (`client.ts:313-316`). The widget never calls `setDashboardAuthKey()`, so for it the key is always `null` and the header is never attached.

**Q: How are the routes organized — all in one file or spread out?**
A: The whole route tree is defined in one place in `App.tsx`, but each route's actual component is imported from its own `modules/<feature>/` folder (e.g. `modules/conversations/conversations-layout.tsx`). That's the feature-folder pattern — route wiring is central, but the implementation is colocated with the feature.

**Q: If you had to add a new protected route (say `/analytics`), what would the steps be?**
A: On the backend, define a new Hono route with the `requireDashboardAuth` middleware (like the existing `/settings` routes). On the frontend, add a new `<Route path="/analytics" element={<AnalyticsView/>}/>` inside `<DashboardLayout>` in `App.tsx`, and create a `modules/analytics/` folder following the pattern. You'd also add an entry to `dashboard-sidebar.tsx`'s `customerSupportItems` array.

**Q: When does this auth approach break — name a weakness.**
A: The biggest one: if someone forgets to add the `requireDashboardAuth` middleware when creating a backend route, that route stays silently unprotected — and the `/settings`-based check won't detect it, because `/settings` itself is protected while the other route isn't. A second edge case: if `DASHBOARD_PASSWORD` is accidentally left unset in production, the entire dashboard becomes publicly accessible with no password — there's no hard failure or warning; it just silently opens up.

**Q: Why does `DashboardAuthGate` return `null` while `status === "checking"` instead of showing a loading spinner?**
A: It's a deliberate simplification — nothing flashes before verification completes (neither the locked form nor the app), which avoids the "flash of locked screen before actually being unlocked" UX glitch. The trade-off is that the user may see a brief blank screen if the `/settings` call is slow.

## Common confusions

- People assume `DashboardAuthGate` is a proper auth system with tokens/sessions — it's really just a shared password header; there's no JWT or session cookie anywhere.
- `ConversationsLayout` and `DashboardLayout` get mixed up — `DashboardLayout` is outermost (the sidebar wrapper, for every route), while `ConversationsLayout` only lives inside `/conversations/*` (the conversations list panel + detail view split).
- People assume the widget is protected by this password too — it isn't; the widget (`apps/chatbot`) never calls `setDashboardAuthKey`, and the `/chat` route is separate and not gated.
- The password is stored in `localStorage` in plaintext — some call this "insecure", but in a single-operator internal-tool context it's a deliberate trade-off, not an oversight.
