# Monorepo & Tooling
_pnpm + Turborepo se poora freddy-ai ek hi repo mein kaise fit hota hai_

## Yeh hai kya? (What is this)

freddy-ai ek "monorepo" hai — matlab do apps (`apps/chatbot`, `apps/dashboard`) aur unke saare shared
packages (`packages/api`, `packages/backend`, `packages/rag`, `packages/ui`, `packages/widgets`) sab ek hi git
repo mein rehte hain, ek hi `pnpm install` se. **pnpm workspaces** in sabko ek dusre se link karta hai (bina
npm registry pe publish kiye), aur **Turborepo** in sab packages ke build/dev/lint/typecheck commands ko sahi
order mein aur sirf-jo-changed-hua-wahi chalata hai, taaki har baar sab kuch rebuild na ho.

## Yeh kyun banaya gaya? (Why it exists)

Widget aur dashboard dono ek hi backend se baat karte hain — agar yeh alag repos hote, to `ChatMessage` jaisa
type dono jagah copy-paste karna padta, aur backend badalne par ek app mein silently break ho jaata (runtime
mein pata chalta, compile time pe nahi). `packages/api/src/schema.ts` ke top pe comment isko seedha explain
karta hai:

```ts
/**
 * The wire contract between the widget/dashboard and the backend.
 *
 * Imported by both sides on purpose: add a field here and TypeScript breaks
 * whichever half you forgot to update, which is where this kind of code
 * usually drifts.
 */
```
`packages/api/src/schema.ts:3-9`

Yani ek hi Zod schema update hote hi backend + dono frontend apps mein TypeScript error de degi agar koi jagah
miss ho gayi — bug `pnpm typecheck` mein hi mil jaata hai, production mein nahi. Yeh sirf monorepo mein hi
seedha possible hai kyunki sab ek hi `node_modules` graph share karte hain (`workspace:*` ke through).

Deploy simplicity dusra reason hai. `render.yaml` mein backend deploy karte waqt comment hai:

```yaml
# No `rootDir`: install has to run from the workspace root so pnpm can
# resolve the `workspace:*` deps (@workspace/api, @workspace/rag) that
# packages/backend depends on — a rootDir here would install it in
# isolation and fail. `pnpm --filter` targets the backend specifically
# for the actual start command instead.
```
`render.yaml:5-9`

Backend akela deploy nahi ho sakta bina poore workspace ke install hue — yeh monorepo ka trade-off hai, jiske
against shared types/UI ka benefit hai.

## Kaise kaam karta hai (How it works, step by step)

1. **Root `package.json`** mein koi app code nahi — sirf `turbo <task>` proxy karne wale scripts aur shared
   devDependencies (`turbo`, `typescript`, `prettier`, do internal config packages). Root sirf orchestration hai.

2. **`pnpm-workspace.yaml`** batata hai `apps/*` aur `packages/*` konse folders "packages" hain:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
   `pnpm-workspace.yaml:1-3`
   `pnpm install` root se chalane par, jab bhi ek package doosre ko `"workspace:*"` version se maangta hai
   (jaise `apps/chatbot/package.json:20`'s `"@workspace/api": "workspace:*"`), pnpm usse `node_modules` mein
   ek **symlink** bana deta hai — code copy nahi, seedha `packages/api/src` folder point hota hai. Isi liye
   `packages/api` mein change karo to turant dono apps mein reflect ho jaata hai, publish/version-bump nahi
   chahiye.

3. **`turbo.json`** har task ka dependency order define karta hai:
   ```json
   "build": {
     "dependsOn": ["^build"],
     "inputs": ["$TURBO_DEFAULT$", ".env*"],
     "outputs": ["dist/**"]
   }
   ```
   `turbo.json:5-9`
   `"^build"` ka matlab "pehle mere workspace dependencies ka build chalao". Toh `apps/dashboard` build karte
   waqt Turborepo pehle `packages/api`/`packages/ui` build karega (agar zaroorat ho), phir dashboard — yeh graph
   `package.json` deps se hi derive hota hai, alag se likhna nahi padta.

4. **Caching** — `outputs: ["dist/**"]` batata hai build ka result kahan store hua. Agar koi package ke
   `inputs` last run se change nahi hue, Turborepo us package ka build skip kar deta hai aur cached output reuse
   karta hai. Isi wajah se doosri baar `turbo build` bahut fast chalta hai.

5. **`dev` task** alag hai: `"cache": false, "persistent": true` (`turbo.json:19-22`) — long-running dev servers
   (Vite, `tsx watch`) cache nahi kiye ja sakte aur kabhi khatam nahi hote, toh Turborepo bas inhe parallel start
   karke chhod deta hai. `pnpm dev` ek saath backend (`:8788`), chatbot dev harness, aur dashboard start kar
   deta hai (`README.md:20-25`).

6. **Shared UI ka real workflow**:
   ```bash
   pnpm dlx shadcn add <component> -c apps/dashboard
   ```
   `README.md:29-33`
   Command dashboard se run hota hai, par file lands hoti hai `packages/ui/src/components` mein — kyunki
   `packages/ui`'s `"exports"` field already `./components/*` ko `./src/components/*.tsx` pe map karta hai
   (`packages/ui/package.json:46-51`). Dono apps usko `@workspace/ui/components/button` jaisa import karte hain.

## Code walkthrough

- **`package.json:5-11`** — root scripts sirf `turbo <task>` proxy karte hain, koi build logic khud nahi rakhte.

- **`pnpm-workspace.yaml:4-7`** — `allowBuilds` list native/postinstall-script wale packages
  (`better-sqlite3`, `esbuild`, `sharp`) ko explicitly allow karti hai — pnpm by default postinstall scripts
  security ke liye block karta hai, yeh sirf trusted packages ke liye unblock karta hai.

- **`packages/rag/package.json:34-38`** aur **`packages/widgets/package.json:26-33`** dono multi-path
  `"exports"` use karte hain (jaise `"./types": "./src/types.ts"`) — granular imports possible hain, jaise
  `@workspace/rag/types` sirf types ke liye, poora pipeline import kiye bina.

- **`packages/backend/package.json:13-25`** — sirf yeh package `@ai-sdk/google` aur `@workspace/rag` dono depend
  karta hai; koi frontend package AI provider SDK direct depend nahi karta. Yeh guarantee hai ki API key sirf
  backend process mein hi load hoti hai.

- **`turbo.json:10-18`** — `lint`/`format`/`typecheck` bhi `dependsOn: ["^<task>"]` rakhte hain, taaki
  Turborepo inhe dependency-order mein hi chalaye aur per-package caching mile.

## Diagram

Neeche diagram (`01-monorepo-and-tooling.excalidraw`) mein repo root se do dashed boxes nikalte hain —
`apps/` (chatbot, dashboard, yellow) aur `packages/` (widgets, ui, api, backend, rag — alag colors mein).
Arrows dikhate hain kaun kisko import karta hai: chatbot teeno — widgets, ui, api — import karta hai, dashboard
sirf ui aur api. Do highlighted (red, motay) arrows `backend → api` aur `backend → rag` dikhate hain, saath ek
caption note karta hai ki backend hi akela package hai jiske paas AI provider key hai. Excalidraw.com pe
File → Open se ya canvas pe drag karke file import kar sakte ho.

## Interview questions

**Q: pnpm workspaces aur Turborepo mein kya difference hai?**
A: pnpm workspaces sirf *dependency linking* karta hai — `pnpm-workspace.yaml` padh ke `workspace:*` deps ko
symlink karta hai. Turborepo *task orchestration aur caching* karta hai — `turbo.json`'s `dependsOn: ["^build"]`
order decide karta hai, `outputs` se result cache hota hai. Ek ke bina doosra bhi chalega, bas slower aur bina
dependency-order guarantee ke.

**Q: `packages/api` ko "shared wire contract" kyun kaha jaata hai?**
A: Yeh sirf types nahi, runtime validation bhi hai — Zod schemas backend mein incoming requests validate karte
hain aur wahi schemas se derive TypeScript types dono apps compile-time pe use karte hain. Header comment khud
kehta hai: field add karo to jo bhi half update karna bhool gaye wahan TypeScript break karega (`schema.ts:3-9`)
— ek single source of truth, runtime + compile-time dono guarantees ke saath.

**Q: `packages/ui` mein prop badalne par dashboard/chatbot ko turant pata chalega?**
A: Haan, bina publish/version-bump ke — pnpm `@workspace/ui` ko dono apps ke `node_modules` mein seedha
`packages/ui/src` pe symlink karta hai (`"workspace:*"`, `apps/dashboard/package.json:21`). `tsc -b` turant type
error dega prop break hone par, aur Vite dev server hot-reload karega kyunki asli file hi import ho rahi hai.

**Q: `pnpm dlx shadcn add <component> -c apps/dashboard` chalane par component dashboard mein kyun nahi lands
hota?**
A: `-c apps/dashboard` sirf CLI ko Tailwind config/alias context batata hai; actual destination
`packages/ui`'s `"exports"` field decide karta hai (`"./components/*": "./src/components/*.tsx"`,
`packages/ui/package.json:46-51`) — CLI usi convention follow karta hai, README bhi isko explicit karta hai
(`README.md:29-33`).

**Q: `turbo dev`'s `"cache": false, "persistent": true` kyun hai jabki `build` cache hoti hai?**
A: `dev` ek never-exiting process hai (Vite dev server, `tsx watch`) jiska output deterministic nahi — cache
karna galat hoga. `persistent: true` batata hai yeh background mein chalte rehna chahiye. `build` opposite hai —
deterministic `dist/**` output jo safely cache/reuse ho sakta hai (`turbo.json:5-9, 19-22`).

**Q: Render pe backend deploy karte waqt `rootDir` kyun nahi set kiya?**
A: `packages/backend`'s `workspace:*` deps (`@workspace/api`, `@workspace/rag`) sirf tab resolve hote hain jab
poore workspace root se install ho (symlinks banane ke liye). `render.yaml`'s comment isko explicit karta hai
(`render.yaml:5-9`) — `rootDir` set karte to install isolated chalta aur deps miss ho jaate. `buildCommand` root
se install karta hai, `startCommand` `pnpm --filter @workspace/backend start` se specifically backend start
karta hai.

**Q: Agar `packages/widgets` ko `packages/backend` import karna pade, kya woh architecture break hogi?**
A: Haan — `packages/widgets`'s deps mein sirf `@workspace/ui`, `react`, `zod` hain
(`packages/widgets/package.json:10-16`), backend nahi. Yeh isko "pure render-a-tree logic" rakhta hai, jahan
bhi React chale reusable. Backend import karne se yeh guarantee toot jaayegi aur server-only code (jaise
`better-sqlite3`) browser bundle mein khinch sakta hai.

**Q: Naya `packages/analytics` (sirf backend use karega) add karna ho, kya-kya touch karna padega?**
A: `pnpm-workspace.yaml` change nahi karna (already `packages/*` match karta hai) — `package.json` bana ke
`name: "@workspace/analytics"` set karo, `packages/backend/package.json` mein
`"@workspace/analytics": "workspace:*"` add karo, phir `pnpm install` chalao symlink banane ke liye. `turbo.json`
touch nahi karna kyunki task-graph automatically deps se derive hota hai.

## Common confusions (log yahan confuse hote hain)

- `"workspace:*"` ka matlab "koi bhi version chalega" nahi hai — matlab hai "hamesha local monorepo wala version
  use karo", npm registry se kabhi resolve nahi hoga.
- `turbo.json`'s `dependsOn: ["^build"]` koi manual list nahi — `^` prefix ka matlab "workspace dependency graph
  follow karo" (package.json deps se derive), khud se package name likhna nahi padta.
- `apps/chatbot/package.json` mein `@workspace/api` dekh ke lagta hai published npm package hai jo republish
  chahiye update ke liye — actually symlinked local folder hai, edit karo aur turant reflect hoga.
- Root `package.json` mein `dependencies` na dekh ke confuse hote hain "app kaise chalega" — root sirf
  orchestration hai, real code aur deps har package ke andar hain.
