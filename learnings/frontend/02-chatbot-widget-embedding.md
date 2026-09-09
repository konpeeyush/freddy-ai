# Chatbot Widget Embedding — Shadow DOM aur Web Component
_Kisi bhi website mein ek `<script>` tag daalo, ek custom HTML tag likho, aur bas — chatbot ready, bina kisi framework ke aur bina host page ka CSS todhe._

## Yeh hai kya? (What is this)

`apps/chatbot` ek embeddable widget hai jo ek native Web Component (browser ka apna built-in feature, koi library nahi) ke roop mein ship hota hai — `<freddy-chat>`. Koi bhi website — React ho, plain HTML ho, WordPress ho — bas ek `<script>` include karke `<freddy-chat api-url="...">` likh sakti hai, aur andar poora React 19 app chal raha hota hai. Trick yeh hai ki poora widget ek "closed shadow DOM" (browser-native private mini-DOM) ke andar render hota hai, jo isse host page se completely isolate kar deta hai.

## Yeh kyun banaya gaya? (Why it exists)

Do problems solve karni thi. Pehli: widget kisi bhi random website pe drop hoga, jiska CSS kaisa bhi ho sakta hai. Normal DOM mein render hota toh host ka CSS usko tod deta aur widget ka CSS host page ko tod deta. Shadow DOM dono directions band kar deta hai.

Dusri problem popups ki thi. UI library (Base UI) default mein popups ko `document.body` mein "portal" karti hai, jo shadow boundary ke BAHAR hai — isliye wahan render hua popup widget ka stylesheet dekh hi nahi paata. Code khud explain karta hai:

```tsx
// apps/chatbot/src/lib/shadow.tsx:6-11
 * Base UI portals default to `document.body`, which is outside our shadow
 * boundary — a portalled popup would render unstyled, since the injected
 * stylesheet only exists inside the root. It also cannot go on the bare shadow
 * root: the React container is `display: contents`, leaving a portal there with
 * no stacking context, so it paints behind the host page. `mount()` creates a
 * fixed, high-z-index layer for it instead.
```

## Kaise kaam karta hai (How it works, step by step)

1. **Registration.** `src/index.ts` load hote hi `defineElement()` call karta hai, jo `customElements.define("freddy-chat", ChatWidgetElement)` karta hai (`element.tsx:60-64`). Ab browser `<freddy-chat>` ko real HTML element treat karta hai.

2. **Do use karne ke tareeke.** Ya toh khud `<freddy-chat mode="inline">` likho page mein, ya sirf `<script data-auto>` daal do aur `autoMount()` (`index.ts:45-60`) khud element bana ke `document.body` mein append kar deta hai.

3. **`connectedCallback()`** (browser element ko DOM mein daalte hi call karta hai) `readConfig(this)` se HTML attributes parse karta hai aur `mount(this, config)` call karta hai (`element.tsx:16-19`).

4. **Shadow root banta hai:** `host.attachShadow({ mode: "closed" })` (`mount.tsx:60`). "Closed" matlab host page ka JS bhi `element.shadowRoot` se andar nahi ghus sakta.

5. **CSS `adoptedStyleSheets` se inject hoti hai,** na ki normal `<style>` se — kyunki Vite normally `<style>` ko page ke `<head>` mein daalta, jo shadow root ke andar visible nahi hota. `?inline` import se CSS string milti hai, ek `CSSStyleSheet` parse hoti hai aur sab instances mein share hoti hai (`mount.tsx:29-36`).

6. **Portal layer banta hai** — ek `<div>` jo shadow root ke andar hai, `position: fixed` + high `z-index` (`mount.tsx:76-84`). `ShadowContext` (`lib/shadow.tsx`) isko React tree mein pass karta hai, taaki popups yahan portal karein, `document.body` mein nahi.

7. **React render hota hai** `createRoot(container).render(<App .../>)` se. `App` (`app.tsx`) mode ke hisaab se `FloatingContainer` / `InlineContainer` / `FullscreenContainer` render karta hai.

8. **Live attribute changes.** `attributeChangedCallback()` (`element.tsx:26-46`) sirf `theme` ko cheaply handle karta hai. Kisi bhi aur attribute (jaise `mode`) change hone par poora element replace ho jaata hai — kyunki attach hua shadow root kisi naye host pe move nahi ho sakta, isliye fresh element hi option hai.

9. **Imperative control.** Host page apne button se widget control kar sakta hai: `document.querySelector('freddy-chat').open()`, kyunki `open()`/`close()`/`toggle()` khud `ChatWidgetElement` class ke methods hain (`element.tsx:49-57`).

10. **Teardown.** `disconnectedCallback()` `widget.destroy()` call karta hai, jo `queueMicrotask` mein React root unmount karta hai (React apne render cycle ke beech unmount hone par warning deta hai).

## Code walkthrough

- **`element.tsx:10-19`** — `ChatWidgetElement extends HTMLElement`, native custom element class. `connectedCallback` config parse karke `mount()` call karta hai — widget ka entry point.

- **`mount.tsx:59-60`** — closed shadow DOM banane ki line:
```tsx
export function mount(host: HTMLElement, config: WidgetConfig): MountedWidget {
  const shadow = host.attachShadow({ mode: "closed" })
```

- **`lib/shadow.tsx:13-19`** — `ShadowContext`, ek React Context jo portal container ko poore tree mein available karata hai (`usePortalContainer()` se access hota hai).

- **`element.tsx:33-45`** — theme vs baaki attributes ka split logic, classic interview "why":
```tsx
if (name === "theme") {
  this.#config = readConfig(this)
  this.#widget.setTheme(this.#config.theme)
  return
}
// A shadow root cannot be detached, so a remount means a fresh host.
const replacement = document.createElement(TAG_NAME)
```

- **`lib/config.ts:58-70`** — `readConfig()` HTML attributes ko typed `WidgetConfig` mein convert karta hai, sensible fallbacks ke saath.

- **`mount.tsx:91-106`** — inline mode ke liye host explicitly sized banana padta hai (page layout mein participate karta hai); floating/fullscreen `display: contents` rakhke layout se escape karte hain.

## Diagram

Neeche diagram (`02-chatbot-widget-embedding.excalidraw`) mein dikhaya gaya hai ki widget host page ke andar kaise nest hota hai. Ise excalidraw.com pe kholne ke liye File → Open use karo, ya file seedha canvas pe drag karo.

Flow: sabse bahar ek bada box "Host Website (real DOM)" hai — usme `document.body` bhi ek separate box hai (dikhane ke liye ki popups yahan NAHI jaate). Uske andar `<freddy-chat>` element ka box hai. Us box ke andar ek dashed-border box hai "Shadow DOM (closed)" — yeh isolation boundary hai. Is boundary ke andar do boxes side by side: "React App Tree" (jahan `App`, containers, ChatPanel render hote hain) aur "Portal Layer" (fixed, high z-index, jahan dropdowns/dialogs jaate hain). Ek arrow "attachShadow(closed)" label ke saath `<freddy-chat>` se shadow boundary ki taraf jaata hai. Ek dusra arrow `document.body` se "Portal Layer" tak jaata hai, cross/blocked mark ke saath — yeh dikhata hai ki normal Base UI portal wahan jaata, lekin humne use redirect kiya shadow ke andar.

## Interview questions

**Q: `<freddy-chat>` kaam kaise karta hai bina kisi framework ke host page pe?**
A: Yeh ek native Web Component hai — `customElements.define("freddy-chat", ChatWidgetElement)` (`element.tsx:60-64`) browser ko sikhaata hai ki is tag ka matlab kya hai. Browser khud `connectedCallback()` call karta hai, koi framework runtime host page pe chahiye hi nahi.

**Q: Shadow DOM kya hai aur yahan kyun use kiya gaya?**
A: Ek private mini-DOM tree jo element ke saath attach hoti hai, apna alag style scope rakhti hai. Do direction mein isolation chahiye thi: host ka CSS widget na todhe, widget ka CSS host na todhe. `host.attachShadow({ mode: "closed" })` (`mount.tsx:60`) yeh dono deta hai.

**Q: "closed" vs "open" shadow root — yahan closed kyun?**
A: Open mode mein host page ka JS `element.shadowRoot` se andar mutate kar sakta hai. Closed mode mein wo property `null` return karti hai. Comment (`mount.tsx:56-57`) explicit hai: "so host-page scripts cannot reach in via `.shadowRoot` and mutate our DOM."

**Q: Theme change aur mode change mein alag behavior kyun hai?**
A: Theme sirf ek `data-theme` flag hai, in-place update ho sakta hai. `mode`/`position`/`trigger` tree shape hi badal dete hain, aur shadow root ek baar attach hone ke baad kisi naye host pe move nahi ho sakta — isliye purana element replace karna hi ek tareeka hai (`element.tsx:40-45`).

**Q: Base UI popups yahan kahan jaate hain by default, aur widget mein kaise handle hua?**
A: Default `document.body` mein — shadow boundary ke bahar, so unstyled render hota. Fix: `mount()` shadow root ke andar ek `fixed`, high-`z-index` div banata hai (`mount.tsx:76-84`) aur `ShadowContext` se poore tree ko provide karta hai, taaki popups wahan portal karein.

**Q: React container `display: contents` kyun, aur portal layer alag div kyun?**
A: `display: contents` apna stacking context nahi banata — bare container mein portal ho toh stack karne ke liye kuch nahi, host page ke peeche paint ho jaata (`mount.tsx:73-75`). Portal layer isliye `position: fixed` + explicit `z-index` ke saath alag hai.

**Q: Naya container mode add karna ho (jaise "sidebar"), kya-kya touch karna padega?**
A: `lib/config.ts` mein `Mode` type + `MODES` array (`config.ts:1,41`), `app.tsx` ke `content` ternary mein naya branch, `containers/` mein naya file. `OBSERVED_ATTRIBUTES` mein `mode` already hai toh remount automatic hoga.

**Q: `adoptedStyleSheets` kyun, Vite default `<style>` injection kyun nahi?**
A: Vite normally CSS `<head>` mein `<style>` tag se daalta hai, jo shadow root ke andar visible nahi hota. `?inline` import se raw CSS string leke `CSSStyleSheet` banaya jaata hai aur `adoptedStyleSheets` pe assign hota hai (`mount.tsx:6-8, 29-36, 63`) — ek parsed sheet sab instances mein share hoti hai.

**Q: Yeh design kaise galat use ho sakta hai (breaking change)?**
A: Sabse common: koi `attachShadow({ mode: "open" })` kar de "debugging aasaan" bolke — isolation todhta hai. Doosra: naya popup component `usePortalContainer()` use na kare — silently `document.body` mein unstyled render hoga, TypeScript nahi pakdega. Teesra: inline mode mein host ki height missing ho — `mount.tsx:96-106` ka `100dvh` fallback logic hata do toh panel infinitely grow karega.

## Common confusions (log yahan confuse hote hain)

- Shadow DOM sirf styling isolation ke liye lagta hai, lekin `closed` mode security bhi deta hai — host JS access nahi kar sakta, sirf CSS isolation nahi.
- "Custom element sirf ek wrapper hai" — nahi, `ChatWidgetElement` khud real `HTMLElement` subclass hai jiske lifecycle methods browser directly call karta hai; React sirf iske andar mount hota hai.
- "Attribute change pe poora element replace kyun" — React ki limitation nahi, browser platform ki: shadow root ek baar attach hone ke baad us element se kabhi detach nahi hoti.
- Portal layer ka `pointer-events: none` (popups apna `pointer-events: auto` set karte hain) important hai — warna widget ke upar ek invisible click-blocking layer ban jaata.
