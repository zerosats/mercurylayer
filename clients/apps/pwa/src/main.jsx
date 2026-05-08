import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import mercuryweblib from "mercuryweblib";
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

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_KEY);
  return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
}

function walletNames() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(WALLET_PREFIX) && !key.slice(WALLET_PREFIX.length).includes("-"))
    .map((key) => key.slice(WALLET_PREFIX.length))
    .sort();
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Button({ children, onClick, disabled, tone = "primary" }) {
  return (
    <button type="button" className={`button ${tone}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
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

function App() {
  const [config, setConfig] = useState(loadSettings);
  const [wallets, setWallets] = useState(walletNames);
  const [activeWallet, setActiveWallet] = useState("");
  const [newWalletName, setNewWalletName] = useState("alice");
  const [coins, setCoins] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("1000");
  const [token, setToken] = useState(null);
  const [depositInfo, setDepositInfo] = useState(null);
  const [transferAddress, setTransferAddress] = useState("");
  const [sendStatechainId, setSendStatechainId] = useState("");
  const [sendAddress, setSendAddress] = useState("");
  const [withdrawStatechainId, setWithdrawStatechainId] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [helperOnline, setHelperOnline] = useState(false);

  const clientConfig = useMemo(() => ({
    ...config,
    confirmationTarget: Number(config.confirmationTarget),
    feeRateTolerance: Number(config.feeRateTolerance),
    maxFeeRate: Number(config.maxFeeRate)
  }), [config]);

  const confirmedCoins = coins.filter((coin) => coin.status === "CONFIRMED");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    if (!activeWallet && wallets.length > 0) setActiveWallet(wallets[0]);
  }, [activeWallet, wallets]);

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

  async function createWallet() {
    await run("Creating wallet", async () => {
      const name = newWalletName.trim();
      if (!name) throw new Error("Wallet name is required.");
      await mercuryweblib.createWallet(clientConfig, name);
      setWallets(walletNames());
      setActiveWallet(name);
      setCoins([]);
    });
  }

  async function requestToken() {
    const nextToken = await run("Requesting token", async () => mercuryweblib.newToken(clientConfig));
    setToken(nextToken);
    return nextToken;
  }

  async function generateBlocks(blocks = config.confirmationTarget) {
    await fetch(`${config.regtestHelper}/generate_blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: Number(blocks) })
    }).then(assertOk);
  }

  async function payTokenFee() {
    if (!token?.deposit_address || !token?.fee) return;
    if (!helperOnline) {
      setError("Regtest helper is offline. Start clients/tests/web/server-regtest.cjs before using funding or mining buttons.");
      return;
    }
    await run("Paying token fee", async () => {
      await fetch(`${config.regtestHelper}/deposit_amount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: token.deposit_address, amount: token.fee })
      }).then(assertOk);
      await generateBlocks(token.confirmation_target || config.confirmationTarget);
    });
  }

  async function createDepositAddress() {
    const currentToken = token || await requestToken();
    if (!currentToken?.token_id) return;
    const nextDeposit = await run("Creating deposit address", async () =>
      mercuryweblib.getDepositBitcoinAddress(clientConfig, activeWallet, currentToken.token_id, Number(amount))
    );
    if (!nextDeposit) return;
    setDepositInfo(nextDeposit);
    setToken(null);
    await refreshCoins();
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

  async function newReceiveAddress() {
    const address = await run("Creating transfer address", async () =>
      mercuryweblib.newTransferAddress(activeWallet)
    );
    setTransferAddress(address.transfer_receive);
  }

  async function sendTransfer() {
    await run("Sending transfer", async () => {
      await mercuryweblib.transferSend(clientConfig, activeWallet, sendStatechainId.trim(), sendAddress.trim(), false, null);
      await refreshCoins();
    });
  }

  async function receiveTransfers() {
    const result = await run("Receiving transfers", async () =>
      mercuryweblib.transferReceive(clientConfig, activeWallet)
    );
    await refreshCoins();
    setStatus(`Received ${result.receivedStatechainIds.length} transfer(s)`);
  }

  async function withdrawCoin() {
    await run("Withdrawing coin", async () => {
      await mercuryweblib.withdrawCoin(clientConfig, activeWallet, withdrawStatechainId.trim(), withdrawAddress.trim(), null, null);
      await refreshCoins();
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Regtest PWA</p>
          <h1>Mercury Wallet</h1>
        </div>
        <div className="status-block">
          <span className={error ? "dot bad" : "dot"} />
          <span>{error || status}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <h2>Config</h2>
          <div className="notice">
            <strong>Local run order</strong>
            <span>Keep Docker running. Start the regtest helper before fee, fund, or mine actions.</span>
            <code>cd clients/tests/web && node server-regtest.cjs</code>
          </div>
          <div className={helperOnline ? "helper-state online" : "helper-state"}>
            {helperOnline ? "Regtest helper online" : "Regtest helper offline"}
          </div>
          <Field label="Mercury API" value={config.statechainEntity} onChange={(value) => setConfig({ ...config, statechainEntity: value })} />
          <Field label="Esplora API" value={config.esploraServer} onChange={(value) => setConfig({ ...config, esploraServer: value })} />
          <Field label="Regtest helper" value={config.regtestHelper} onChange={(value) => setConfig({ ...config, regtestHelper: value })} />
          <Field label="Network" value={config.network} onChange={(value) => setConfig({ ...config, network: value })} />
          <div className="inline-fields">
            <Field label="Confirmations" type="number" value={config.confirmationTarget} onChange={(value) => setConfig({ ...config, confirmationTarget: value })} />
            <Field label="Max fee" type="number" value={config.maxFeeRate} onChange={(value) => setConfig({ ...config, maxFeeRate: value })} />
          </div>
        </aside>

        <section className="content">
          <section className="band wallet-band">
            <div>
              <h2>Wallet</h2>
              <div className="wallet-row">
                <Field label="New wallet" value={newWalletName} onChange={setNewWalletName} />
                <Button onClick={createWallet}>Create</Button>
              </div>
            </div>
            <label className="field compact">
              <span>Active wallet</span>
              <select value={activeWallet} onChange={(event) => { setActiveWallet(event.target.value); setCoins([]); }}>
                <option value="">Select wallet</option>
                {wallets.map((wallet) => <option key={wallet} value={wallet}>{wallet}</option>)}
              </select>
            </label>
            <Button tone="secondary" disabled={!activeWallet} onClick={() => run("Refreshing coins", () => refreshCoins())}>Refresh</Button>
          </section>

          <section className="grid two">
            <div className="panel">
              <h2>Deposit</h2>
              <div className="stack">
                <Field label="Amount sats" type="number" value={amount} onChange={setAmount} />
                <div className="actions">
                  <Button disabled={!activeWallet} onClick={requestToken}>Token</Button>
                  <Button disabled={!activeWallet} onClick={createDepositAddress}>Address</Button>
                </div>
                {token && (
                  <div className="data-box">
                    <span>Token</span>
                    <code>{token.token_id}</code>
                    {token.payment_method === "onchain" && <Button tone="secondary" disabled={!helperOnline} onClick={payTokenFee}>Pay fee in regtest</Button>}
                  </div>
                )}
                {depositInfo && (
                  <div className="data-box">
                    <span>Deposit address</span>
                    <code>{depositInfo.deposit_address}</code>
                    <Button tone="secondary" disabled={!helperOnline} onClick={fundDeposit}>Fund in regtest</Button>
                    <Button tone="secondary" disabled={!helperOnline} onClick={mineAndRefresh}>Mine and refresh</Button>
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <h2>Receive</h2>
              <div className="stack">
                <Button disabled={!activeWallet} onClick={newReceiveAddress}>New receive address</Button>
                {transferAddress && (
                  <div className="data-box">
                    <span>Statecoin address</span>
                    <code>{transferAddress}</code>
                  </div>
                )}
                <Button disabled={!activeWallet} tone="secondary" onClick={receiveTransfers}>Receive pending transfers</Button>
              </div>
            </div>
          </section>

          <section className="grid two">
            <div className="panel">
              <h2>Send</h2>
              <div className="stack">
                <label className="field">
                  <span>Statechain ID</span>
                  <select value={sendStatechainId} onChange={(event) => setSendStatechainId(event.target.value)}>
                    <option value="">Select confirmed coin</option>
                    {confirmedCoins.map((coin) => <option key={coin.statechain_id} value={coin.statechain_id}>{coin.statechain_id}</option>)}
                  </select>
                </label>
                <Field label="Recipient statecoin address" value={sendAddress} onChange={setSendAddress} />
                <Button disabled={!sendStatechainId || !sendAddress} onClick={sendTransfer}>Send transfer</Button>
              </div>
            </div>

            <div className="panel">
              <h2>Withdraw</h2>
              <div className="stack">
                <Field label="Statechain ID" value={withdrawStatechainId} onChange={setWithdrawStatechainId} />
                <Field label="Bitcoin address" value={withdrawAddress} onChange={setWithdrawAddress} />
                <Button disabled={!withdrawStatechainId || !withdrawAddress} onClick={withdrawCoin}>Withdraw</Button>
              </div>
            </div>
          </section>

          <section className="band coin-band">
            <div className="section-heading">
              <h2>Statecoins</h2>
              <Button tone="secondary" disabled={!activeWallet} onClick={() => run("Refreshing coins", () => refreshCoins())}>Refresh</Button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Statechain ID</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {coins.length === 0 ? (
                    <tr><td colSpan="4" className="empty">No statecoins loaded</td></tr>
                  ) : coins.map((coin, index) => (
                    <tr key={`${coin.statechain_id || coin.address || "coin"}-${coin.duplicate_index ?? 0}-${index}`}>
                      <td><span className={`status-pill ${coin.status?.toLowerCase()}`}>{coin.status}</span></td>
                      <td>{coin.amount ?? ""}</td>
                      <td><code>{coin.statechain_id}</code></td>
                      <td><code>{coin.aggregated_address || coin.address}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
