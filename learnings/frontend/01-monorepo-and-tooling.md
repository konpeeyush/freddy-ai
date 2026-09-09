# Monorepo & Tooling
_How pnpm + Turborepo fit all of freddy-ai into a single repo_

## What is this?

freddy-ai is a "monorepo" — meaning both apps (`apps/chatbot`, `apps/dashboard`) and all their shared
packages (`packages/api`, `packages/backend`, `packages/rag`, `packages/ui`, `packages/widgets`) live in one git
repo, installed with a single `pnpm install`. **pnpm workspaces** links them all to each other (without
publishing anything to the npm registry), and **Turborepo** runs each package's build/dev/lint/typecheck
commands in the right order and only for what actually changed, so nothing gets rebuilt needlessly.

## Why it exists

The widget and the dashboard both talk to the same backend — if they lived in separate repos, a type like
`ChatMessage` would have to be copy-pasted into both, and a backend change would silently break one of the apps
(discovered at runtime, not at compile time). The comment at the top of `packages/api/src/schema.ts` says this
outright:

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

So the moment a single Zod schema is updated, TypeScript errors show up in the backend and both frontend apps if
any place was missed — the bug surfaces in `pnpm typecheck`, not in production. This is only directly possible in
a monorepo, because everything shares one `node_modules` graph (via `workspace:*`).

Deploy simplicity is the second reason. `render.yaml` has this comment on the backend deploy:

```yaml
# No `rootDir`: install has to run from the workspace root so pnpm can
# resolve the `workspace:*` deps (@workspace/api, @workspace/rag) that
# packages/backend depends on — a rootDir here would install it in
# isolation and fail. `pnpm --filter` targets the backend specifically
# for the actual start command instead.
```
`render.yaml:5-9`

The backend can't be deployed on its own without the whole workspace being installed — that's the monorepo's
trade-off, weighed against the benefit of shared types and UI.

## How it works, step by step

1. **The root `package.json`** contains no app code — just scripts that proxy to `turbo <task>` and shared
   devDependencies (`turbo`, `typescript`, `prettier`, two internal config packages). The root is orchestration only.

2. **`pnpm-workspace.yaml`** declares which folders count as "packages" — `apps/*` and `packages/*`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
   `pnpm-workspace.yaml:1-3`
   When you run `pnpm install` from the root, any time one package asks for another with a `"workspace:*"`
   version (like `apps/chatbot/package.json:20`'s `"@workspace/api": "workspace:*"`), pnpm creates a
   **symlink** for it in `node_modules` — no code is copied, it points straight at the `packages/api/src`
   folder. That's why a change in `packages/api` shows up in both apps immediately, with no publish or
   version bump needed.

3. **`turbo.json`** defines the dependency order for each task:
   ```json
   "build": {
     "dependsOn": ["^build"],
     "inputs": ["$TURBO_DEFAULT$", ".env*"],
     "outputs": ["dist/**"]
   }
   ```
   `turbo.json:5-9`
   `"^build"` means "run my workspace dependencies' build first". So when building `apps/dashboard`, Turborepo
   builds `packages/api`/`packages/ui` first (if needed), then the dashboard — and that graph is derived from
   the `package.json` deps, so it never has to be written out by hand.

4. **Caching** — `outputs: ["dist/**"]` tells Turborepo where a build's result was stored. If a package's
   `inputs` haven't changed since the last run, Turborepo skips that package's build and reuses the cached
   output. That's why the second `turbo build` runs so much faster.

5. **The `dev` task is different**: `"cache": false, "persistent": true` (`turbo.json:19-22`) — long-running dev
   servers (Vite, `tsx watch`) can't be cached and never exit, so Turborepo just starts them in parallel and
   leaves them running. `pnpm dev` brings up the backend (`:8788`), the chatbot dev harness, and the dashboard
   all at once (`README.md:20-25`).

6. **The real shared-UI workflow**:
   ```bash
   pnpm dlx shadcn add <component> -c apps/dashboard
   ```
   `README.md:29-33`
   The command runs from the dashboard, but the file lands in `packages/ui/src/components` — because
   `packages/ui`'s `"exports"` field already maps `./components/*` to `./src/components/*.tsx`
   (`packages/ui/package.json:46-51`). Both apps then import it as `@workspace/ui/components/button`.

## Code walkthrough

- **`package.json:5-11`** — the root scripts only proxy to `turbo <task>`; they hold no build logic of their own.

- **`pnpm-workspace.yaml:4-7`** — the `allowBuilds` list explicitly permits packages with native/postinstall
  scripts (`better-sqlite3`, `esbuild`, `sharp`) — pnpm blocks postinstall scripts by default for security, and
  this unblocks them only for trusted packages.

- **`packages/rag/package.json:34-38`** and **`packages/widgets/package.json:26-33`** both use multi-path
  `"exports"` (like `"./types": "./src/types.ts"`) — which makes granular imports possible, e.g.
  `@workspace/rag/types` for types alone, without importing the whole pipeline.

- **`packages/backend/package.json:13-25`** — this is the only package that depends on both `@ai-sdk/google` and
  `@workspace/rag`; no frontend package depends on an AI provider SDK directly. That's the guarantee that the
  API key is only ever loaded in the backend process.

- **`turbo.json:10-18`** — `lint`/`format`/`typecheck` also carry `dependsOn: ["^<task>"]`, so Turborepo runs
  them in dependency order and per-package caching applies.

## Diagram

In the diagram below (`01-monorepo-and-tooling.excalidraw`), two dashed boxes branch off the repo root —
`apps/` (chatbot, dashboard, in yellow) and `packages/` (widgets, ui, api, backend, rag — in different colors).
Arrows show who imports whom: the chatbot imports all three of widgets, ui, and api; the dashboard imports only
ui and api. Two highlighted (red, thick) arrows show `backend → api` and `backend → rag`, with a caption noting
that the backend is the only package holding an AI provider key. You can import the file on excalidraw.com via
File → Open, or by dragging it onto the canvas.

## Interview questions

**Q: What's the difference between pnpm workspaces and Turborepo?**
A: pnpm workspaces only handles *dependency linking* — it reads `pnpm-workspace.yaml` and symlinks `workspace:*`
deps. Turborepo handles *task orchestration and caching* — `turbo.json`'s `dependsOn: ["^build"]` decides the
order, and `outputs` caches the result. Either works without the other, just slower and with no dependency-order
guarantee.

**Q: Why is `packages/api` called the "shared wire contract"?**
A: It isn't only types — it's runtime validation too. The Zod schemas validate incoming requests in the backend,
and the TypeScript types derived from those same schemas are used by both apps at compile time. The header
comment says it itself: add a field and TypeScript breaks whichever half you forgot to update (`schema.ts:3-9`)
— one single source of truth, with both runtime and compile-time guarantees.

**Q: If a prop changes in `packages/ui`, do the dashboard and chatbot find out immediately?**
A: Yes, with no publish or version bump — pnpm symlinks `@workspace/ui` in both apps' `node_modules` straight to
`packages/ui/src` (`"workspace:*"`, `apps/dashboard/package.json:21`). `tsc -b` reports a type error immediately
when a prop breaks, and the Vite dev server hot-reloads because it's importing the real file.

**Q: Why doesn't the component land in the dashboard when you run
`pnpm dlx shadcn add <component> -c apps/dashboard`?**
A: `-c apps/dashboard` only tells the CLI which Tailwind config/alias context to use; the actual destination is
decided by `packages/ui`'s `"exports"` field (`"./components/*": "./src/components/*.tsx"`,
`packages/ui/package.json:46-51`) — the CLI follows that convention, and the README makes it explicit too
(`README.md:29-33`).

**Q: Why is `turbo dev` set to `"cache": false, "persistent": true` when `build` is cached?**
A: `dev` is a never-exiting process (Vite dev server, `tsx watch`) whose output isn't deterministic — caching it
would be wrong. `persistent: true` says it should keep running in the background. `build` is the opposite —
deterministic `dist/**` output that can safely be cached and reused (`turbo.json:5-9, 19-22`).

**Q: Why isn't `rootDir` set when deploying the backend on Render?**
A: `packages/backend`'s `workspace:*` deps (`@workspace/api`, `@workspace/rag`) only resolve when the install
runs from the full workspace root (so the symlinks get created). `render.yaml`'s comment makes this explicit
(`render.yaml:5-9`) — setting `rootDir` would install it in isolation and the deps would be missing. The
`buildCommand` installs from the root, and the `startCommand` starts the backend specifically with
`pnpm --filter @workspace/backend start`.

**Q: If `packages/backend` had to import `packages/widgets`, would that break the architecture?**
A: Yes — `packages/widgets`'s deps are only `@workspace/ui`, `react`, and `zod`
(`packages/widgets/package.json:10-16`), not the backend. That keeps it "pure render-a-tree logic", reusable
anywhere React runs. Importing the backend would break that guarantee and could pull server-only code (like
`better-sqlite3`) into the browser bundle.

**Q: To add a new `packages/analytics` (used only by the backend), what would you have to touch?**
A: Not `pnpm-workspace.yaml` (it already matches `packages/*`) — create a `package.json` with
`name: "@workspace/analytics"`, add `"@workspace/analytics": "workspace:*"` to
`packages/backend/package.json`, then run `pnpm install` to create the symlink. You don't touch `turbo.json`,
because the task graph is derived automatically from the deps.

## Common confusions

- `"workspace:*"` doesn't mean "any version will do" — it means "always use the local monorepo version"; it will
  never resolve from the npm registry.
- `turbo.json`'s `dependsOn: ["^build"]` isn't a manual list — the `^` prefix means "follow the workspace
  dependency graph" (derived from package.json deps), so you never have to write package names yourself.
- Seeing `@workspace/api` in `apps/chatbot/package.json` makes it look like a published npm package that needs a
  republish to update — it's actually a symlinked local folder; edit it and the change shows up immediately.
- People get confused by the lack of `dependencies` in the root `package.json` and wonder "how does the app even
  run" — the root is orchestration only; the real code and deps live inside each package.
