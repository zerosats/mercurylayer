# Task Plan: PWA Wallet UX Redesign

## Goal
Plan a wallet-oriented redesign for the Mercury PWA before making implementation changes.

## Phases
- [x] Phase 1: Capture user goals and visual direction
- [x] Phase 2: Define information architecture and primary wallet flow
- [x] Phase 3: Decide transaction detail model and miner/dev actions
- [x] Phase 4: Execute UI changes after approval
- [x] Phase 5: Run and verify locally

## Key Questions
1. What should be visible on the main wallet screen versus tucked into dev/miner tools?
2. What objects should appear in the transaction list: deposits, received statecoins, sent transfers, withdrawals, or all statecoin lifecycle events?
3. What details should the transaction inspection modal teach without overwhelming a wallet user?
4. Should the app support multiple wallets in the primary UI, or keep that in settings/dev tools?

## Decisions Made
- Main screen should feel like a simple wallet inspired by the reference screenshot: balance at top, primary Send/Receive actions, transaction list below.
- Main wallet should have two primary actions: Send and Receive.
- Receive should offer two paths: Receive Statecoin or Deposit Bitcoin UTXO.
- Mining/block generation belongs in a separate dev-oriented view rather than the main wallet surface.
- Transaction rows should open an inspection modal with full statecoin lifecycle details and explanatory structure.

## Errors Encountered
- Browser verification against `http://localhost:5173` was blocked by the browser tool security policy. `npm run build` succeeded.

## Status
**Complete** - PWA UI and flow updated; build verification passed.
