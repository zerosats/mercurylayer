import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import mercuryweblib from "mercuryweblib";
import QRCode from "qrcode";
import "./styles.css";

const DEFAULT_CONFIG = {
  esploraServer: "http://localhost:8094/regtest",
  statechainEntity: "http://localhost:8000",
  regtestHelper: "http://localhost:3000",
  network: "regtest",
  feeRateTolerance: 5,
  confirmationTarget: 2,
  maxFeeRate: 1
};

const SETTINGS_KEY = "mercury-pwa:settings";
const WALLET_PREFIX = "mercury-layer:";
const EVENTS_PREFIX = "mercury-pwa:events:";
const DEMO_L1_FUNDS_KEY = "mercury-pwa:demo-l1-funds";
const REGTEST_BLOCK_SUBSIDY_SATS = 5000000000;

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_KEY);
  return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
}

function loadEvents(walletName) {
  if (!walletName) return [];
  const saved = localStorage.getItem(`${EVENTS_PREFIX}${walletName}`);
  if (!saved) return [];
  try {
    return JSON.parse(saved);
  } catch {
    return [];
  }
}

function loadDemoL1Funds() {
  return Number(localStorage.getItem(DEMO_L1_FUNDS_KEY) || 0);
}

function loadMercuryWallet(walletName) {
  const saved = localStorage.getItem(`${WALLET_PREFIX}${walletName}`);
  if (!saved) return null;
  try {
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

function walletNames() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(WALLET_PREFIX) && !key.slice(WALLET_PREFIX.length).includes("-"))
    .map((key) => key.slice(WALLET_PREFIX.length))
    .sort();
}

function shortId(value = "") {
  if (!value) return "Pending";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatAmount(value) {
  if (value === undefined || value === null || value === "") return "Amount pending";
  return `₿\u00a0${Number(value).toLocaleString()}`;
}

function BalanceAmount({ value }) {
  const formatted = Number(value || 0).toLocaleString();
  const groups = formatted.split(",");

  if (groups.length <= 3) {
    return <>{formatAmount(value)}</>;
  }

  const splitAt = Math.ceil(groups.length / 2);
  const firstLine = `${groups.slice(0, splitAt).join(",")},-`;
  const secondLine = groups.slice(splitAt).join(",");

  return (
    <span className="balance-lines">
      <span>₿&nbsp;{firstLine}</span>
      <span>{secondLine}</span>
    </span>
  );
}

function nowLabel() {
  return new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Button({ children, onClick, disabled, tone = "primary", className = "" }) {
  return (
    <button type="button" className={`button ${tone} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill ${(status || "pending").toLowerCase()}`}>{status || "Pending"}</span>;
}

function AmountNumpad({ onDigit, onBackspace }) {
  return (
    <div className="numpad" aria-label="Amount keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <button type="button" key={digit} onClick={() => onDigit(digit)}>{digit}</button>
      ))}
      <button type="button" className="numpad-blank" tabIndex="-1" aria-hidden="true" disabled />
      <button type="button" onClick={() => onDigit("0")}>0</button>
      <button type="button" aria-label="Backspace" onClick={onBackspace}>←</button>
    </div>
  );
}

function ReceiveQr({ value }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!value) return;

    QRCode.toCanvas(canvasRef.current, value, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#000000",
        light: "#ffffff"
      }
    })
      .catch(() => {});
  }, [value]);

  return (
    <div className="receive-qr-wrap" aria-label="Statecoin address QR code">
      <div className={`receive-qr ${value ? "" : "empty"}`}>
        <canvas ref={canvasRef} aria-hidden={!value} />
      </div>
    </div>
  );
}

function LucideIcon({ name }) {
  const commonProps = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  if (name === "bitcoin") {
    return (
      <svg {...commonProps}>
        <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l2.431-13.79" />
      </svg>
    );
  }

  if (name === "pickaxe") {
    return (
      <svg {...commonProps}>
        <path d="m14.531 12.469 6.097 6.096a2 2 0 0 1-2.829 2.829l-6.096-6.097" />
        <path d="M9.586 7.586 4.293 12.88a1 1 0 0 1-1.414 0l-1.172-1.172a1 1 0 0 1 0-1.414L6.999 5" />
        <path d="m13 6 2-2 5 5-2 2" />
        <path d="M9 3h4v4" />
        <path d="m3 21 7.5-7.5" />
      </svg>
    );
  }

  if (name === "transactions") {
    return (
      <svg {...commonProps}>
        <path d="M3 6h18" />
        <path d="M3 12h18" />
        <path d="M3 18h18" />
        <path d="M7 6v.01" />
        <path d="M7 12v.01" />
        <path d="M7 18v.01" />
      </svg>
    );
  }

  if (name === "send") {
    return (
      <svg {...commonProps}>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </svg>
    );
  }

  if (name === "receive") {
    return (
      <svg {...commonProps}>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (name === "share") {
    return (
      <svg {...commonProps}>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.59 13.51 6.83 3.98" />
        <path d="m15.41 6.51-6.82 3.98" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...commonProps}>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    );
  }

  if (name === "paste") {
    return (
      <svg {...commonProps}>
        <path d="M8 4h8" />
        <path d="M9 2h6v4H9z" />
        <path d="M16 4h2a2 2 0 0 1 2 2v4" />
        <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
        <path d="M14 18h8" />
        <path d="m18 14 4 4-4 4" />
      </svg>
    );
  }

  if (name === "scan") {
    return (
      <svg {...commonProps}>
        <path d="M7 7h.01" />
        <path d="M17 7h.01" />
        <path d="M7 17h.01" />
        <path d="M17 17h.01" />
        <path d="M4 8V5a1 1 0 0 1 1-1h3" />
        <path d="M16 4h3a1 1 0 0 1 1 1v3" />
        <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
        <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
      </svg>
    );
  }

  if (name === "vault") {
    return (
      <svg {...commonProps}>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M7 6V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
        <circle cx="12" cy="13" r="3" />
        <path d="M12 10v6" />
        <path d="M9 13h6" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...commonProps}>
        <path d="M3 12a9 9 0 0 1 15.17-6.51" />
        <path d="M18 3v4h-4" />
        <path d="M21 12a9 9 0 0 1-15.17 6.51" />
        <path d="M6 21v-4h4" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function assertOk(response) {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response;
}

function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function transactionSummary(tx) {
  if (tx.kind === "deposit") return "Bitcoin UTXO deposited into a statecoin.";
  if (tx.kind === "send") return "Statecoin transfer sent to a recipient address.";
  if (tx.kind === "receive") return "Incoming statecoin ownership finalized in this wallet.";
  if (tx.kind === "withdraw") return "Statecoin withdrawal requested to a Bitcoin address.";
  return "Statecoin currently tracked in this wallet.";
}

function protocolSteps(tx) {
  if (tx.kind === "deposit") {
    return [
      ["Token requested", tx.token_id ? "Complete" : "Pending"],
      ["Deposit address created", tx.deposit_address ? "Complete" : "Pending"],
      ["Bitcoin UTXO funded", tx.funded ? "Complete" : "Waiting"],
      ["Statecoin confirmed", tx.status === "CONFIRMED" ? "Complete" : tx.status || "Waiting"]
    ];
  }
  if (tx.kind === "send") {
    return [
      ["Confirmed statecoin selected", tx.statechain_id ? "Complete" : "Pending"],
      ["Recipient statecoin address added", tx.recipient_address ? "Complete" : "Pending"],
      ["Transfer message created", "Complete"],
      ["Sender state updated", tx.status || "Submitted"]
    ];
  }
  if (tx.kind === "receive") {
    return [
      ["Receive address generated", tx.receive_address ? "Complete" : "Optional"],
      ["Transfer messages checked", "Complete"],
      ["Receiver ownership finalized", tx.received_count ? "Complete" : "No pending transfers"],
      ["Wallet refreshed", tx.status || "Complete"]
    ];
  }
  if (tx.kind === "withdraw") {
    return [
      ["Statecoin selected", tx.statechain_id ? "Complete" : "Pending"],
      ["Bitcoin address added", tx.bitcoin_address ? "Complete" : "Pending"],
      ["Withdrawal requested", tx.status || "Submitted"]
    ];
  }
  return [
    ["Wallet state loaded", "Complete"],
    ["Current status", tx.status || "Unknown"]
  ];
}

function App() {
  const [config, setConfig] = useState(loadSettings);
  const [wallets, setWallets] = useState(walletNames);
  const [activeWallet, setActiveWallet] = useState("");
  const [newWalletName, setNewWalletName] = useState("alice");
  const [coins, setCoins] = useState([]);
  const [events, setEvents] = useState([]);
  const [demoL1Funds, setDemoL1Funds] = useState(loadDemoL1Funds);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("1000");
  const [mineBlocks, setMineBlocks] = useState("101");
  const [depositInfo, setDepositInfo] = useState(null);
  const [transferAddress, setTransferAddress] = useState("");
  const [bitcoinReceiveAddress, setBitcoinReceiveAddress] = useState("");
  const [sendStatechainId, setSendStatechainId] = useState("");
  const [sendAddress, setSendAddress] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [helperOnline, setHelperOnline] = useState(false);
  const [activeView, setActiveView] = useState("wallet");
  const [dialog, setDialog] = useState(null);
  const [receiveMode, setReceiveMode] = useState("statecoin");
  const [sendMode, setSendMode] = useState("methods");
  const [selectedTx, setSelectedTx] = useState(null);
  const [isCreatingReceiveAddress, setIsCreatingReceiveAddress] = useState(false);
  const [isCreatingBitcoinAddress, setIsCreatingBitcoinAddress] = useState(false);

  const clientConfig = useMemo(() => ({
    ...config,
    confirmationTarget: Number(config.confirmationTarget),
    feeRateTolerance: Number(config.feeRateTolerance),
    maxFeeRate: Number(config.maxFeeRate)
  }), [config]);

  const confirmedCoins = coins.filter((coin) => coin.status === "CONFIRMED");
  const balance = confirmedCoins.reduce((total, coin) => total + Number(coin.amount || 0), 0);
  const totalWalletBalance = balance + demoL1Funds;

  const transactions = useMemo(() => {
    const eventByStatechain = new Map();
    const eventByAddress = new Map();

    events.forEach((event) => {
      if (event.statechain_id && !eventByStatechain.has(event.statechain_id)) {
        eventByStatechain.set(event.statechain_id, event);
      }
      const address = event.deposit_address || event.address;
      if (address && !eventByAddress.has(address)) {
        eventByAddress.set(address, event);
      }
    });

    const mergedEventIds = new Set();
    const coinTxs = coins.map((coin, index) => {
      const coinAddress = coin.aggregated_address || coin.address;
      const matchingEvent = eventByStatechain.get(coin.statechain_id) || eventByAddress.get(coinAddress);
      if (matchingEvent) mergedEventIds.add(matchingEvent.id);

      if (!matchingEvent && coin.amount == null && coin.status === "INITIALISED") {
        return null;
      }

      return {
        id: matchingEvent?.id || `coin-${coin.statechain_id || coin.address || index}`,
        kind: matchingEvent?.kind || "statecoin",
        title: matchingEvent?.title || (!coin.amount && coin.status === "INITIALISED" ? "Deposit setup incomplete" : coin.status === "CONFIRMED" ? "Statecoin ready" : "Statecoin pending"),
        amount: coin.amount ?? matchingEvent?.amount,
        status: matchingEvent?.status || coin.status,
        statechain_id: coin.statechain_id || matchingEvent?.statechain_id,
        address: coinAddress || matchingEvent?.deposit_address || matchingEvent?.address,
        deposit_address: matchingEvent?.deposit_address,
        funded: matchingEvent?.funded,
        created_at: matchingEvent?.created_at || "Wallet state",
        created_sort: matchingEvent?.created_sort || 0,
        raw: { event: matchingEvent, coin }
      };
    }).filter(Boolean);

    const standaloneEvents = events.filter((event) =>
      !mergedEventIds.has(event.id) &&
      event.kind !== "receive_address" &&
      event.title !== "Receive address created"
    );
    return [...standaloneEvents, ...coinTxs].sort((a, b) => (b.created_sort || 0) - (a.created_sort || 0));
  }, [coins, events]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(DEMO_L1_FUNDS_KEY, String(demoL1Funds));
  }, [demoL1Funds]);

  useEffect(() => {
    if (!activeWallet && wallets.length > 0) setActiveWallet(wallets[0]);
  }, [activeWallet, wallets]);

  useEffect(() => {
    setEvents(loadEvents(activeWallet));
  }, [activeWallet]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function checkHelper() {
      try {
        const response = await fetch(`${config.regtestHelper}/health`);
        setHelperOnline(response.ok);
      } catch {
        setHelperOnline(false);
      }
    }

    checkHelper();
  }, [config.regtestHelper]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setDialog(null);
      setSelectedTx(null);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function rememberEvent(event) {
    if (!activeWallet) return;
    rememberEventForWallet(activeWallet, event);
  }

  function rememberEventForWallet(walletName, event) {
    if (!walletName) return;
    const nextEvent = {
      id: `${event.kind}-${Date.now()}`,
      created_at: nowLabel(),
      created_sort: Date.now(),
      ...event
    };
    const nextEvents = [nextEvent, ...loadEvents(walletName)];
    localStorage.setItem(`${EVENTS_PREFIX}${walletName}`, JSON.stringify(nextEvents));
    if (walletName === activeWallet) {
      setEvents(nextEvents);
    }
  }

  function findLocalRecipientWallet(receiveAddress) {
    const trimmedAddress = receiveAddress.trim();
    if (!trimmedAddress) return "";

    return walletNames().find((walletName) => {
      const wallet = loadMercuryWallet(walletName);
      const hasMatchingCoin = wallet?.coins?.some((coin) => coin.address === trimmedAddress);
      const hasMatchingEvent = loadEvents(walletName).some((event) => event.receive_address === trimmedAddress);
      return hasMatchingCoin || hasMatchingEvent;
    }) || "";
  }

  async function copyText(value) {
    if (!value) return;
    await navigator.clipboard?.writeText(value).catch(() => {});
  }

  async function shareText(title, value) {
    if (!value) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: value });
        return;
      } catch {
        // Fall back to copying when share is cancelled or unavailable.
      }
    }
    await copyText(value);
  }

  async function run(label, fn) {
    setError("");
    setStatus(label);
    try {
      const result = await fn();
      setStatus("Done");
      return result;
    } catch (err) {
      setError(errorMessage(err));
      setStatus("Error");
      return null;
    }
  }

  async function refreshCoins(walletName = activeWallet) {
    if (!walletName) return;
    const nextCoins = await mercuryweblib.listStatecoins(clientConfig, walletName);
    setCoins(nextCoins);
  }

  async function refreshWalletWithPendingTransfers() {
    if (!activeWallet) return;
    await run("Refreshing wallet", async () => {
      const result = await mercuryweblib.transferReceive(clientConfig, activeWallet);
      if (result.receivedStatechainIds.length) {
        rememberEvent({
          kind: "receive",
          title: "Statecoin received",
          status: "Complete",
          received_count: result.receivedStatechainIds.length,
          statechain_id: result.receivedStatechainIds[0],
          receive_address: transferAddress,
          raw: result
        });
      }
      await refreshCoins();
      return result;
    });
  }

  async function createWallet() {
    await run("Creating wallet", async () => {
      const name = newWalletName.trim();
      if (!name) throw new Error("Wallet name is required.");
      await mercuryweblib.createWallet(clientConfig, name);
      setWallets(walletNames());
      setActiveWallet(name);
      setCoins([]);
      setActiveView("wallet");
    });
  }

  async function generateBlocks(blocks = config.confirmationTarget) {
    await fetch(`${config.regtestHelper}/generate_blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: Number(blocks) })
    }).then(assertOk);
  }

  async function depositBitcoinUtxo() {
    if (!activeWallet) return;
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before depositing Bitcoin UTXOs.");
      return;
    }

    const depositAmount = Number(amount);
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      setError("Enter a valid deposit amount.");
      return;
    }

    const result = await run("Depositing Bitcoin UTXO", async () => {
      const nextToken = await mercuryweblib.newToken(clientConfig);
      const tokenFee = Number(nextToken.fee || 0);
      const totalNeeded = depositAmount + tokenFee;

      if (demoL1Funds < totalNeeded) {
        throw new Error(`Not enough Bitcoin L1 funds. Mine coins first; this deposit needs ${formatAmount(totalNeeded)} including the token fee.`);
      }

      if (nextToken.deposit_address && tokenFee > 0) {
        await fetch(`${config.regtestHelper}/deposit_amount`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: nextToken.deposit_address, amount: tokenFee })
        }).then(assertOk);
        await generateBlocks(nextToken.confirmation_target || config.confirmationTarget);
      }

      const nextDeposit = await mercuryweblib.getDepositBitcoinAddress(clientConfig, activeWallet, nextToken.token_id, depositAmount);

      await fetch(`${config.regtestHelper}/deposit_amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: nextDeposit.deposit_address, amount: depositAmount })
      }).then(assertOk);

      await generateBlocks(config.confirmationTarget);

      setDepositInfo(nextDeposit);
      setDemoL1Funds((current) => Math.max(0, current - totalNeeded));
      rememberEvent({
        kind: "deposit",
        title: "Bitcoin UTXO deposited",
        amount: depositAmount,
        status: "Funded",
        funded: true,
        token_id: nextToken.token_id,
        statechain_id: nextDeposit.statechain_id,
        deposit_address: nextDeposit.deposit_address,
        raw: { token: nextToken, deposit: nextDeposit }
      });
      await refreshCoins();
      return nextDeposit;
    });

    if (result) {
      setDialog(null);
    }
  }

  async function fundDeposit() {
    if (!depositInfo?.deposit_address) return;
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before using funding or mining buttons.");
      return;
    }
    await run("Funding deposit", async () => {
      await fetch(`${config.regtestHelper}/deposit_amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: depositInfo.deposit_address, amount: Number(amount) })
      }).then(assertOk);
      rememberEvent({
        kind: "deposit",
        title: "Bitcoin UTXO funded",
        amount: Number(amount),
        status: "Funded",
        funded: true,
        deposit_address: depositInfo.deposit_address,
        raw: depositInfo
      });
      setDemoL1Funds((current) => Math.max(0, current - Number(amount)));
      await refreshCoins();
    });
  }

  async function mineAndRefresh() {
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before using funding or mining buttons.");
      return;
    }
    await run("Generating blocks", async () => {
      await generateBlocks(config.confirmationTarget);
      await refreshCoins();
    });
  }

  async function mineCoinsToHelper() {
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before mining coins.");
      return;
    }
    await run("Mining coins to helper wallet", async () => {
      await generateBlocks(mineBlocks);
      setDemoL1Funds((current) => current + (Number(mineBlocks) * REGTEST_BLOCK_SUBSIDY_SATS));
    });
    setStatus(`Mined ${Number(mineBlocks)} block(s) to the helper wallet`);
  }

  async function newReceiveAddress() {
    if (!activeWallet) return;
    setIsCreatingReceiveAddress(true);
    try {
      const address = await run("Creating transfer address", async () =>
        mercuryweblib.newTransferAddress(activeWallet)
      );
      if (!address?.transfer_receive) return;
      setTransferAddress(address.transfer_receive);
      rememberEvent({
        kind: "receive_address",
        title: "Receive address created",
        status: "Ready",
        receive_address: address.transfer_receive,
        raw: address
      });
    } finally {
      setIsCreatingReceiveAddress(false);
    }
  }

  async function newBitcoinReceiveAddress() {
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before creating Bitcoin receive addresses.");
      return;
    }
    setIsCreatingBitcoinAddress(true);
    try {
      const result = await run("Creating Bitcoin address", async () => {
        const response = await fetch(`${config.regtestHelper}/new_address`).then(assertOk);
        return response.json();
      });
      if (!result?.address) return;
      setBitcoinReceiveAddress(result.address);
      rememberEvent({
        kind: "bitcoin_receive_address",
        title: "Bitcoin receive address created",
        status: "Ready",
        bitcoin_address: result.address,
        raw: result
      });
    } finally {
      setIsCreatingBitcoinAddress(false);
    }
  }

  async function sendTransfer() {
    await run("Sending transfer", async () => {
      const statechainId = sendStatechainId.trim();
      const recipientAddress = sendAddress.trim();
      const sentAmount = confirmedCoins.find((coin) => coin.statechain_id === statechainId)?.amount;
      const localRecipientWallet = findLocalRecipientWallet(recipientAddress);

      await mercuryweblib.transferSend(clientConfig, activeWallet, statechainId, recipientAddress, false, null);

      let autoReceiveResult = null;
      let autoReceiveError = "";
      if (localRecipientWallet && localRecipientWallet !== activeWallet) {
        try {
          autoReceiveResult = await mercuryweblib.transferReceive(clientConfig, localRecipientWallet);
          rememberEventForWallet(localRecipientWallet, {
            kind: "receive",
            title: "Statecoin received",
            status: "Complete",
            received_count: autoReceiveResult.receivedStatechainIds.length,
            statechain_id: autoReceiveResult.receivedStatechainIds[0] || statechainId,
            receive_address: recipientAddress,
            amount: sentAmount,
            raw: autoReceiveResult
          });
        } catch (err) {
          autoReceiveError = errorMessage(err);
        }
      }

      rememberEvent({
        kind: "send",
        title: autoReceiveResult ? "Statecoin sent and received" : "Statecoin sent",
        status: autoReceiveResult ? "Complete" : "Sent",
        statechain_id: statechainId,
        recipient_address: recipientAddress,
        recipient_wallet: localRecipientWallet || undefined,
        amount: sentAmount,
        raw: {
          statechain_id: statechainId,
          recipient_address: recipientAddress,
          auto_receive_result: autoReceiveResult,
          auto_receive_error: autoReceiveError || undefined
        }
      });
      setDialog(null);
      setSendAddress("");
      await refreshCoins();
      if (autoReceiveResult) {
        setStatus(`Sent and received by ${localRecipientWallet}`);
      } else if (localRecipientWallet && autoReceiveError) {
        setStatus("Sent. Receiver acceptance needs retry.");
      }
    });
  }

  async function receiveTransfers() {
    const result = await run("Receiving transfers", async () =>
        mercuryweblib.transferReceive(clientConfig, activeWallet)
      );
    if (!result) return;
    rememberEvent({
      kind: "receive",
      title: result.receivedStatechainIds.length ? "Statecoin received" : "No pending transfers",
      status: "Complete",
      received_count: result.receivedStatechainIds.length,
      statechain_id: result.receivedStatechainIds[0],
      receive_address: transferAddress,
      raw: result
    });
    await refreshCoins();
    setStatus(`Received ${result.receivedStatechainIds.length} transfer(s)`);
  }

  async function withdrawCoin(statechainId) {
    await run("Withdrawing coin", async () => {
      await mercuryweblib.withdrawCoin(clientConfig, activeWallet, statechainId.trim(), withdrawAddress.trim(), null, null);
      rememberEvent({
        kind: "withdraw",
        title: "Statecoin withdrawn",
        status: "Submitted",
        statechain_id: statechainId.trim(),
        bitcoin_address: withdrawAddress.trim(),
        raw: { statechain_id: statechainId.trim(), bitcoin_address: withdrawAddress.trim() }
      });
      setWithdrawAddress("");
      await refreshCoins();
    });
  }

  function openSend(statechainId = "") {
    const nextStatechainId = statechainId || confirmedCoins[0]?.statechain_id || "";
    setSendStatechainId(nextStatechainId);
    setSendMode(statechainId ? "statecoin" : "methods");
    setDialog("send");
  }

  function openSendStatecoin() {
    if (confirmedCoins.length === 0) {
      setAmount("0");
      setSendMode("create");
      return;
    }

    setSendStatechainId(confirmedCoins[0]?.statechain_id || "");
    setSendMode("statecoin");
  }

  async function pasteSendAddress() {
    const clipboardText = await navigator.clipboard?.readText().catch(() => "");
    const nextAddress = String(clipboardText || "").trim();
    if (!nextAddress) {
      setError("Clipboard does not contain a statecoin address.");
      return;
    }
    setSendAddress(nextAddress);
    setSendStatechainId(confirmedCoins[0]?.statechain_id || "");
    setSendMode("selectCoin");
  }

  function openReceive(mode = "methods") {
    setReceiveMode(mode);
    setDialog("receive");
  }

  function openStatecoinReceive() {
    setTransferAddress("");
    setReceiveMode("statecoin");
    void newReceiveAddress();
  }

  function openBitcoinReceive() {
    setBitcoinReceiveAddress("");
    setReceiveMode("bitcoin");
    void newBitcoinReceiveAddress();
  }

  function appendDepositDigit(digit) {
    setAmount((current) => {
      const normalized = String(current || "0").replace(/\D/g, "") || "0";
      if (normalized.length >= 12) return normalized;
      return normalized === "0" ? digit : `${normalized}${digit}`;
    });
  }

  function backspaceDepositAmount() {
    setAmount((current) => {
      const normalized = String(current || "0").replace(/\D/g, "") || "0";
      return normalized.length > 1 ? normalized.slice(0, -1) : "0";
    });
  }

  function renderReceiveAddressPanel(kind) {
    const isBitcoin = kind === "bitcoin";
    const address = isBitcoin ? bitcoinReceiveAddress : transferAddress;
    const isCreating = isBitcoin ? isCreatingBitcoinAddress : isCreatingReceiveAddress;
    const label = isBitcoin ? "Receive Bitcoin" : "Receive Statecoin";
    const unavailableLabel = isBitcoin ? "Fresh Bitcoin address unavailable" : "Fresh statecoin address unavailable";
    const creatingLabel = isBitcoin ? "Creating fresh Bitcoin address..." : "Creating fresh statecoin address...";
    const shareTitle = isBitcoin ? "Mercury Bitcoin Address" : "Mercury Statecoin Address";

    return (
      <div className="receive-address-panel action-step">
        <div className="receive-amount-header">
          <p className="amount-label">{label}</p>
        </div>
        <ReceiveQr value={address} />
        <p className="receive-inline-status">
          {isCreating ? creatingLabel : address ? shortId(address, 18) : unavailableLabel}
        </p>
        <div className="receive-sheet-actions">
          <Button disabled={!address} tone="secondary" onClick={() => shareText(shareTitle, address)}>
            <LucideIcon name="share" />
            <span>Share Address</span>
          </Button>
          <Button disabled={!address} tone="secondary" onClick={() => copyText(address)}>
            <LucideIcon name="copy" />
            <span>Copy Address</span>
          </Button>
        </div>
      </div>
    );
  }

  function renderWalletView() {
    return (
      <section className="wallet-screen">
        <div className="wallet-topbar">
          <div className="brand-lockup" aria-label="Mercury Layer">
            <span className="brand-mark" aria-hidden="true">M</span>
            <span>Mercury</span>
          </div>
          <div className="topbar-actions">
            <button type="button" className="top-icon-button" aria-label="Refresh wallet" disabled={!activeWallet} onClick={refreshWalletWithPendingTransfers}>
              <LucideIcon name="refresh" />
            </button>
            <button type="button" className="top-icon-button" aria-label="Open tools" onClick={() => setActiveView("tools")}>
              <LucideIcon name="settings" />
            </button>
          </div>
        </div>

        <section className="wallet-hero" aria-label="Wallet balance">
          <p className="eyebrow">Balance</p>
          <h1 className="balance-display"><BalanceAmount value={totalWalletBalance} /></h1>
        </section>

        <div className="primary-actions">
          <Button disabled={!activeWallet} tone="secondary" onClick={() => openReceive()} className="action-button">
            <LucideIcon name="receive" />
            Receive
          </Button>
          <Button disabled={!activeWallet} onClick={() => openSend()} className="action-button">
            <LucideIcon name="send" />
            Send
          </Button>
        </div>
      </section>
    );
  }

  function renderTransactionsView() {
    return (
      <section className="view-shell transactions-screen">
        <div className="view-heading">
          <div>
            <p className="eyebrow">Wallet history</p>
            <h1>Transactions</h1>
          </div>
          <Button tone="ghost" disabled={!activeWallet} onClick={refreshWalletWithPendingTransfers}>Refresh</Button>
        </div>

        {transactions.length === 0 ? (
          <div className="empty-state">
            <LucideIcon name="transactions" />
            <h2>No transactions yet</h2>
            <p>Receive a statecoin or deposit a Bitcoin UTXO to get started.</p>
          </div>
        ) : (
          <div className="tx-list">
            {transactions.map((tx) => (
              <button type="button" className="tx-row" key={tx.id} onClick={() => setSelectedTx(tx)}>
                <span className={`tx-icon ${tx.kind}`} aria-hidden="true" />
                <span className="tx-main">
                  <strong>{tx.title}</strong>
                  <span>{shortId(tx.statechain_id || tx.deposit_address || tx.receive_address || tx.address)}</span>
                </span>
                <span className="tx-side">
                  <strong>{formatAmount(tx.amount)}</strong>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderMinerView() {
    return (
      <section className="view-shell">
        <div className="view-heading">
          <div>
            <p className="eyebrow">Local development</p>
            <h1>Tools</h1>
          </div>
        </div>

        <div className="panel-grid">
          <section className="panel">
            <h2>Wallet</h2>
            <div className="stack">
              <label className="field">
                <span>Active wallet</span>
                <select value={activeWallet} onChange={(event) => { setActiveWallet(event.target.value); setCoins([]); }}>
                  <option value="">Select wallet</option>
                  {wallets.map((wallet) => <option key={wallet} value={wallet}>{wallet}</option>)}
                </select>
              </label>
              <div className="wallet-row">
                <Field label="New wallet" value={newWalletName} onChange={setNewWalletName} />
                <Button onClick={createWallet}>Create</Button>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Regtest helper</h2>
            <div className={helperOnline ? "helper-state online" : "helper-state"}>
              {helperOnline ? "Regtest helper online" : "Regtest helper offline"}
            </div>
            <p className="muted">Start this helper before funding deposits or mining blocks.</p>
            <code>cd clients/tests/web && node server-regtest.cjs</code>
          </section>

          <section className="panel">
            <h2>Mine Yourself Coins</h2>
            <p className="muted">Create spendable regtest BTC in the local helper wallet for future deposits. 101 blocks makes new coinbase funds mature.</p>
            <div className="stack">
              <Field label="Blocks" type="number" value={mineBlocks} onChange={setMineBlocks} />
              <Button disabled={!helperOnline} onClick={mineCoinsToHelper}>Mine coins</Button>
            </div>
          </section>

          <section className="panel">
            <h2>Block tools</h2>
            <div className="stack">
              <Button disabled={!helperOnline} onClick={mineAndRefresh}>Mine blocks and refresh</Button>
              <Button tone="secondary" disabled={!activeWallet} onClick={refreshWalletWithPendingTransfers}>Refresh wallet</Button>
            </div>
          </section>

          <section className="panel">
            <h2>Latest deposit</h2>
            <div className="stack">
              {depositInfo?.deposit_address ? (
                <div className="data-box">
                  <span>Bitcoin deposit address</span>
                  <code>{depositInfo.deposit_address}</code>
                </div>
              ) : <p className="muted">Create a Bitcoin UTXO deposit from Receive first.</p>}
              <Button tone="secondary" disabled={!helperOnline || !depositInfo?.deposit_address} onClick={fundDeposit}>Fund latest deposit</Button>
            </div>
          </section>

          <section className="panel">
            <h2>Network</h2>
            <div className="stack">
              <Field label="Mercury API" value={config.statechainEntity} onChange={(value) => setConfig({ ...config, statechainEntity: value })} />
              <Field label="Esplora API" value={config.esploraServer} onChange={(value) => setConfig({ ...config, esploraServer: value })} />
              <Field label="Regtest helper" value={config.regtestHelper} onChange={(value) => setConfig({ ...config, regtestHelper: value })} />
              <Field label="Network" value={config.network} onChange={(value) => setConfig({ ...config, network: value })} />
              <div className="inline-fields">
                <Field label="Confirmations" type="number" value={config.confirmationTarget} onChange={(value) => setConfig({ ...config, confirmationTarget: value })} />
                <Field label="Max fee" type="number" value={config.maxFeeRate} onChange={(value) => setConfig({ ...config, maxFeeRate: value })} />
              </div>
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell">
      {error && (
        <div className="status-toast" aria-live="polite">
          <span className="dot bad" />
          <span>{error}</span>
        </div>
      )}

      <div className="page-container">
        {activeView === "wallet" && renderWalletView()}
        {activeView === "transactions" && renderTransactionsView()}
        {activeView === "tools" && renderMinerView()}
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <button type="button" aria-label="Wallet" className={activeView === "wallet" ? "active" : ""} onClick={() => setActiveView("wallet")}>
          <LucideIcon name="bitcoin" />
        </button>
        <button type="button" aria-label="Transactions" className={activeView === "transactions" ? "active" : ""} onClick={() => setActiveView("transactions")}>
          <LucideIcon name="transactions" />
        </button>
        <button type="button" aria-label="Tools" className={activeView === "tools" ? "active" : ""} onClick={() => setActiveView("tools")}>
          <LucideIcon name="pickaxe" />
        </button>
      </nav>

      {dialog === "send" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className={`modal send-modal ${sendMode === "create" ? "keypad-modal" : ""} ${sendMode === "statecoin" || sendMode === "selectCoin" ? "send-statecoin-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="send-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="modal-heading">
              {sendMode !== "methods" && (
                <button type="button" className="icon-button" aria-label="Back" onClick={() => setSendMode(sendMode === "selectCoin" ? "statecoin" : "methods")}>←</button>
              )}
              <div>
                {sendMode !== "methods" && sendMode !== "create" && <p className="eyebrow">Statecoin transfer</p>}
                <h1 id="send-title">
                  {sendMode === "methods" && "Send via"}
                  {sendMode === "statecoin" && "Send Statecoin"}
                  {sendMode === "selectCoin" && "Select Statecoin"}
                  {sendMode === "create" && "Create Statecoin"}
                </h1>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}>×</button>
            </div>

            {sendMode === "methods" && (
              <div className="receive-methods action-step" key="send-methods">
                <button type="button" className="receive-method-card" onClick={openSendStatecoin}>
                  <LucideIcon name="send" />
                  <span>Send Statecoin</span>
                </button>
                <button type="button" className="receive-method-card" disabled>
                  <LucideIcon name="vault" />
                  <span>Dark Swaps (coming soon)</span>
                </button>
              </div>
            )}

            {sendMode === "statecoin" && (
              <div className="send-scan-panel action-step" key="send-statecoin">
                <p className="amount-label">Statecoin Address</p>
                <button type="button" className="scanner-preview" onClick={() => setError("QR scanning is not available in this build. Paste an address instead.")}>
                  <span className="scanner-corner top-left" />
                  <span className="scanner-corner top-right" />
                  <span className="scanner-corner bottom-left" />
                  <span className="scanner-corner bottom-right" />
                  <LucideIcon name="scan" />
                  <span>Scan QR code</span>
                </button>
                <Button tone="secondary" onClick={pasteSendAddress} className="send-paste-button">
                  <LucideIcon name="paste" />
                  <span>Paste Address</span>
                </Button>
              </div>
            )}

            {sendMode === "selectCoin" && (
              <div className="send-coin-panel action-step" key="send-select-coin">
                <div className="send-recipient-summary">
                  <span>Recipient</span>
                  <code>{shortId(sendAddress, 18)}</code>
                </div>
                <div className="send-coin-list" role="listbox" aria-label="Select statecoin">
                  {confirmedCoins.map((coin) => (
                    <button
                      type="button"
                      key={coin.statechain_id}
                      className={sendStatechainId === coin.statechain_id ? "send-coin-option selected" : "send-coin-option"}
                      onClick={() => setSendStatechainId(coin.statechain_id)}
                    >
                      <span>
                        <strong>{formatAmount(coin.amount)}</strong>
                        <code>{shortId(coin.statechain_id)}</code>
                      </span>
                      <span className="selection-dot" aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <Button disabled={!sendStatechainId || !sendAddress} onClick={sendTransfer}>Send</Button>
              </div>
            )}

            {sendMode === "create" && (
              <div className="amount-entry action-step" key="send-create">
                <p className="amount-label">Create Statecoin</p>
                <div className="amount-display">
                  <span>₿</span>
                  <strong>{String(amount || "0").replace(/\D/g, "") || "0"}</strong>
                </div>
                <AmountNumpad onDigit={appendDepositDigit} onBackspace={backspaceDepositAmount} />
                <Button disabled={!activeWallet || !helperOnline || Number(amount) <= 0} onClick={depositBitcoinUtxo}>Create Statecoin</Button>
              </div>
            )}
          </section>
        </div>
      )}

      {dialog === "receive" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className={`modal receive-modal ${receiveMode === "deposit" ? "keypad-modal" : ""} ${receiveMode === "statecoin" || receiveMode === "bitcoin" ? "receive-qr-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="receive-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="modal-heading">
              {receiveMode !== "methods" && (
                <button type="button" className="icon-button" aria-label="Back" onClick={() => setReceiveMode("methods")}>←</button>
              )}
              <div>
                {receiveMode !== "methods" && (
                  <p className="eyebrow">{receiveMode === "deposit" ? "Deposit" : "Receive"}</p>
                )}
                <h1 id="receive-title">
                  {receiveMode === "methods" && "Receive via"}
                  {receiveMode === "statecoin" && "Receive Statecoin"}
                  {receiveMode === "bitcoin" && "Receive Bitcoin"}
                  {receiveMode === "deposit" && "Create Statecoin"}
                </h1>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}>×</button>
            </div>

            {receiveMode === "methods" && (
              <div className="receive-methods action-step" key="receive-methods">
                <button type="button" className="receive-method-card" onClick={openStatecoinReceive}>
                  <LucideIcon name="receive" />
                  <span>Receive Statecoin</span>
                </button>
                <button type="button" className="receive-method-card" onClick={openBitcoinReceive}>
                  <LucideIcon name="bitcoin" />
                  <span>Receive Bitcoin</span>
                </button>
              </div>
            )}

            {receiveMode === "statecoin" && <React.Fragment key="receive-statecoin">{renderReceiveAddressPanel("statecoin")}</React.Fragment>}
            {receiveMode === "bitcoin" && <React.Fragment key="receive-bitcoin">{renderReceiveAddressPanel("bitcoin")}</React.Fragment>}

            {receiveMode === "deposit" && null}
          </section>
        </div>
      )}

      {selectedTx && (
        <div className="modal-backdrop detail-backdrop" role="presentation" onMouseDown={() => setSelectedTx(null)}>
          <section className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="tx-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{selectedTx.kind}</p>
                <h1 id="tx-title">{selectedTx.title}</h1>
              </div>
              <button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedTx(null)}>×</button>
            </div>

            <div className="detail-summary">
              <p>{transactionSummary(selectedTx)}</p>
              <div>
                <strong>{formatAmount(selectedTx.amount)}</strong>
                <StatusPill status={selectedTx.status} />
              </div>
            </div>

            <div className="detail-grid">
              <div className="detail-item">
                <span>Created</span>
                <strong>{selectedTx.created_at}</strong>
              </div>
              <div className="detail-item">
                <span>Statechain ID</span>
                <code>{selectedTx.statechain_id || "Pending"}</code>
              </div>
              <div className="detail-item">
                <span>Address</span>
                <code>{selectedTx.deposit_address || selectedTx.recipient_address || selectedTx.receive_address || selectedTx.address || "Not available"}</code>
              </div>
            </div>

            <section className="protocol-card">
              <h2>How this statecoin transfer worked</h2>
              <div className="step-list">
                {protocolSteps(selectedTx).map(([label, value]) => (
                  <div className="step-row" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <details className="raw-details">
              <summary>Raw data</summary>
              <pre>{JSON.stringify(selectedTx.raw || selectedTx, null, 2)}</pre>
            </details>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
