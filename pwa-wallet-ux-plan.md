# PWA Wallet UX Plan

## Goal
Make `clients/apps/pwa` feel like a simple wallet first: send, receive, and inspect transaction history. Keep Bitcoin UTXO deposits inside the receive flow, and keep regtest mining/protocol controls available but outside the main wallet surface.

## Direction From Reference
- Minimal white wallet surface.
- Clear brand mark at top.
- Large balance readout.
- Primary action buttons near the top.
- Empty transaction state centered in the main body.
- Bottom navigation with wallet, apps/dev tools, and settings.

## Proposed Views

### Wallet
- Top area:
  - Mercury mark/name.
  - Active wallet selector or compact wallet identity.
  - Balance shown in sats and optionally BTC/USD placeholder later.
  - Server/helper status as a small indicator, not a dominant config panel.
- Primary actions:
  - Send.
  - Receive.
- Main body:
  - Transaction list.
  - Empty state: "No transactions yet" with a direct Receive action.
- Transaction rows:
  - Type: Deposit, Send, Receive, Withdraw.
  - Amount.
  - Status.
  - Short statechain ID.
  - Timestamp if available, otherwise local session time for app-generated events.

### Miner Actions
- Regtest helper status.
- Mine blocks.
- Fund latest deposit.
- Refresh wallet/transactions.
- Optional raw helper endpoint settings.
- Clear labeling that this is local development tooling.

### Settings
- Endpoint configuration.
- Wallet creation/selection.
- Advanced raw config values.
- Possibly reset local wallet/demo state.

## Dialogs

### Send
- Select a confirmed statecoin from wallet balance.
- Recipient statecoin address input.
- Review summary before sending if practical.

### Receive
- Start with a clear two-option choice:
  - Receive Statecoin.
  - Deposit Bitcoin UTXO.
- Receive Statecoin path:
  - Generate a statecoin receive address.
  - Show copyable statecoin address.
  - Button to check for pending transfers.
- Deposit Bitcoin UTXO path:
  - Amount input.
  - One primary action: create deposit request.
  - Internally this can request a token and create the deposit address in one flow.
  - Show Bitcoin deposit address.
  - Show a small local-testing area for helper funding/mine actions when running regtest, while keeping the full miner tool view separate.

### Transaction Detail
The modal should fill enough of the screen to teach the statecoin flow:
- Human summary: what happened and current status.
- Amount and direction.
- Statechain ID.
- Statecoin address or aggregated address.
- Deposit address or recipient receive address when relevant.
- Protocol steps:
  - Deposit: token requested, deposit address created, funding seen, confirmations.
  - Send: selected statecoin, recipient address, transfer message created, sender state updated.
  - Receive: receive address created, transfer message found, receiver finalized ownership.
  - Withdraw: statecoin selected, Bitcoin address, withdrawal broadcast/complete state.
- Raw data section with formatted JSON for users who want to inspect details.

## Implementation Shape
- Keep the app in `clients/apps/pwa/src/main.jsx` and `styles.css` for the first pass.
- Add local transaction derivation from `listStatecoins` plus session events from actions.
- Replace the always-visible config sidebar with bottom navigation and a settings view.
- Preserve current Mercury web library calls.
- Avoid changing protocol/library behavior in this UX pass.

## Open Decisions
- Whether to keep multi-wallet switching on the wallet screen or move it to Settings.
- How much local session history to store beyond what `listStatecoins` returns.
