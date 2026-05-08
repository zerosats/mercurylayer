#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

if (!args.statechainId) {
  usage();
  process.exit(1);
}

const mercuryUrl = args.mercuryUrl || process.env.MERCURY_URL || "http://127.0.0.1:8000";
const containerName = args.container || process.env.BITCOIN_CONTAINER || "esplora-container";

function parseArgs(argv) {
  const parsed = {
    branchTxids: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--statechain-id" || arg === "-s") {
      parsed.statechainId = argv[++i];
    } else if (arg === "--branch-txid" || arg === "-b") {
      parsed.branchTxids.push(argv[++i]);
    } else if (arg === "--mercury-url") {
      parsed.mercuryUrl = argv[++i];
    } else if (arg === "--container") {
      parsed.container = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (!parsed.statechainId) {
      parsed.statechainId = arg;
    } else {
      parsed.branchTxids.push(arg);
    }
  }

  return parsed;
}

function usage() {
  console.log(`Usage:
  node scripts/inspect-split.mjs <statechain_id> [branch_txid...]
  node scripts/inspect-split.mjs --statechain-id <id> --branch-txid <txid>

Options:
  --mercury-url <url>  Mercury server URL. Default: http://127.0.0.1:8000
  --container <name>   Docker container with bitcoin cli. Default: esplora-container

Examples:
  node scripts/inspect-split.mjs 3fdffe5d139748f1b4778af55600e6ee a6341cd69fd8e22ecf4c3bd9545d80325415f5f98c7090a2cd094503333164c1
  MERCURY_URL=http://127.0.0.1:8000 node scripts/inspect-split.mjs 3fdffe5d139748f1b4778af55600e6ee
`);
}

function section(title) {
  console.log(`\n## ${title}`);
}

function printObject(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}: ${text}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return JSON.parse(text);
}

function dockerCli(args) {
  return execFileSync("docker", ["exec", containerName, "cli", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryDockerCli(args) {
  try {
    return {
      ok: true,
      value: dockerCli(args),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.stderr?.toString()?.trim() || error.message,
    };
  }
}

function normalizeTxid(txid) {
  return txid?.trim();
}

function collectTxidsFromTree(tree) {
  const txids = new Set();

  for (const node of tree.nodes || []) {
    if (node.funding_txid) {
      txids.add(node.funding_txid);
    }
  }

  return [...txids];
}

function inspectTransaction(txid) {
  const tx = normalizeTxid(txid);
  section(`Bitcoin Transaction ${tx}`);

  const rawResult = tryDockerCli(["getrawtransaction", tx]);
  if (!rawResult.ok) {
    console.log("Raw transaction: unavailable from Bitcoin Core");
    console.log(rawResult.error);
    return;
  }

  const rawTx = rawResult.value;
  console.log(`Raw hex length: ${rawTx.length}`);

  const decodedResult = tryDockerCli(["decoderawtransaction", rawTx]);
  if (!decodedResult.ok) {
    console.log("Decode failed:");
    console.log(decodedResult.error);
    return;
  }

  const decoded = JSON.parse(decodedResult.value);
  printObject({
    txid: decoded.txid,
    hash: decoded.hash,
    version: decoded.version,
    size: decoded.size,
    vsize: decoded.vsize,
    weight: decoded.weight,
    locktime: decoded.locktime,
    inputs: decoded.vin?.map((input, index) => ({
      index,
      txid: input.txid,
      vout: input.vout,
      sequence: input.sequence,
      witness_items: input.txinwitness?.length || 0,
    })),
    outputs: decoded.vout?.map((output) => ({
      n: output.n,
      value_btc: output.value,
      value_sats: Math.round(output.value * 100_000_000),
      type: output.scriptPubKey?.type,
      address: output.scriptPubKey?.address,
      script_hex: output.scriptPubKey?.hex,
    })),
  });

  section(`UTXO Status For ${tx}`);
  for (const output of decoded.vout || []) {
    const txoutResult = tryDockerCli(["gettxout", tx, String(output.n), "true"]);
    const txout =
      txoutResult.ok && txoutResult.value ? JSON.parse(txoutResult.value) : null;
    console.log(
      `vout ${output.n}: ${txout ? "unspent" : "spent or unavailable"} (${Math.round(
        output.value * 100_000_000,
      )} sats)`,
    );
  }

  const mempoolResult = tryDockerCli(["getmempoolentry", tx]);
  if (mempoolResult.ok) {
    section(`Mempool Entry ${tx}`);
    const mempool = JSON.parse(mempoolResult.value);
    printObject({
      vsize: mempool.vsize,
      weight: mempool.weight,
      fees: mempool.fees,
      depends: mempool.depends,
      spentby: mempool.spentby,
    });
  }
}

async function main() {
  if (args.help) {
    usage();
    return;
  }

  section("Mercury Tree");
  const treeUrl = `${mercuryUrl}/info/statechain/${encodeURIComponent(args.statechainId)}/tree`;
  console.log(`GET ${treeUrl}`);
  let tree = { nodes: [], signatures: [] };
  try {
    tree = await fetchJson(treeUrl);
  } catch (error) {
    if (error.status !== 404 || args.branchTxids.length === 0) {
      throw error;
    }
    console.log(`Tree unavailable: ${error.body || error.message}`);
    console.log("Continuing with transaction inspection because txid argument was provided.");
  }

  if ((tree.nodes || []).length > 0 || (tree.signatures || []).length > 0) {
    printObject({
      nodes: tree.nodes,
      signatures: tree.signatures,
    });
  }

  section("Tree Summary");
  const nodesById = new Map((tree.nodes || []).map((node) => [node.statechain_id, node]));
  const target = nodesById.get(args.statechainId);
  printObject({
    target_statechain_id: args.statechainId,
    target_node: target || null,
    node_count: tree.nodes?.length || 0,
    signature_count: tree.signatures?.length || 0,
    split_branch_signatures: (tree.signatures || []).filter(
      (signature) => signature.purpose === "split_branch",
    ),
    split_child_backup_signatures: (tree.signatures || []).filter(
      (signature) => signature.purpose === "split_child_backup",
    ),
  });

  section("Server Keylist");
  try {
    const keylist = await fetchJson(`${mercuryUrl}/info/keylist`);
    const activeKeys = keylist.list_keyinfo || [];
    printObject({
      active_key_count: activeKeys.length,
      active_server_keys: activeKeys,
    });
  } catch (error) {
    console.log(`Unable to fetch keylist: ${error.message}`);
  }

  const txids = new Set(args.branchTxids);
  for (const txid of collectTxidsFromTree(tree)) {
    txids.add(txid);
  }

  if (txids.size === 0) {
    section("Bitcoin Transactions");
    console.log(
      "No txids were provided and the tree response did not expose funding_txid values.",
    );
    console.log("Pass the branch txid from the split harness with --branch-txid <txid>.");
    return;
  }

  for (const txid of txids) {
    inspectTransaction(txid);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
