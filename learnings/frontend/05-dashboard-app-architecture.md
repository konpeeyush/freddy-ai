# Dashboard App Architecture — Operator UI ka structure
_Ek password, ek sidebar, aur chaar features — operator ke liye poora control room._

## Yeh hai kya? (What is this)

`apps/dashboard` woh internal tool hai jo support operator use karta hai — customer conversations dekhne ke liye, knowledge base (Files/Links) manage karne ke liye, aur bot ki personality (Settings) configure karne ke liye. Yeh ek Vite + React 19 app hai jo React Router v6 se apne routes manage karta hai, aur `packages/api` ke through wahi Hono backend hit karta hai jise widget bhi use karta hai.

Isse simple tareeke se socho: widget (`apps/chatbot`) customer-facing hai — wahi chat bubble jo website pe dikhta hai. Dashboard uska "backstage" hai — jahan se operator un conversations ko monitor karta hai aur bot ko train/configure karta hai.

## Yeh kyun banaya gaya? (Why it exists)

Backend ke `/settings`, `/rag/ingest`, `/conversations` jaise routes sensitive hai — koi bhi random banda inhe hit nahi kar sakta. Lekin ismein "real" multi-user auth (login system, roles, sessions table) banane ka koi matlab nahi hai, kyunki is project mein sirf **ek hi operator** hota hai. Code khud yeh reasoning deta hai:

```ts
// packages/backend/src/auth.ts:3-8
* A single shared password gating the dashboard's own management surface —
* not a real accounts system. This project has exactly one operator, so
* "only I can access settings" means one secret, not a users table, session
* store, or login flow.
```

Isi tarah, gate ne ek dedicated `/auth/check` endpoint bhi nahi banaya — wo instead ek real gated route (`/settings`) hi call karke check karta hai ki request pass hui ya 401 aayi. Comment mein saaf likha hai (`dashboard-auth-gate.tsx:18-19`): "one fewer endpoint to keep in sync with which routes are actually protected." Matlab — agar kal koi naya route add hua aur usko protect karna bhool gaye, ek alag `/auth/check` endpoint se pata nahi chalta ki asli routes protect hain ya nahi. Real endpoint use karne se yeh drift hi nahi ho sakta.

Feature-folder structure (`modules/conversations`, `modules/files`, `modules/links`, `modules/settings`) bhi isi soch se aata hai — ek giant shared `components/` folder ke bajaye, har feature apna khud ka views/components rakhta hai, taaki codebase badhne pe bhi cheezein close-by aur samajhne mein easy rahein.

## Kaise kaam karta hai (How it works, step by step)

1. **Boot sequence** — `main.tsx` app ko providers ke stack mein wrap karta hai: `QueryClientProvider` (TanStack Query, server state ke liye) → `TooltipProvider` → `DashboardAuthGate` → uske andar `BrowserRouter` → `App`. Matlab auth gate sabse bahar hai — jab tak unlock nahi hota, routes render hi nahi hote (`main.tsx:26-38`).

2. **Auth check hota hai** — `DashboardAuthGate` mount hote hi `localStorage` se saved password (`dashboard-auth-key`) uthata hai, agar mila to `setDashboardAuthKey()` se `packages/api` client mein set kar deta hai. Fir woh ek real API call karta hai: `getSettings(...)` — yeh `GET /settings` hit karta hai (`dashboard-auth-gate.tsx:32-48`).

3. **Result decide karta hai screen** — agar call succeed hua, `status` "unlocked" ban jaata hai aur `<App/>` render hota hai. Agar 401 (ya koi bhi error) aaya, saved key clear ho jaati hai aur "locked" state dikhta hai — ek simple password form.

4. **Password submit karna** — form submit pe pehle hi `setDashboardAuthKey(password)` call ho jaata hai (optimistically), fir `getSettings()` try hota hai. Success pe password `localStorage` mein save hota hai aur unlock ho jaata hai; fail pe key wapas `null` ho jaati hai aur "Wrong password" error dikhta hai (`dashboard-auth-gate.tsx:50-66`).

5. **Har future request auth carry karta hai** — `packages/api`'s client ek module-level `dashboardAuthKey` variable rakhta hai. `withAuthHeader()` har request pe `x-dashboard-key` header attach kar deta hai jab bhi key set hoti hai (`packages/api/src/client.ts:307-316`). Backend side pe `requireDashboardAuth` middleware isi header ko `DASHBOARD_PASSWORD` env var se compare karta hai (`packages/backend/src/auth.ts:24-32`).

6. **Unlock hone ke baad routing** — `App.tsx` mein sab routes ek hi `<DashboardLayout>` ke andar nested hain, jo sidebar (`DashboardSidebar`) render karta hai aur `<Outlet/>` se child route render karta hai. `/` → redirect to `/conversations`; `/conversations` ek layout hai jiske andar index route (empty state) aur `/conversations/:conversationId` (actual chat view) hai; `/files`, `/links`, `/settings` flat top-level routes hain; koi bhi unknown path `*` wapas `/conversations` pe redirect ho jaata hai (`App.tsx:23-42`).

7. **Sidebar navigation** — `DashboardSidebar` ek static list (`customerSupportItems`) render karta hai — Conversations, Knowledge Base, Links, Settings — har ek `NavLink` hai jo current path se match karke active state dikhata hai (`dashboard-sidebar.tsx:27-32, 37`).

## Code walkthrough

- **`apps/dashboard/src/App.tsx:23-42`** — poora route tree ek `<Routes>` block mein, sab `<DashboardLayout>` ke andar nested. `ConversationIdRoute` ek helper component hai jo `useParams()` se `conversationId` nikalta hai aur agar missing ho to empty view fallback dikhata hai:
  ```tsx
  function ConversationIdRoute() {
    const { conversationId } = useParams()
    if (!conversationId) return <ConversationsEmptyView />
    ...
  }
  ```

- **`apps/dashboard/src/components/dashboard-auth-gate.tsx:26-48`** — poora gate logic. Teen states: `"checking"` (abhi API call pending hai, kuch render nahi hota — `status === "checking"` pe `null` return hota hai, line 68), `"locked"`, `"unlocked"`.

- **`packages/backend/src/auth.ts:24-32`** — server-side middleware jo actually password check karta hai:
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
  Line 25 hi wo important edge case hai — agar `DASHBOARD_PASSWORD` set hi nahi hai, middleware seedha `next()` call kar deta hai, bina header check kiye.

- **`apps/dashboard/src/lib/api.ts:5-11`** — `API_BASE_URL` aur `TENANT_ID` centralize kiye gaye hain, taaki backend origin ya tenant switch karna ek jagah ka change ho, poori codebase mein find-replace na karna pade.

- **`apps/dashboard/src/components/dashboard-layout.tsx:7-16`** — layout sirf `SidebarProvider` + `DashboardSidebar` + `<Outlet/>` hai. Yeh saare routes ka common shell hai — sidebar hamesha visible rehta hai, sirf beech ka content badalta hai.

- **`apps/dashboard/src/main.tsx:15-24`** — `QueryClient` ka `refetchOnWindowFocus: false` — comment batata hai ki har list/detail query already apne interval pe re-poll karti hai, isliye ek global window-focus refetch redundant hi hoga.

## Diagram

Neel diagram (`05-dashboard-app-architecture.excalidraw`) mein dikhaya gaya hai ki browser dashboard load karta hai to sabse pehle `DashboardAuthGate` ek decision diamond hai — "saved password + GET /settings succeeds?" — jo do raaston mein split hoti hai: left/upar "Locked (password form)" (fail ya no password), aur right/neeche "Unlocked → App routes". Unlocked wale side se ek arrow jaata hai `DashboardLayout` (sidebar wrapper) tak, jiske neeche ek chhota route tree hai — `/` → redirect → `/conversations` box, jisse do chote boxes nikalte hain: index (empty state) aur `/:conversationId`; aur teen alag flat routes — `/files`, `/links`, `/settings` — sab `DashboardLayout` ke andar hi hain, isiliye diagram mein woh saare ek bade "DashboardLayout (sidebar)" container ke andar group kiye gaye hain. Diagram ko upar se neeche padho: entry point se auth check, phir decision, phir do outcomes, aur unlocked wale side pe route tree.

Shapes: 1 title text, "Browser loads /dashboard" box, "DashboardAuthGate" diamond, "Locked: password form" box (red), "Unlocked" box (green) leading into a "DashboardLayout (sidebar)" container box, aur uske neeche 5 route boxes (`/conversations`, index, `:conversationId`, `/files`+`/links`+`/settings` grouped, `*` → redirect).

## Interview questions

**Q: Dashboard mein login system kyun nahi hai — koi email/password accounts table nahi?**
A: Kyunki is product mein sirf ek operator use karta hai dashboard ko — koi multi-user roles ya permissions ki zaroorat nahi hai. `packages/backend/src/auth.ts` ke comment mein yeh explicitly likha hai: ek shared secret hi kaafi hai, users table/session store/login flow banana over-engineering hoga is scale pe.

**Q: `DashboardAuthGate` password verify kaise karta hai — koi `/auth/check` endpoint hai?**
A: Nahi. Woh directly ek real gated endpoint, `GET /settings`, call karta hai aur dekhta hai ki success aata hai ya 401. Isse ek dedicated auth-check endpoint maintain nahi karna padta jo separately track kare ki kaunse routes actually protected hain — real route hi source of truth ban jaata hai.

**Q: Agar backend pe `DASHBOARD_PASSWORD` env var set nahi hai to kya hoga?**
A: `requireDashboardAuth` middleware (`packages/backend/src/auth.ts:25`) seedha `next()` call kar deta hai bina koi header check kiye. Toh frontend ka bhi pehla unauthenticated `GET /settings` call bina kisi key ke hi succeed ho jaayega, aur gate seedha "unlocked" ho jaayega — local dev mein yeh effectively auth ko no-op bana deta hai, jo intentional hai.

**Q: Password kahan store hota hai aur kaise persist hota hai across reloads?**
A: `localStorage` mein key `"dashboard-auth-key"` ke naam se (`dashboard-auth-gate.tsx:11`). Page reload pe `useEffect` yeh value uthata hai, `setDashboardAuthKey()` se `packages/api` client mein set karta hai, fir verify karne ke liye `/settings` call karta hai.

**Q: `x-dashboard-key` header kaun attach karta hai har request pe, aur kaise?**
A: `packages/api/src/client.ts` mein ek module-level variable `dashboardAuthKey` hai. `withAuthHeader()` helper har request ke `init.headers` mein yeh header merge kar deta hai jab bhi key non-null ho (`client.ts:313-316`). Widget kabhi `setDashboardAuthKey()` call hi nahi karta, isliye uske liye yeh hamesha `null` rehta hai aur header attach hi nahi hota.

**Q: Routes ka structure kaise organize hai — sab ek file mein hai ya spread hai?**
A: `App.tsx` mein poora route tree ek jagah define hai, lekin har route ka actual component uske apne `modules/<feature>/` folder se import hota hai (jaise `modules/conversations/conversations-layout.tsx`). Yeh feature-folder pattern hai — route wiring central hai but implementation feature ke saath colocated hai.

**Q: Agar tumhe ek naya protected route add karna ho (jaise `/analytics`), kya steps honge?**
A: Backend pe naya Hono route `requireDashboardAuth` middleware ke saath define karna hoga (jaise existing `/settings` routes). Frontend pe `App.tsx` mein `<DashboardLayout>` ke andar naya `<Route path="/analytics" element={<AnalyticsView/>}/>` add karna hoga, aur `modules/analytics/` folder banana hoga is pattern ko follow karte hue. Sidebar mein bhi `dashboard-sidebar.tsx`'s `customerSupportItems` array mein ek entry add karni hogi.

**Q: Yeh auth approach kab break hoga — koi weakness batao.**
A: Sabse badi weakness: agar koi backend route banate waqt `requireDashboardAuth` middleware add karna bhool jaaye, wo route silently unprotected reh jaayega — aur `/settings`-based check se yeh detect nahi hoga kyunki `/settings` khud protected hai, doosre routes nahi. Doosra edge case: agar `DASHBOARD_PASSWORD` production mein bhool se set nahi kiya, poora dashboard bina password ke publicly accessible ho jaata hai — koi hard failure/warning nahi aata, silently open ho jaata hai.

**Q: `DashboardAuthGate` mein `status === "checking"` pe `null` kyun return hota hai, loading spinner kyun nahi?**
A: Yeh ek deliberate simplification hai — verify hone tak kuch bhi flash nahi hota (na locked form na app), jisse "flash of locked screen before actually being unlocked" jaisa UX glitch avoid hota hai. Trade-off yeh hai ki user ko thoda blank screen dikh sakta hai agar `/settings` call slow ho.

## Common confusions (log yahan confuse hote hain)

- Log sochte hain `DashboardAuthGate` ek proper auth system hai with tokens/sessions — actually yeh sirf ek shared password header hai, JWT ya session cookie kuch bhi nahi hai.
- `ConversationsLayout` aur `DashboardLayout` mein confuse ho jaate hain — `DashboardLayout` sabse bahar (sidebar wrapper, sab routes ke liye), `ConversationsLayout` sirf `/conversations/*` ke andar hai (conversations list panel + detail view split).
- Log assume karte hain widget bhi isi password se protected hoga — nahi, widget (`apps/chatbot`) kabhi `setDashboardAuthKey` call hi nahi karta, `/chat` route alag hai aur gated nahi hai.
- `localStorage` mein password plaintext store hota hai — kuch log isse "insecure" bolte hain, lekin single-operator, internal-tool context mein yeh deliberate trade-off hai, not an oversight.
