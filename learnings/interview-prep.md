# Freddy AI — Interview Prep
_Saare 10 topics ke interview questions ek jagah — grouped by topic, near-duplicates merged, taaki revise karte waqt scroll kam karna pade._

## Frontend

### Monorepo & Tooling ([full doc](frontend/01-monorepo-and-tooling.md))

**Q: pnpm workspaces aur Turborepo mein kya difference hai?**
A: pnpm workspaces sirf *dependency linking* karta hai — `pnpm-workspace.yaml` padh ke `workspace:*` deps ko symlink karta hai. Turborepo *task orchestration aur caching* karta hai — `turbo.json`'s `dependsOn: ["^build"]` order decide karta hai, `outputs` se result cache hota hai. Ek ke bina doosra bhi chalega, bas slower aur bina dependency-order guarantee ke.

**Q: `packages/api` ko "shared wire contract" kyun kaha jaata hai?**
A: Yeh sirf types nahi, runtime validation bhi hai — Zod schemas backend mein incoming requests validate karte hain aur wahi schemas se derive TypeScript types dono apps compile-time pe use karte hain. Header comment khud kehta hai: field add karo to jo bhi half update karna bhool gaye wahan TypeScript break karega (`schema.ts:3-9`) — ek single source of truth, runtime + compile-time dono guarantees ke saath.

**Q: `packages/ui` mein prop badalne par dashboard/chatbot ko turant pata chalega?**
A: Haan, bina publish/version-bump ke — pnpm `@workspace/ui` ko dono apps ke `node_modules` mein seedha `packages/ui/src` pe symlink karta hai. `tsc -b` turant type error dega prop break hone par, aur Vite dev server hot-reload karega kyunki asli file hi import ho rahi hai.

**Q: `pnpm dlx shadcn add <component> -c apps/dashboard` chalane par component dashboard mein kyun nahi lands hota?**
A: `-c apps/dashboard` sirf CLI ko Tailwind config/alias context batata hai; actual destination `packages/ui`'s `"exports"` field decide karta hai (`"./components/*": "./src/components/*.tsx"`) — CLI usi convention follow karta hai.

**Q: `turbo dev`'s `"cache": false, "persistent": true` kyun hai jabki `build` cache hoti hai?**
A: `dev` ek never-exiting process hai (Vite dev server, `tsx watch`) jiska output deterministic nahi — cache karna galat hoga. `persistent: true` batata hai yeh background mein chalte rehna chahiye. `build` opposite hai — deterministic `dist/**` output jo safely cache/reuse ho sakta hai.

**Q: Render pe backend deploy karte waqt `rootDir` kyun nahi set kiya?**
A: `packages/backend`'s `workspace:*` deps (`@workspace/api`, `@workspace/rag`) sirf tab resolve hote hain jab poore workspace root se install ho (symlinks banane ke liye). `rootDir` set karte to install isolated chalta aur deps miss ho jaate. `buildCommand` root se install karta hai, `startCommand` `pnpm --filter @workspace/backend start` se specifically backend start karta hai.

**Q: Agar `packages/widgets` ko `packages/backend` import karna pade, kya woh architecture break hogi?**
A: Haan — `packages/widgets`'s deps mein sirf `@workspace/ui`, `react`, `zod` hain, backend nahi. Yeh isko "pure render-a-tree logic" rakhta hai, jahan bhi React chale reusable. Backend import karne se yeh guarantee toot jaayegi aur server-only code (jaise `better-sqlite3`) browser bundle mein khinch sakta hai.

**Q: Naya `packages/analytics` (sirf backend use karega) add karna ho, kya-kya touch karna padega?**
A: `pnpm-workspace.yaml` change nahi karna (already `packages/*` match karta hai) — `package.json` bana ke `name: "@workspace/analytics"` set karo, `packages/backend/package.json` mein `"@workspace/analytics": "workspace:*"` add karo, phir `pnpm install` chalao symlink banane ke liye. `turbo.json` touch nahi karna kyunki task-graph automatically deps se derive hota hai.

### Chatbot Widget Embedding ([full doc](frontend/02-chatbot-widget-embedding.md))

**Q: `<freddy-chat>` kaam kaise karta hai bina kisi framework ke host page pe?**
A: Yeh ek native Web Component hai — `customElements.define("freddy-chat", ChatWidgetElement)` browser ko sikhaata hai ki is tag ka matlab kya hai. Browser khud `connectedCallback()` call karta hai, koi framework runtime host page pe chahiye hi nahi.

**Q: Shadow DOM kya hai aur yahan kyun use kiya gaya?**
A: Ek private mini-DOM tree jo element ke saath attach hoti hai, apna alag style scope rakhti hai. Do direction mein isolation chahiye thi: host ka CSS widget na todhe, widget ka CSS host na todhe. `host.attachShadow({ mode: "closed" })` yeh dono deta hai.

**Q: "closed" vs "open" shadow root — yahan closed kyun?**
A: Open mode mein host page ka JS `element.shadowRoot` se andar mutate kar sakta hai. Closed mode mein wo property `null` return karti hai — "so host-page scripts cannot reach in via `.shadowRoot` and mutate our DOM."

**Q: Base UI popups yahan kahan jaate hain by default, aur widget mein kaise handle hua?**
A: Default `document.body` mein — shadow boundary ke bahar, so unstyled render hota. Fix: `mount()` shadow root ke andar ek `fixed`, high-`z-index` div banata hai aur `ShadowContext` se poore tree ko provide karta hai, taaki popups wahan portal karein.

**Q: React container `display: contents` kyun, aur portal layer alag div kyun?**
A: `display: contents` apna stacking context nahi banata — bare container mein portal ho toh stack karne ke liye kuch nahi, host page ke peeche paint ho jaata. Portal layer isliye `position: fixed` + explicit `z-index` ke saath alag hai.

**Q: Theme change aur mode change mein alag behavior kyun hai?**
A: Theme sirf ek `data-theme` flag hai, in-place update ho sakta hai. `mode`/`position`/`trigger` tree shape hi badal dete hain, aur shadow root ek baar attach hone ke baad kisi naye host pe move nahi ho sakta — isliye purana element replace karna hi ek tareeka hai.

**Q: `adoptedStyleSheets` kyun, Vite default `<style>` injection kyun nahi?**
A: Vite normally CSS `<head>` mein `<style>` tag se daalta hai, jo shadow root ke andar visible nahi hota. `?inline` import se raw CSS string leke `CSSStyleSheet` banaya jaata hai aur `adoptedStyleSheets` pe assign hota hai — ek parsed sheet sab instances mein share hoti hai.

**Q: Yeh design kaise galat use ho sakta hai (breaking change)?**
A: Sabse common: koi `attachShadow({ mode: "open" })` kar de "debugging aasaan" bolke — isolation todhta hai. Doosra: naya popup component `usePortalContainer()` use na kare — silently `document.body` mein unstyled render hoga, TypeScript nahi pakdega. Teesra: inline mode mein host ki height missing ho — `100dvh` fallback logic hata do toh panel infinitely grow karega.

### Chat State & Streaming ([full doc](frontend/03-chat-state-and-streaming.md))

**Q: Chat panel mein do alag state containers kyun hain — Query cache aur React state?**
A: Query settled conversation ke liye hai, panel close/reopen survive karni hoti hai. In-flight stream Query mein nahi kyunki uska `notifyManager` notifications batch karta hai — har token cache mein likhne pe 7-chunk reply sirf 2 paints mein coalesce ho gayi thi. Isliye stream plain `useState` mein, jo turant re-render karta hai.

**Q: `MAX_TOOL_ROUNDS = 5` kya hai aur kyun zaroori hai?**
A: Model aur page ke tools ke beech ek turn mein kitni baar "bounce" ho sakta hai uski cap, server ke apne step limit ko mirror karti hai. Bina cap ke, ek tool jiska result model ko usi tool ko phir call karne pe uksaaye, infinite loop ban sakta hai.

**Q: Client tool call turn ko "pause" kyun karta hai, cancel kyun nahi?**
A: Client tool sirf browser hi chala sakta hai. Stream end hoti hai, `runTool()` browser mein chalta hai, result agle round ke `outbound` messages mein append hota hai — yeh dangling tool call se bachata hai, jise provider next request pe reject kar deta.

**Q: Widgets aur sources reply poora hone se pehle kyun dikhaye jaate hain?**
A: Retrieval closing sentence se bahut pehle finish ho jaata hai; content rok ke rakhna matlab ready cheez pe spinner dikhana. `setStreamingWidgets`/`setStreamingSources` stream ke beech hi call hote hain.

**Q: Persistence (`saveChat`) per-token kyun nahi hota?**
A: `write()` hi ek funnel hai jispe har settled change guzarta hai, aur turn settle hone pe ek baar call hota hai. Per-token save karne se bahut zyada localStorage writes hote, aur half-finished reply restore karna galat bhi hai.

**Q: `settledIds` module-level `Set` hai, component state nahi — kyun?**
A: Settling do writes hai — marker aur Query cache — jinka koi shared schedule nahi. Cache-write pehle jeet jaaye toh finished reply "slide up" jaisi dikhti thi. Plain `Set` synchronously update hoti hai, jo render pehle aaye already-updated marker dekhta hai.

**Q: `localStorage` quota exceed ho jaaye toh chat crash hoti hai kya?**
A: Nahi. `saveChat()` progressively shorter tails try karta hai — `[full, 20, 10, 4, 1]` messages. Kuch fit na ho toh apna key `removeItem` kar deta hai; chat memory mein kaam karti rehti hai, sirf reload pe persist nahi hoti.

**Q: `retry()` poori conversation resend karta hai kya?**
A: Nahi. Last user message dhoondhta hai, cache ko us message tak trim kar deta hai (partial reply drop), `mutation.reset()` karta hai, phir usi text se `mutation.mutate()` karta hai — turn fresh chalta hai.

**Q: Naya event kind (jaise `"reasoning"`) add karna ho toh kahan change hoga?**
A: `StreamEvent` union mein `packages/api/src/schema.ts`, `use-chat.ts` ke `for await` loop mein naya branch (apna `useState`, Query cache mein nahi), aur `ChatState` type mein expose taaki `panel.tsx` render kar sake.

### Widget Tree Rendering ([full doc](frontend/04-widget-tree-rendering.md))

**Q: Widget data untrusted kyun hai, aur is system ka core safety guarantee kya hai?**
A: Data ultimately AI tool-call output ya knowledge-base content se aata hai — dono Freddy ke apne deterministic control mein nahi hain. Core guarantee: render pipeline mein kahin bhi expression evaluator nahi hai — renderer ek closed `NODE_TYPES` list se pick karta hai aur `$bind` paths ko sirf walk karta hai, kabhi string ko code ki tarah execute nahi karta.

**Q: `{$bind: "$.path"}` aur ek JS template string mein fundamental difference kya hai?**
A: Template string ek expression evaluate karta hai — arithmetic, function calls, kuch bhi ho sakta hai. `$bind` sirf ek dot/bracket path hai jise `resolvePath` plain object traversal se walk karta hai — koi parser nahi, sirf `.split(".")` aur key lookup. Computation ki gunjaish hi nahi hai.

**Q: Prototype pollution attack widget data se kaise ho sakta tha, aur code isse kaise rokta hai?**
A: Agar model `"$.__proto__.polluted"` jaisa path bhej de aur lookup blindly `base[key]` kare, toh `Object.prototype` tak pahunch sakta tha. `resolve.ts` explicitly `__proto__`, `constructor`, `prototype` segments ko reject kar deta hai — yeh check har path lookup ke andar hai, bypass nahi ho sakta.

**Q: `when` false hone pe children mount kyun nahi hote, aur yeh kyun matter karta hai?**
A: `RenderNode` sabse pehle `when` check karta hai — false pe turant `null` return, props resolve ya children recurse kabhi hota hi nahi. Isse malformed ya missing-data child kabhi render attempt bhi nahi karta jab tak parent visible na ho.

**Q: `repeat` ko separate function mein kyun implement kiya, single fragment return kyun nahi kiya?**
A: Agar repeat ek `<>{...}</>` fragment return kare, toh `Carousel` jaisa parent jo children ko individually slot karta hai usko sirf "ek child" dikhta hai, aur poora fragment ek slot mein chala jaata hai (vertical stack bug). `expandRepeat` isliye `ReactElement[]` return karta hai jo parent ke flat children array mein merge ho jaata hai.

**Q: Version mismatch ho (purani definition, naya data shape) toh crash hoga?**
A: Nahi, system deliberately degrade karta hai. `getWidget` exact version na milne pe latest fallback karta hai. Unknown node type ho toh sirf warning ke saath `null`. Missing field pe `resolvePath` `undefined` return karta hai jo silently empty render hota hai — "an unresolved binding renders as empty rather than as an error."

**Q: `stateBy` widget ko "reconstructible" kaise banaata hai?**
A: `stateBy` data ke ek field ki value ko `map` mein lookup karke batata hai kaunsa named `states` entry render hoga. State local React state se nahi, data se derive hoti hai — isliye conversation reopen karne pe stored `data` replay hoke exactly wahi state deterministically wapas aati hai.

**Q: Naya widget primitive add karna ho, toh kya-kya touch karna padega?**
A: Teen jagah: `tree.ts` ke `NODE_TYPES` mein naya string, ek React component `primitives/` mein, aur `primitives/index.ts` ke `PRIMITIVES` record mein map. `PRIMITIVES` ka type `Record<NodeType, ComponentType<...>>` hai — agar renderer add karna bhool jao, TypeScript compile hi fail ho jaayega, blank widget silently nahi milega.

### Dashboard App Architecture ([full doc](frontend/05-dashboard-app-architecture.md))

**Q: Dashboard mein login system kyun nahi hai — koi email/password accounts table nahi?**
A: Kyunki is product mein sirf ek operator use karta hai dashboard ko — koi multi-user roles ya permissions ki zaroorat nahi hai. `packages/backend/src/auth.ts` ke comment mein yeh explicitly likha hai: ek shared secret hi kaafi hai, users table/session store/login flow banana over-engineering hoga is scale pe.

**Q: `DashboardAuthGate` password verify kaise karta hai — koi `/auth/check` endpoint hai?**
A: Nahi. Woh directly ek real gated endpoint, `GET /settings`, call karta hai aur dekhta hai ki success aata hai ya 401. Isse ek dedicated auth-check endpoint maintain nahi karna padta jo separately track kare ki kaunse routes actually protected hain — real route hi source of truth ban jaata hai.

**Q: Agar backend pe `DASHBOARD_PASSWORD` env var set nahi hai to kya hoga?**
A: `requireDashboardAuth` middleware seedha `next()` call kar deta hai bina koi header check kiye. Toh frontend ka bhi pehla unauthenticated `GET /settings` call bina kisi key ke hi succeed ho jaayega, aur gate seedha "unlocked" ho jaayega — local dev mein yeh effectively auth ko no-op bana deta hai, jo intentional hai.

**Q: Password kahan store hota hai aur kaise persist hota hai across reloads?**
A: `localStorage` mein key `"dashboard-auth-key"` ke naam se. Page reload pe `useEffect` yeh value uthata hai, `setDashboardAuthKey()` se `packages/api` client mein set karta hai, fir verify karne ke liye `/settings` call karta hai.

**Q: `x-dashboard-key` header kaun attach karta hai har request pe, aur kaise?**
A: `packages/api/src/client.ts` mein ek module-level variable `dashboardAuthKey` hai. `withAuthHeader()` helper har request ke `init.headers` mein yeh header merge kar deta hai jab bhi key non-null ho. Widget kabhi `setDashboardAuthKey()` call hi nahi karta, isliye uske liye yeh hamesha `null` rehta hai aur header attach hi nahi hota.

**Q: Routes ka structure kaise organize hai — sab ek file mein hai ya spread hai?**
A: `App.tsx` mein poora route tree ek jagah define hai, lekin har route ka actual component uske apne `modules/<feature>/` folder se import hota hai. Yeh feature-folder pattern hai — route wiring central hai but implementation feature ke saath colocated hai.

**Q: Agar tumhe ek naya protected route add karna ho (jaise `/analytics`), kya steps honge?**
A: Backend pe naya Hono route `requireDashboardAuth` middleware ke saath define karna hoga. Frontend pe `App.tsx` mein `<DashboardLayout>` ke andar naya `<Route path="/analytics" .../>` add karna hoga, aur `modules/analytics/` folder banana hoga is pattern ko follow karte hue. Sidebar mein bhi `customerSupportItems` array mein ek entry add karni hogi.

**Q: Yeh auth approach kab break hoga — koi weakness batao.**
A: Sabse badi weakness: agar koi backend route banate waqt `requireDashboardAuth` middleware add karna bhool jaaye, wo route silently unprotected reh jaayega — aur `/settings`-based check se yeh detect nahi hoga kyunki `/settings` khud protected hai, doosre routes nahi. (Doosra edge case — `DASHBOARD_PASSWORD` production mein set na hona — upar covered hai; wahan bhi koi hard failure/warning nahi aata, silently open ho jaata hai.)

**Q: `DashboardAuthGate` mein `status === "checking"` pe `null` kyun return hota hai, loading spinner kyun nahi?**
A: Yeh ek deliberate simplification hai — verify hone tak kuch bhi flash nahi hota (na locked form na app), jisse "flash of locked screen before actually being unlocked" jaisa UX glitch avoid hota hai. Trade-off yeh hai ki user ko thoda blank screen dikh sakta hai agar `/settings` call slow ho.

### Shared UI / Design System ([full doc](frontend/06-shared-ui-design-system.md))

**Q: shadcn "component library" nahi to phir kya hai?**
A: Yeh ek code generator/CLI hai. `shadcn add <component>` chalane pe woh component ka poora source code copy hoke `packages/ui/src/components/` mein aa jata hai — hum us code ke owner ban jate hain, kisi npm package version ke peeche lock nahi hote.

**Q: Base UI aur CVA mein farak kya hai — dono to "styling se related" lagte hain?**
A: Base UI zero styling deta hai — sirf behavior aur accessibility (focus trap, keyboard nav, ARIA). CVA sirf styling deta hai — Tailwind class strings ko named variants (`variant`, `size`) mein organize karta hai, koi behavior nahi. Dono independent concerns hain jo compose ho rahe hain.

**Q: `cn()` helper zaroori kyun hai, sirf template string se class join kyun nahi kar dete?**
A: Kyunki Tailwind classes conflict kar sakti hain. `Button` ka default `bg-primary` hai, caller `className="bg-red-500"` pass kare — plain concat se dono classes CSS mein jayengi aur unpredictable order jeetega. `tailwind-merge` samajhta hai dono same property (background-color) target kar rahi hain aur sirf last wali rakhta hai.

**Q: `Markdown` component chatbot aur dashboard dono mein use hota hai — agar isko fork/duplicate kar diya jaye to kya risk hai?**
A: Sabse bada risk: operator (dashboard mein) aur visitor (widget mein) ko alag rendering dikh sakti hai — jaise citation pills ek jagah click-through karein aur dusri jagah na karein. Comment khud yeh explain karta hai: "Shared verbatim... so an operator sees exactly what a visitor saw." Fork karne se yeh guarantee tootegi silently — bug turant dikhega bhi nahi.

**Q: Widget (`apps/chatbot`) ek closed shadow DOM custom element hai. Shared components wahan render hote hue kya extra dhyaan chahiye?**
A: Shadow DOM CSS isolation deta hai, lekin iska matlab globals.css (Tailwind output) shadow root ke andar bhi inject honi chahiye, warna components unstyled dikhenge. Isi wajah se `markdown.tsx` `onCitationClick` callback prop use karta hai `href="#id"` native navigation ke bajaye — shadow root ki wajah se hash navigation boundary cross nahi kar sakta.

**Q: `oklch()` color space kyun use kiya gaya hai, hex/rgb kyun nahi?**
A: `globals.css` ka har token (`--primary`, `--background`, etc.) `oklch(L C H)` format mein hai — perceptually uniform, matlab same lightness value alag hues mein bhi visually similar bright lagti hai, jo dark-mode tuning predictable banata hai.

**Q: Agar CVA na hota, variant management kaise messier hota?**
A: Har jagah manually ternary likhna padta (`variant === "outline" ? "..." : ...`), na type-safety milti, na `defaultVariants` jaisa fallback. CVA `VariantProps<typeof buttonVariants>` se TypeScript ko automatically variant/size ke valid union types de deta hai — invalid variant pass karna compile-time error ban jata hai.

## RAG + Backend

### RAG Ingestion Pipeline ([full doc](rag/07-rag-ingestion-pipeline.md))

**Q: RAG kya hai aur yeh kyun zaroori hai?**
A: Model ko answer se pehle relevant real documents "retrieve" karke context mein dena, taaki woh training memory se guess na kare. `ingest()` crawl karke content chunk/embed karta hai, `search()` query time pe relevant chunks nikaalta hai jo chat model ko diye jaate hain.

**Q: `ingest()` ek async generator kyun hai?**
A: Ingest minutes le sakta hai aur dashboard ko live progress dikhana hai. Async generator har step pe typed event (`start`/`page`/`skip`/`unchanged`/`done`/`error`) yield karta hai jo SSE ke through browser tak stream hota hai. Ek plain Promise sirf "finished" bata paata.

**Q: Incremental re-ingest kaise kaam karta hai?**
A: Extract ke baad naye page ka SHA-256 hash purane `store.pageHash` se compare hota hai — match hua toh chunk/embed dono skip. Chunking se pehle isliye hai kyunki chunking free hai, embedding paisa lagti hai.

**Q: Sitemap-first crawling kyun?**
A: Sitemap khud site ka statement hai "yeh meri real pages hain" — link-crawl tag archives, pagination bhi utha leta hai jo content nahi. Sitemap na milne pe hi fallback crawling chalti hai.

**Q: Embedding-model mismatch guard ingest side pe kis problem ko rokta hai?**
A: Dono backends (Google, Ollama) 768-dim vectors dete hain, toh mismatch crash nahi karega — silently "confidently ranked garbage" results milne lagenge. `ingest.ts` yeh crawl/embed se pehle hi check karta hai aur `setIndexModel()` se model record karta hai — network call tak nahi jaati agar mismatch mila. (Search time pe yehi guard `search.ts` mein bhi hai, query embed hone se pehle — dono jagah defense-in-depth ke liye.)

**Q: "prune" option default off kyun hai?**
A: Pehli baar ka run ya `maxPages`-capped run poore site tak pahunch hi nahi paata — prune on hota toh un-reached pages ko "deleted" samajh liya jaata. Isliye sirf scheduled refresh job mein explicitly on hota hai.

**Q: Do ingest requests aa jaayen ek tenant pe, tab kya hota hai?**
A: Dusra pehle wale ko reject nahi, `abort()` se cancel karta hai — "ingest phir dabana" almost hamesha matlab hota hai "URL badla", "dono chalao" nahi.

**Q: Page ka markdown empty/chota nikle toh?**
A: `extract()` typed failure return karta hai (`ok:false`, reason `"empty"`/`"too-short"`) instead of throwing ya khaali string store karne ke — dashboard pe developer ko dikhta hai *kyun* skip hua.

**Q: Heading-path prefix chunking mein itna important kyun?**
A: Isolated sentence jaise "You have 30 days from delivery" ambiguous hai. "Billing > Refunds >" prepend karne se embedding actual query ke paas lagta hai — comment khud kehta hai yeh recall model swap se zyada move karta hai.

### RAG Hybrid Search ([full doc](rag/08-rag-hybrid-search.md))

**Q: Vector search akela use kyun nahi kar sakte?**
A: Exact strings pe weak hai — error codes/product names jaise tokens ka embedding meaningfully differentiate nahi hota, ek error code baaki sab error strings ke numerically close pad jaata hai. `SSO_REDIRECT_MISMATCH` jaisa example — BM25 exact match se turant dhoondh leta hai jabki vector search confuse ho jaata hai.

**Q: Keyword search akela use kyun nahi kar sakte?**
A: Users apne words mein poochte hain, docs ke exact words mein nahi — "can I get my money back" ka koi word "Refunds" page se match nahi karega, so keyword-only zero results dega. Vector search meaning capture karta hai isliye yeh case handle kar leta hai.

**Q: RRF (Reciprocal Rank Fusion) kya hai aur weighted average kyun nahi use kiya?**
A: RRF sirf har result ki rank position dekhta hai, actual score nahi — formula `1 / (60 + rank)`. Weighted average nahi use kar sakte kyunki cosine similarity [-1, 1] range mein hai jabki BM25 unbounded aur corpus-dependent hai — numbers directly comparable nahi. RRF_K=60 khud original paper ka value hai, bina per-corpus tuning ke achha kaam karta hai.

**Q: `minSimilarity: 0.35` floor kyun rakha gaya hai — iska purpose ranking improve karna hai?**
A: Nahi, purpose ranking nahi, "I don't know" bolna possible banana hai. Vector search mein hamesha ek "closest" chunk milta hai chahe docs mein topic cover ho ya na ho — bina floor ke model ko kuch na kuch handed ho jaata hai aur woh confidently us se answer bana deta hai, jo hallucination ka sabse common mechanism hai.

**Q: Embedding-model mismatch check query embed hone SE PEHLE kyun hota hai?**
A: Do reasons — fail-fast (mismatch pata hai toh embed karne ka network round-trip hi waste hai), aur safety: dono backends 768-dimension vectors output karte hain, so check na ho toh mismatch silently ek "confidently ranked list of unrelated passages" dega — na crash, na empty result, bas galat answer jo model fact ki tarah cite karega.

**Q: Agar `candidates: 20` ko `candidates: 5` kar do, kya problem aa sakta hai?**
A: Fusion ka pool chhota ho jaayega — koi chunk vector search mein rank 8 pe (top-5 se bahar) lekin keyword search mein rank 2 pe ho, toh candidates=5 se woh vector list mein include hi nahi hoga, sirf keyword se contribute karega. Dono retrievers se "second opinion" milne ka chance kam ho jaata hai, especially borderline-relevant chunks ke liye.

**Q: `via` field (vector/keyword/both tag) practically kis kaam aata hai?**
A: Debugging mein — result sirf `via: ["keyword"]` hai matlab embedding model query ko theek se samajh nahi paya, jabki `via: ["vector"]` batata hai wording unusual thi but keyword match nahi mila. Yeh "the embedding is wrong" ko "the wording is unusual" se alag batane ka fastest tareeka hai — diagnostic signal hai, sirf metadata nahi.

### Backend Chat & AI SDK ([full doc](rag/09-backend-chat-and-ai-sdk.md))

**Q: Widget "sirf JavaScript" hai — backend server ki zaroorat kyun padi?**
A: Kyunki widget ka bundle customer ki site par load hota hai jahan koi bhi view-source se sab padh sakta hai. Key widget mein hoti toh minutes mein churayi jaati. Backend hi real key hold karta hai, widget sirf usse baat karta hai.

**Q: CORS `origin: "*"` security hole nahi hai kya?**
A: Deliberate hai — widget arbitrary customer domains par load hota hai jo deploy-time par pata nahi hote, ek allowlist fit nahi baithti. Real gate auth ke saath aana chahiye, jo iss iteration mein abhi nahi hai.

**Q: `streamText()` vs `generateText()` — farq?**
A: `generateText()` poora response ready hone tak block karta; `streamText()` provider se chunks aate hi `result.stream` mein expose karta hai, isliye client ko token-by-token reply dikhta hai instead of blank spinner.

**Q: Server tool aur client tool ek hi `tools` map mein kyun hain?**
A: Model ke perspective se dono "callable tools" hi hain, farq pata nahi chalna chahiye. Real difference `execute` ki presence hai — server tool (`searchKnowledge`) ke paas hai, client tool (`type: "dynamic"`) ke paas nahi, isliye SDK usse incomplete step treat kar ke stream end kar deta hai.

**Q: `stopWhen: isStepCount(5)` hata do toh?**
A: Model tool call ke baad turant ruk jaayega — raw call + result milega, koi explaining sentence nahi banega.

**Q: `repairToolCall` kya solve karta hai, aur normal apps mein utna zaroori kyun nahi?**
A: Tool schemas customer ki page se aate hain aur Gemini convert karte waqt kuch JSON-Schema keywords drop kar deta hai — model looser contract follow kar raha hota hai. Repair ek sasta `generateObject()` call se galti + sahi schema dikha ke dubara puchta hai, poori turn fail nahi hoti.

**Q: Do timeouts alag kyun rakhe — ek hi kaafi nahi?**
A: Alag failure modes catch karte hain — `firstChunkMs: 15_000` model ke kuch na bolne ke liye, `totalMs: 120_000` forever-trickling stream ke liye. Ek single value dono ko sahi handle nahi kar payega.

**Q: Naya server tool banate waqt sabse common galti?**
A: `tenantId` ko tool ke `inputSchema` mein daal dena — model ise "choose" kar sakega, aur prompt-injection se dusre tenant ka data maang sakta hai. `searchKnowledge` jaisa pattern sahi hai: constructor `tenantId` leta hai, closure mein bind karta hai.

**Q: Client tool call bina result ke resumed request mein Gemini reject kyun nahi karta?**
A: `toModelMessages()` turn ko 3 messages mein expand karta hai (call → result → reply), flatten nahi karta. Dangling call (result-less) ka pair drop kar diya jaata hai, taaki provider reject na kare.

### Storage Layer ([full doc](rag/10-storage-layer.md))

**Q: `Store` interface kyun banaya, seedha concrete class kyun nahi use kar liya?**
A: Taaki `ingest.ts`/`search.ts` kabhi na jaane underlying DB kya hai. Dev harness SQLite pe "clone karo aur chalao" chalta hai, production `DATABASE_URL` set karke Postgres pe switch ho jaata hai — bina pipeline code touch kiye. Classic dependency inversion.

**Q: `sqlite-vec` kyun nahi use kiya dev store mein?**
A: macOS ka system SQLite extension-loading ke bina compiled aata hai, toh sqlite-vec use karne ka matlab har developer ko Homebrew se SQLite install karwana. `better-sqlite3` apna bundled binary laata hai jisme FTS5 already hai — "clone and run" promise nahi tootata.

**Q: Brute-force vector search production mein problem kyun nahi hai (abhi)?**
A: Typical docs site kuch hazaar chunks ka hota hai, aur kuch hazaar dot products (768-dim) compute karna ~1ms leta hai — embedding API call ke network round trip ke saamne noise hai. Tens/hundreds of thousands chunks tak pahunchne pe `PgVectorStore` pe switch karne ka signal milta hai.

**Q: WAL mode kyun explicit enable kiya?**
A: Default journal mode mein writes readers ko block karte hain. WAL mein ingest ka write aur dashboard ka search read genuinely concurrently chal sakte hain — dono jagah set kiya gaya hai.

**Q: In-memory index cache kab invalidate hota hai?**
A: Har write (`upsertPage`, `deletePage`, `clear`, etc.) pe `this.indexes.delete(tenantId)` se turant drop hota hai, aur agli search pe lazily rebuild hota hai — taaki stale vectors serve na hon.

**Q: Chunk table ki key `(tenant_id, id)` kyun, `id` akela kyun nahi?**
A: Chunk id `url#position` hai — sirf ek page ke andar unique. Do tenants same public docs site crawl karein toh same id milega; `id` akela key hota toh doosra tenant UNIQUE-constraint pe fail hota.

**Q: Ek third store add karna ho toh kya karna padega?**
A: `Store` implement karti nayi class likhni padegi, aur `db.ts` mein ek teesra branch add karna padega jo sahi condition pe usse instantiate kare. `ingest.ts`/`search.ts` ki ek line touch nahi karni padegi.

## Top 10 "if they only ask one thing per area" questions

**1. `packages/api` ko "shared wire contract" kyun kaha jaata hai?** _(Monorepo & Tooling)_
A: Yeh sirf types nahi, runtime validation bhi hai — Zod schemas backend mein incoming requests validate karte hain aur wahi schemas se derive TypeScript types dono apps compile-time pe use karte hain. Field add karo to jo bhi half update karna bhool gaye wahan TypeScript break karega — ek single source of truth, runtime + compile-time dono guarantees ke saath.

**2. Base UI popups yahan kahan jaate hain by default, aur widget mein kaise handle hua?** _(Chatbot Widget Embedding)_
A: Default `document.body` mein — shadow boundary ke bahar, so unstyled render hota. Fix: `mount()` shadow root ke andar ek `fixed`, high-`z-index` div banata hai aur `ShadowContext` se poore tree ko provide karta hai, taaki popups wahan portal karein — na host page mein, na bare shadow root mein (jahan koi stacking context na hone se peeche paint ho jaata).

**3. Chat panel mein do alag state containers kyun hain — Query cache aur React state?** _(Chat State & Streaming)_
A: Query settled conversation ke liye hai, panel close/reopen survive karni hoti hai. In-flight stream Query mein nahi kyunki uska `notifyManager` notifications batch karta hai — har token cache mein likhne pe 7-chunk reply sirf 2 paints mein coalesce ho gayi thi. Isliye stream plain `useState` mein, jo turant re-render karta hai.

**4. Widget data untrusted kyun hai, aur is system ka core safety guarantee kya hai?** _(Widget Tree Rendering)_
A: Data ultimately AI tool-call output ya knowledge-base content se aata hai — dono deterministic control mein nahi hain. Core guarantee: render pipeline mein kahin bhi expression evaluator nahi hai — renderer ek closed `NODE_TYPES` list se pick karta hai aur `$bind` paths ko sirf walk karta hai, kabhi string ko code ki tarah execute nahi karta.

**5. `DashboardAuthGate` password verify kaise karta hai — koi `/auth/check` endpoint hai?** _(Dashboard App Architecture)_
A: Nahi. Woh directly ek real gated endpoint, `GET /settings`, call karta hai aur dekhta hai ki success aata hai ya 401. Isse ek dedicated auth-check endpoint maintain nahi karna padta jo separately track kare ki kaunse routes actually protected hain — real route hi source of truth ban jaata hai.

**6. shadcn "component library" nahi to phir kya hai?** _(Shared UI / Design System)_
A: Yeh ek code generator/CLI hai. `shadcn add <component>` chalane pe woh component ka poora source code copy hoke `packages/ui/src/components/` mein aa jata hai — hum us code ke owner ban jate hain, kisi npm package version ke peeche lock nahi hote.

**7. `ingest()` ek async generator kyun hai?** _(RAG Ingestion Pipeline)_
A: Ingest minutes le sakta hai aur dashboard ko live progress dikhana hai. Async generator har step pe typed event (`start`/`page`/`skip`/`unchanged`/`done`/`error`) yield karta hai jo SSE ke through browser tak stream hota hai. Ek plain Promise sirf "finished" bata paata.

**8. RRF (Reciprocal Rank Fusion) kya hai aur weighted average kyun nahi use kiya?** _(RAG Hybrid Search)_
A: RRF sirf har result ki rank position dekhta hai, actual score nahi — formula `1 / (60 + rank)`. Weighted average nahi use kar sakte kyunki cosine similarity [-1, 1] range mein hai jabki BM25 unbounded aur corpus-dependent hai — numbers directly comparable nahi. Rank position hi ek aisi property hai jo har corpus mein consistent transfer karti hai.

**9. Widget "sirf JavaScript" hai — backend server ki zaroorat kyun padi?** _(Backend Chat & AI SDK)_
A: Kyunki widget ka bundle customer ki site par load hota hai jahan koi bhi view-source se sab padh sakta hai. Gemini ka API key widget mein hoti toh minutes mein churayi jaati. Backend hi real key hold karta hai, widget sirf usse baat karta hai — poora `packages/backend` ka existence isi ek fact se justify hota hai.

**10. `Store` interface kyun banaya, seedha concrete class kyun nahi use kar liya?** _(Storage Layer)_
A: Taaki `ingest.ts`/`search.ts` kabhi na jaane underlying DB kya hai. Dev harness SQLite pe "clone karo aur chalao" chalta hai, production `DATABASE_URL` set karke Postgres pe switch ho jaata hai — bina pipeline code touch kiye. Classic dependency inversion, aur poore RAG package ki portability isi ek interface pe tiki hai.
