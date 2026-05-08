# Mercury PWA UI Restyle Plan: Ciphera Match

## Goal
Restyle `clients/apps/pwa` so the Mercury wallet PWA visually matches the local Ciphera PWA as closely as practical while preserving the existing Mercury wallet protocol calls, local regtest helper tooling, and transaction/detail behavior.

## Source References
- Mercury app: `clients/apps/pwa/src/main.jsx`
- Mercury styles: `clients/apps/pwa/src/styles.css`
- Ciphera tokens: `/Users/iansagstetter/Desktop/ciphera-pwa/src/styles/tokens.css`
- Ciphera home styling: `/Users/iansagstetter/Desktop/ciphera-pwa/src/styles/home.css`
- Ciphera primitive styling: `/Users/iansagstetter/Desktop/ciphera-pwa/src/styles/primitives.css`
- Ciphera button primitive: `/Users/iansagstetter/Desktop/ciphera-pwa/src/components/pill-button.ts`

## Design Target
The Mercury PWA should look like a sibling wallet to Ciphera:
- Black canvas with a subtle centered radial glow.
- Narrow mobile-app shell on desktop, capped around `480px`.
- Satoshi-style typography if local font assets are added, otherwise use the same fallback stack.
- Large centered balance hero.
- Sparse top bar with brand mark/name on the left and a round settings/tools icon on the right.
- Pill CTAs with a white primary button and black secondary outlined button.
- Minimal icon-only bottom navigation.
- White rounded bottom sheets for send/receive/detail flows.
- Dark settings/dev-tool screens with accordion-like sections.

## Non-Goals
- Do not change Mercury protocol behavior.
- Do not replace `mercuryweblib` calls.
- Do not add a router unless a later implementation needs it.
- Do not attempt to copy Ciphera product language or brand names.
- Do not redesign the regtest helper itself beyond moving it into Ciphera-like dark panels.

## Phase 1: Token And Shell Foundation
- Replace Mercury’s current light theme in `styles.css` with Ciphera-compatible CSS variables:
  - `--bg: #000000`
  - `--bg-elevated: #000000`
  - `--bg-sheet: #ffffff`
  - `--bg-gradient: radial-gradient(circle at 50% 24%, rgba(20,20,20,1) 0%, rgba(0,0,0,1) 52%)`
  - `--fg: #ededed`
  - `--fg-muted: #9a9a9a`
  - `--fg-faint: #444444`
  - `--fg-on-sheet: #000000`
  - `--stroke: rgba(255,255,255,0.12)`
  - `--stroke-strong: rgba(255,255,255,0.49)`
  - `--radius-pill: 100px`
  - `--tab-height: 64px`
- Change `body` and `.app-shell` from full-width light page to Ciphera-style app frame:
  - black/radial background
  - `height: 100dvh`
  - `max-width: 480px`
  - centered on desktop
  - no outer light page gutter
- Keep the app as React, but rename CSS classes toward Ciphera equivalents where helpful:
  - `.wallet-screen` -> Ciphera-like home shell behavior
  - `.button` -> pill styling
  - `.bottom-nav` -> non-floating dark tab bar

## Phase 2: Home Screen Match
- Rework `renderWalletView()` into a Ciphera-style home screen:
  - Top bar:
    - left: Mercury mark/text, compact and white
    - right: round icon button for Settings/Tools
  - Hero:
    - `BALANCE` eyebrow
    - large centered balance text
    - display statecoin balance as the main wallet balance
    - move demo helper L1 funds out of the hero
  - Primary CTAs:
    - left secondary outlined pill: `Receive`
    - right primary white pill: `Send` or `Pay`
    - match Ciphera dimensions: `min-height: 64px`, pill radius, 12px gap
- Remove the current light `fund-card` pair from the main wallet surface or convert it into a secondary dark details section below the fold.
- Keep transaction history, but restyle it as dark, sparse list rows:
  - icon circle
  - label
  - short statechain/deposit id in muted mono text
  - amount on right
  - no white cards on the home canvas

## Phase 3: Navigation And Tool Placement
- Replace current floating two-tab nav with a Ciphera-style bottom tab bar:
  - fixed to app shell bottom through grid layout rather than overlaying content
  - black background
  - top border `var(--stroke)`
  - icon-only or very subtle labels
- Suggested tabs:
  - Wallet
  - Activity
  - Tools
- Map current views:
  - `wallet` -> Wallet
  - transaction list is still visible on Wallet, but Activity can later become a full transaction screen
  - current `miner` view -> Tools
- Fix the existing overlap issue by making `.app-shell` a grid:
  - `grid-template-rows: 1fr auto`
  - `.page-container` scrolls
  - tab bar consumes layout space instead of floating over content

## Phase 4: Sheets And Dialogs
- Restyle all modal dialogs to match Ciphera’s white bottom-sheet pattern:
  - backdrop darkens the wallet
  - sheet anchors to bottom on mobile
  - sheet max-width follows the app shell on desktop
  - large radius on top corners, white background
  - black text and controls inside sheet
  - small gray drag handle at top
- Apply to:
  - Send flow
  - Receive flow
  - Transaction detail
- Preserve existing fields and actions, but change hierarchy:
  - Send: title `Pay via Statecoin`, statecoin selector, recipient input, review box, primary pill.
  - Receive: title `Receive via`, method cards for `Statecoin` and `Bitcoin UTXO`.
  - Detail: concise summary first, protocol steps as white-sheet rows, raw data collapsed.

## Phase 5: Tools/Settings Restyle
- Convert the current `renderMinerView()` panels into Ciphera-like dark settings accordions:
  - Regtest helper
  - Mine coins
  - Block tools
  - Latest deposit
  - Wallet
  - Network
- Use black page background and thin dividers instead of white panels.
- Keep developer/regtest language, but make it visually secondary:
  - muted captions
  - small status pills
  - white primary pill only for active primary tool action
- Move wallet creation/selection out of miner wording if possible:
  - rename the tab `Tools`
  - keep `Wallet` section as the first accordion so first-time setup is discoverable.

## Phase 6: Component Cleanup
- Extract small reusable React components from `main.jsx` only if the restyle becomes hard to maintain:
  - `PillButton`
  - `IconButton`
  - `BottomSheet`
  - `TabBar`
  - `DarkPanel`
- Keep the first implementation scoped to `main.jsx` and `styles.css` if possible, matching the existing Mercury app shape.
- Reuse existing inline SVG icon approach unless adding `lucide` is acceptable. If adding `lucide`, use the package consistently and remove hand-drawn icon variants.

## Phase 7: Accessibility And State Polish
- Add visible disabled styles that match Ciphera:
  - disabled pills transparent/dim with subdued border
  - no full-opacity disabled primary buttons
- Add `aria-label` to icon-only nav/settings buttons.
- Add `aria-live="polite"` to status/error toast.
- Add Escape key support for sheets.
- Consider focus trap for open sheets.
- Ensure clipboard actions surface success/failure in the toast.

## Phase 8: Visual QA
- Run:
  - `npm run build` in `clients/apps/pwa`
  - local Vite server for visual review
- Check viewports:
  - 390 x 844 mobile
  - 430 x 932 large mobile
  - 1280 x 720 desktop
- Compare against Ciphera screenshots for:
  - canvas tone
  - app shell width
  - balance hero vertical placement
  - pill height/radius
  - bottom nav placement
  - sheet radius and color
  - no content hidden by nav
- Smoke test core Mercury flows:
  - create/select wallet
  - receive statecoin address
  - deposit Bitcoin UTXO in regtest helper path
  - send statecoin
  - refresh/receive transfers
  - transaction detail
  - miner/tools actions

## Implementation Order
1. Add Ciphera tokens and app shell CSS.
2. Restyle home and primary CTAs.
3. Replace bottom nav layout.
4. Restyle sheets.
5. Restyle tools/settings.
6. Fix accessibility and disabled states.
7. Build and screenshot QA.

## Acceptance Criteria
- Mercury no longer reads as a light dashboard; it reads as a black, mobile-first wallet in the Ciphera visual family.
- Home screen composition is visually close to Ciphera: compact top bar, centered balance, bottom CTAs, dark tab bar.
- Dialogs look like Ciphera bottom sheets rather than centered desktop modals.
- Tools remain available but no longer dominate the wallet experience.
- No existing Mercury wallet operation is removed.
- Build passes and screenshots show no overlapping text, hidden controls, or nav obstruction.
