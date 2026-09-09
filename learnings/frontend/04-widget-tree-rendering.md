# Widget Tree Rendering
_AI ke jawaab mein interactive card kaise render hota hai — bina kabhi koi code chalaye._

## Yeh hai kya? (What is this)

Jab Freddy (yeh product ka AI) ko text se better ek card dikhana ho — weather card, hotel options ki carousel, ek lead-capture form — toh backend ek chhota JSON tree bhejta hai jo bataata hai "kaunsa layout, kaunsa data". `packages/widgets` package uss JSON ko actual React UI mein badalta hai. Poora system teen files mein hai: `tree.ts` (format define karta hai), `resolve.ts` (path lookup), `render.tsx` (recursive walker jo React tree banaata hai).

## Yeh kyun banaya gaya? (Why it exists)

Widget ka data ultimately AI model ke tool-call output ya knowledge-base content se aata hai — **untrusted input**. Agar hum yeh data ek templating engine ko dete jo JS expressions evaluate kar sakti hai, toh model output (ya KB mein chhupa hua text) theoretically arbitrary code chala sakta tha customer ki site pe. `tree.ts` ke top comment mein yeh saaf likha hai:

```ts
// tree.ts:6-9
// Authors write JSX in the dashboard; the dashboard compiles it to this and
// stores the result. The runtime only ever sees JSON: there is no parser and
// no evaluator here, which is the whole reason this is safe to render inside
// a customer's page.
```

Author dashboard mein JSX likhta hai, but runtime tak sirf plain JSON pahunchta hai — koi `eval`, koi expression parser nahi. `resolve.ts:11-13` mein bhi same baat: "there is no expression parser and nothing is evaluated — `resolve` walks an object with string keys."

## Kaise kaam karta hai (How it works, step by step)

1. **Definition registered hoti hai.** Har widget ek `WidgetDefinition` hai — id, Zod schema, aur `states` (named JSON trees). `registry.ts` mein per-customer register hoti hai, kyunki purane conversation messages ko unke original version ke against hi render hona chahiye.

2. **Tool call se widget data aata hai.** AI jab tool call karta hai, response `WidgetPayloadSchema` (`tree.ts:245-252`) shape mein aata hai — `widgetId`, `version`, `data`, aur text `summary` (fallback).

3. **`Widget` component state chunta hai.** `render.tsx:164-276` definition ke `states` map se ek state pick karta hai — `stateBy` diya ho toh data ke ek field se decide hota hai (jaise booking widget "form" vs "confirmed"). State data se derive hoti hai, isliye conversation reopen karne pe wahi visual state deterministically wapas aati hai.

4. **`RenderNode` tree recursively walk karta hai.** Pehle `when` check hota hai — false hone pe node aur uske children resolve/mount hi nahi hote (`render.tsx:79`). Fir `repeat` ho toh `expandRepeat` array ko N sibling elements mein expand karta hai, har ek apne `$item`/`$index` scope ke saath (`render.tsx:46-74`).

5. **Props resolve hote hain.** `resolveProps` (`resolve.ts:211-221`) literal values ko as-is chhodta hai, `{$bind: "$.path"}` objects ko `resolvePath` se walk karke value nikaalta hai, fir optional `fallback` aur `format` (money/date/number/...) apply karta hai.

6. **Fixed primitive component ko handoff.** Node ka `type` (Box, Card, Title, Button...) `PRIMITIVES` registry (`primitives/index.ts:34-59`) se ek real React component nikaalta hai. `type` unknown ho (purana version, bug) toh sirf console warning ke saath `null` return hota hai — poora widget crash nahi hota (`render.tsx:82-87`).

7. Result: ek deterministic React tree, jisme har step sirf lookup/switch hai — kahin bhi arbitrary code execute nahi hota.

## Code walkthrough

- **`tree.ts:155-186`** — `NODE_TYPES` ek fixed array hai (Box, Row, Card, Title, Button, Form, Carousel, Chart...). Yeh closed set hi safety story ka core hai: "an author cannot introduce a new primitive" (`tree.ts:152-154`).

- **`tree.ts:27-35`** — `isSafeUrl`: control characters pehle strip karke check hota hai, tabhi scheme ko allowlist (`http:`, `https:`, `mailto:`, `tel:`) se match karta hai — browser tabs/newlines URL se apne aap strip kar deta hai, isliye `"jav\tascript:"` ek naive check ko bypass kar sakta tha:
```ts
const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)
if (!scheme) return true // relative: /path, ./x, #hash, ?q
return SAFE_URL_SCHEMES.has(scheme[0].toLowerCase())
```

- **`resolve.ts:64-73`** — `resolvePath` prototype-pollution-unsafe keys explicitly reject karta hai, kyunki data model-authored JSON hai:
```ts
if (key === "__proto__" || key === "constructor" || key === "prototype") {
  return undefined
}
```

- **`render.tsx:46-73`** — `expandRepeat` array ko sibling elements mein expand karta hai (ek fragment mein nahi), kyunki `Carousel` jaisa primitive apne children ko individually slot karta hai — pehle iska galat implementation vertical-stack bug de chuka tha.

- **`stock/weather.ts:81-94`** — real example: `Card` ke andar ek `Box` jiska background literal `"#2563eb"` hai (theme-independent, kyunki card identity hai), `city`/`temperature` bound values hain.

## Diagram

Neel diagram (`04-widget-tree-rendering.excalidraw`) mein dikhaya gaya hai ki data ek untrusted source se safe rendered UI tak kaise pahunchta hai (excalidraw.com pe File → Open, ya drag). Flow left-to-right hai:

1. **"LLM / Knowledge base (untrusted)"** box — tool-call data originate yahin se.
2. Arrow → **"Widget data (JSON tree)"** box — `WidgetPayloadSchema` shape.
3. Arrow → **"RenderNode walker"** box (`render.tsx`), central engine.
4. Isse teen branch boxes: **"when? → skip node"**, **"repeat? → expand N siblings"**, **"resolve $bind props (path lookup only)"** — teeno hi decisions hain, expression evaluate nahi karte.
5. Sab branches → **"Fixed set of React primitives"** box (`PRIMITIVES` registry).
6. Aakhri box: **"Rendered card in chat UI"**.
7. Ek chhota red caption "no eval() anywhere" neeche — yeh reinforce karta hai ki har step lookup/switch hai, interpreter nahi.

## Interview questions

**Q: Widget data untrusted kyun hai, aur is system ka core safety guarantee kya hai?**
A: Data ultimately AI tool-call output ya knowledge-base content se aata hai — dono Freddy ke apne deterministic control mein nahi hain. Core guarantee: render pipeline mein kahin bhi expression evaluator nahi hai — renderer ek closed `NODE_TYPES` list se pick karta hai aur `$bind` paths ko sirf walk karta hai, kabhi string ko code ki tarah execute nahi karta (`tree.ts:7-9`).

**Q: `{$bind: "$.path"}` aur ek JS template string mein fundamental difference kya hai?**
A: Template string ek expression evaluate karta hai — arithmetic, function calls, kuch bhi ho sakta hai. `$bind` sirf ek dot/bracket path hai jise `resolvePath` (`resolve.ts:47-74`) plain object traversal se walk karta hai — koi parser nahi, sirf `.split(".")` aur key lookup. Computation ki gunjaish hi nahi hai.

**Q: Prototype pollution attack widget data se kaise ho sakta tha, aur code isse kaise rokta hai?**
A: Agar model `"$.__proto__.polluted"` jaisa path bhej de aur lookup blindly `base[key]` kare, toh `Object.prototype` tak pahunch sakta tha. `resolve.ts:65-67` explicitly `__proto__`, `constructor`, `prototype` segments ko reject kar deta hai — yeh check har path lookup ke andar hai, bypass nahi ho sakta.

**Q: `when` false hone pe children mount kyun nahi hote, aur yeh kyun matter karta hai?**
A: `RenderNode` (`render.tsx:79`) sabse pehle `when` check karta hai — false pe turant `null` return, props resolve ya children recurse kabhi hota hi nahi. Isse malformed ya missing-data child kabhi render attempt bhi nahi karta jab tak parent visible na ho.

**Q: `repeat` ko separate function mein kyun implement kiya, single fragment return kyun nahi kiya?**
A: Comment (`render.tsx:120-133`) explain karta hai — agar repeat ek `<>{...}</>` fragment return kare, toh `Carousel` jaisa parent jo children ko individually slot karta hai usko sirf "ek child" dikhta hai, aur poora fragment ek slot mein chala jaata hai (vertical stack bug). `expandRepeat` isliye `ReactElement[]` return karta hai jo parent ke flat children array mein merge ho jaata hai.

**Q: Version mismatch ho (purani definition, naya data shape) toh crash hoga?**
A: Nahi, system deliberately degrade karta hai. `getWidget` (`registry.ts:48-62`) exact version na milne pe latest fallback karta hai. Unknown node type ho toh sirf warning ke saath `null` (`render.tsx:82-87`). Missing field pe `resolvePath` `undefined` return karta hai jo silently empty render hota hai — "an unresolved binding renders as empty rather than as an error" (`registry.ts:44-46`).

**Q: `stateBy` widget ko "reconstructible" kaise banaata hai?**
A: `stateBy` data ke ek field ki value ko `map` mein lookup karke batata hai kaunsa named `states` entry render hoga (`render.tsx:250-257`). State local React state se nahi, data se derive hoti hai — isliye conversation reopen karne pe stored `data` replay hoke exactly wahi state deterministically wapas aati hai, jaise booking "confirmed" state permanently stick karta hai `onDataChange` ke baad (`render.tsx:200-208`).

**Q: Naya widget primitive add karna ho, toh kya-kya touch karna padega?**
A: Teen jagah: `tree.ts` ke `NODE_TYPES` mein naya string, ek React component `primitives/` mein, aur `primitives/index.ts` ke `PRIMITIVES` record mein map. `PRIMITIVES` ka type `Record<NodeType, ComponentType<...>>` hai — agar renderer add karna bhool jao, TypeScript compile hi fail ho jaayega, blank widget silently nahi milega.

## Common confusions (log yahan confuse hote hain)

- `$bind` ko log mini-templating-language samajh lete hain jisme filters chain kar sakte ho — actual mein yeh sirf ek path hai, computation zero.
- `when` ko full JS boolean expression samajh lete hain — actual mein sirf ek path ke against `is`/`oneOf`/truthiness test hai (`tree.ts:83-96`), do paths compare nahi kar sakte.
- `repeat` ko `.map()` jaisa treat karte hain jisme arbitrary transform ho sake — actual mein sirf array pe iterate karta hai, filtering/sorting logic data mein hi ready honi chahiye.
- Naye log sochte hain Zod schema validation hi security handle karti hai — schema sirf shape check karta hai; XSS/injection protection specific checks se aata hai (`isSafeUrl`, prototype-key guard), generic validation se nahi.
