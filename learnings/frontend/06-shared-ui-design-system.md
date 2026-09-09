# Shared UI / Design System — shadcn + Base UI + Tailwind v4
_Ek hi Button.tsx, do apps mein — copy-paste nahi, actual shared package._

## Yeh hai kya? (What is this)

`packages/ui` ek workspace package hai (`@workspace/ui`) jisme saare shared UI components rehte hain — Button, Dialog, Table, Sidebar, aur chat-specific pieces jaise `Markdown` aur `MessageBubble`. Dono apps — `apps/chatbot` (widget) aur `apps/dashboard` (operator UI) — isi se import karte hain, `@workspace/ui/components/<name>` jaise ek real npm package ho. Repo isko apna "base-maia" style bulata hai (`README.md:5`).

Yeh sirf ek "component library" nahi — yeh 5 alag-alag tools ka stack hai jo mil ke ek final, styled, accessible component banate hain.

## Yeh kyun banaya gaya? (Why it exists)

Do apps hain (chatbot widget, dashboard), dono ko same look-and-feel chahiye — same Button, same Dialog, same colors, warna design drift ho jata. Isliye ek single source of truth: `packages/ui`.

Bada decision yeh hai — **shadcn ek npm package nahi hai jo `pnpm add` karke install hoti hai**. Yeh ek CLI hai jo component ka poora source code copy karke repo mein daal deti hai (`packages/ui/src/components/button.tsx`). Matlab code aapka hai, directly edit kar sakte ho, kisi locked npm package version ke peeche stuck nahi ho. `packages/ui/components.json` mein dekho:

```json
"style": "base-maia",
"aliases": { "ui": "@workspace/ui/components" },
"iconLibrary": "hugeicons"
```

Yeh config batata hai naya component generate hote waqt kahan jayega aur kaunsa icon set use hoga — repo-specific defaults hain jo shadcn ki generic setup override karte hain.

`markdown.tsx` mein ek aur real "why" comment sharing ka actual purpose dikhata hai:

```
Shared verbatim by the chatbot widget and the dashboard's
conversation view, so an operator sees exactly what a visitor saw.
```
(`packages/ui/src/components/chat/markdown.tsx:85`)

Matlab yeh sirf DRY (Don't Repeat Yourself) ke liye nahi — behavior parity ke liye bhi zaroori hai. Alag renderer hota to citation links ya code blocks differently render ho sakte the jo visitor ne actually dekha usse.

## Kaise kaam karta hai (How it works, step by step)

Ek component (jaise Button) 5 layers se ban ke aata hai, neeche se upar:

1. **Tailwind CSS v4** — sabse bottom layer, actual utility classes (`bg-primary`, `rounded-4xl`, etc.) jo CSS generate karti hain. `globals.css` `@import "tailwindcss"` se shuru hota hai (`packages/ui/src/styles/globals.css:1`).

2. **@base-ui/react** — headless behavior primitive. "Headless" matlab koi visual style nahi, sirf behavior — focus trap, keyboard navigation (Escape se dialog band hona), ARIA attributes. `dialog.tsx` mein `DialogPrimitive.Root`, `DialogPrimitive.Popup` Base UI se aate hain — accessibility khud handle nahi karni padi (`packages/ui/src/components/dialog.tsx:2`).

3. **shadcn CLI** — naya component chahiye ho to: `pnpm dlx shadcn add <component> -c apps/dashboard`. App se run hota hai, lekin generated file `packages/ui/src/components/` mein save hoti hai — turant dono apps ke liye available.

4. **class-variance-authority (CVA)** — Base UI ke upar styling ka "variant system" define karta hai. `button.tsx` ka `buttonVariants` dekho — `variant: "default" | "outline" | "ghost" | "destructive" | "link"` aur `size: "default" | "xs" | "sm" | "lg" | "icon"`, har combination ke liye typed class string (`packages/ui/src/components/button.tsx:5-38`).

5. **`cn()` helper (clsx + tailwind-merge)** — caller `className` pass kare (e.g. custom background) to yeh do class-lists intelligently merge karta hai — conflicting Tailwind class ho (jaise do `bg-*`), to sirf last wala jeetega:

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
(`packages/ui/src/lib/utils.ts:4-6`)

6. Final component export hota hai (`Button`, `buttonVariants`) — `packages/ui/package.json` ka `exports` map isse outside world ko dikhata hai:

```json
"exports": {
  "./globals.css": "./src/styles/globals.css",
  "./lib/*": "./src/lib/*.ts",
  "./components/*": "./src/components/*.tsx",
  "./hooks/*": "./src/hooks/*.ts"
}
```
(`packages/ui/package.json:46-51`)

7. Dono apps import karte hain — `apps/chatbot/src/chat/panel.tsx` aur `apps/dashboard/src/modules/conversations/conversation-id-view.tsx` dono `@workspace/ui/components/message-bubble` se `MessageBubble` import karte hain. Ek hi file, do runtime contexts (widget ka shadow DOM, dashboard ka normal DOM) mein render ho rahi hai. Yeh 7-step pipeline (component-generation se lekar shared import tak) hi diagram ka poora content hai.

## Code walkthrough

- `packages/ui/package.json:12-29` — dependencies list karta hai poora stack in one place: `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, `clsx`, `shadcn`, `@fontsource-variable/figtree`, `@hugeicons/react`, `motion`, `dompurify`, `marked`.

- `packages/ui/src/components/button.tsx:40-53` — `Button` function `ButtonPrimitive` (Base UI) ko wrap karta hai, `cn(buttonVariants({ variant, size, className }))` se classes compute karta hai, `data-slot="button"` attribute deta hai. `dialog.tsx:75-79` isi `Button` ko reuse karta hai close-icon ke liye — Base UI ke `render` prop se (`render={<Button variant="ghost" size="icon-sm" />}`), yeh composition ka real example hai.

- `packages/ui/src/components/dialog.tsx:55-64` — ek detailed rationale comment batata hai `[&>*]:min-w-0` kyun zaroori hai: grid item ka default minimum width uske content ke min-content size ke barabar hota hai, aur ek lambi filename (no spaces) poore box ko viewport se wide push kar sakti hai — yeh subtle CSS gotcha already documented hai.

- `packages/ui/src/styles/globals.css:1-4` — chaar imports: Tailwind khud, `tw-animate-css`, `shadcn/tailwind.css` (base preset), `@fontsource-variable/figtree` — matlab Figtree font locally bundled hai, koi external Google Fonts call nahi lagti runtime pe.

- `packages/ui/src/styles/globals.css:55-89` — saare design tokens `oklch()` color space mein define hain (`--primary`, `--background`, etc.), `.dark` class ke andar unke dark-mode variants — CVA variants in hi tokens ko reference karte hain, hardcoded hex nahi.

- `packages/ui/src/components/chat/markdown.tsx:116` — `DOMPurify.sanitize(marked.parse(...))`: AI ka reply markdown string hota hai, `marked` usse HTML banata hai, phir `DOMPurify` us HTML ko sanitize karta hai — kyunki HTML ultimately ek LLM se aata hai, seedha `dangerouslySetInnerHTML` mein daalne se pehle sanitize zaroori hai.

## Diagram

Neeche diagram (`06-shared-ui-design-system.excalidraw`) mein dikhaya gaya hai ki ek component kaise layer-by-layer banta hai aur phir do apps mein share hota hai. excalidraw.com pe File → Open karo, ya file ko canvas pe drag-drop karo.

Diagram ek "layer cake" hai, neeche se upar: "Tailwind v4 (utility CSS)", uske upar "CVA (variant definitions)", uske upar "Base UI (accessible behavior, no styling)", uske upar "shadcn CLI (generates owned source)", aur sabse top pe "button.tsx — final component" jo `packages/ui/src/components/` mein baithta hai. Top box se do arrows upar-bahar nikalte hain, "apps/chatbot" aur "apps/dashboard" boxes mein jaake khatam hote hain — dono same component import kar rahe hain. Ek chhota caption `@workspace/ui/components/*` exports path point karta hai.

## Interview questions

**Q: shadcn "component library" nahi hai to phir kya hai?**
A: Yeh ek code generator/CLI hai. `shadcn add <component>` chalane pe woh component ka poora source code copy hoke `packages/ui/src/components/` mein aa jata hai — hum us code ke owner ban jate hain, kisi npm package version ke peeche lock nahi hote. Yehi wajah hai `dialog.tsx` mein hum apna custom rationale comment (min-w-0 wala) daal sake — kyunki file humari hai.

**Q: Base UI aur CVA mein farak kya hai — dono to "styling se related" lagte hain?**
A: Base UI zero styling deta hai — sirf behavior aur accessibility (focus trap, keyboard nav, ARIA). CVA sirf styling deta hai — Tailwind class strings ko named variants (`variant`, `size`) mein organize karta hai, koi behavior nahi. `button.tsx` mein dono alag imports hain: `ButtonPrimitive` from `@base-ui/react/button` (behavior) aur `cva()` (styling) — dono independent concerns hain jo compose ho rahe hain.

**Q: `cn()` helper zaroori kyun hai, sirf template string se class join kyun nahi kar dete?**
A: Kyunki Tailwind classes conflict kar sakti hain. `Button` ka default `bg-primary` hai, caller `className="bg-red-500"` pass kare — plain concat se dono classes CSS mein jayengi aur unpredictable order jeetega. `tailwind-merge` (`packages/ui/src/lib/utils.ts:4-6`) samajhta hai dono same property (background-color) target kar rahi hain aur sirf last wali rakhta hai.

**Q: `Markdown` component chatbot aur dashboard dono mein use hota hai — agar isko fork/duplicate kar diya jaye to kya risk hai?**
A: Sabse bada risk: operator (dashboard mein) aur visitor (widget mein) ko alag rendering dikh sakti hai — jaise citation pills ek jagah click-through karein aur dusri jagah na karein, ya markdown sanitization rules diverge ho jayein. Comment khud yeh explain karta hai: "Shared verbatim... so an operator sees exactly what a visitor saw" (`packages/ui/src/components/chat/markdown.tsx:85`). Fork karne se yeh guarantee tootegi silently — bug turant dikhega bhi nahi.

**Q: Widget (`apps/chatbot`) ek closed shadow DOM custom element hai. Shared components wahan render hote hue kya extra dhyaan chahiye?**
A: Shadow DOM CSS isolation deta hai, lekin iska matlab globals.css (Tailwind output) shadow root ke andar bhi inject honi chahiye, warna components unstyled dikhenge. Isi wajah se `markdown.tsx` `onCitationClick` callback prop use karta hai `href="#id"` native navigation ke bajaye — comment explicitly kehta hai shadow root ki wajah se hash navigation boundary cross nahi kar sakta (`packages/ui/src/components/chat/markdown.tsx:104-107`).

**Q: `oklch()` color space kyun use kiya gaya hai, hex/rgb kyun nahi?**
A: `globals.css` ka har token (`--primary`, `--background`, etc.) `oklch(L C H)` format mein hai — perceptually uniform, matlab same lightness value alag hues mein bhi visually similar bright lagti hai, jo dark-mode tuning predictable banata hai. Comment isko validate karta hai: dark mode ka destructive red glare kam karne ke liye lighter rakha gaya, foreground contrast explicitly measure karke choose kiya (`packages/ui/src/styles/globals.css:106-110`).

**Q: Agar CVA na hota, variant management kaise messier hota?**
A: Har jagah manually ternary likhna padta (`variant === "outline" ? "..." : ...`), na type-safety milti, na `defaultVariants` jaisa fallback. CVA `VariantProps<typeof buttonVariants>` se TypeScript ko automatically variant/size ke valid union types de deta hai (`packages/ui/src/components/button.tsx:45`) — invalid variant pass karna compile-time error ban jata hai.

## Common confusions (log yahan confuse hote hain)

- Log sochte hain shadcn "install" hota hai jaise normal npm package — actually yeh code generate karke deta hai, `package.json` mein `shadcn` sirf CLI dependency hai, component khud usme nahi.
- `cn()` ko log sirf "classnames helper" samajhte hain — asli value tailwind-merge ka conflict resolution hai, sirf array-join nahi.
- Base UI aur shadcn ko ek hi cheez samajh lete hain — Base UI behavior primitive hai (Radix ka alternative), shadcn uske upar style laane ka CLI tool hai. Dono independent replace ho sakte hain.
- `chat/` folder naam dekh ke chatbot-app-specific lag sakta hai, lekin dashboard ke conversation view mein bhi wahi files use hoti hain — naam feature-domain batata hai, app nahi.
