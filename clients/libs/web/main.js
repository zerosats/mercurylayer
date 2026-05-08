import axios from 'axios';
import walletManager from './wallet.js';
import storageManager from './storage_manager.js';
import deposit from './deposit.js';
import coin_status from './coin_status.js';
import withdraw from './withdraw.js';
import broadcast_backup_tx from './broadcast_backup_tx.js';
import transfer_send from './transfer_send.js';
import transfer_receive from './transfer_receive.js';
import lightningLatch from './lightning-latch.js';
import split from './split.js';
import { v4 as uuidv4 } from 'uuid';
import utils from './utils.js';

const greet = async () => {
  
  var esploraServer = "https://mempool.space/signet";

  const response = await axios.get(`${esploraServer}/api/blocks/tip/height`);

  console.log(response.data)

  console.log('Hello from the web lib!')
}

const createWallet = async (clientConfig, name) => {

  const wallet = await walletManager.createWallet(clientConfig, name);

  storageManager.createWallet(wallet);

  return wallet;
}

const newToken = async (clientConfig) => {
  return await deposit.getToken(clientConfig);
}

const getDepositBitcoinAddress = async (clientConfig, walletName, token_id, amount) => {
  const address_info = await deposit.getDepositBitcoinAddress(clientConfig, walletName, token_id, amount);
  return address_info;
}

const listStatecoins = async (clientConfig, walletName) => {

  await coin_status.updateCoins(clientConfig, walletName);

  let wallet = storageManager.getWallet(walletName);

  let coins = wallet.coins.map(coin => ({
      statechain_id: coin.statechain_id,
      utxo_txid: coin.utxo_txid,
      utxo_vout: coin.utxo_vout,
      amount: coin.amount,
      status: coin.status,
      address: coin.address,
      aggregated_address: coin.aggregated_address,
      locktime: coin.locktime,
      duplicate_index: coin.duplicate_index,
      root_statechain_id: coin.root_statechain_id,
      parent_statechain_id: coin.parent_statechain_id,
      logical_tx_n_offset: coin.logical_tx_n_offset,
      is_split_leaf: coin.is_split_leaf
  }));

  return coins;
}

const withdrawCoin = async (clientConfig, walletName, statechainId, toAddress, feeRate, duplicatedIndex) => {

  await coin_status.updateCoins(clientConfig, walletName);

  return await withdraw.execute(clientConfig, walletName, statechainId, toAddress, feeRate, duplicatedIndex);
}

const broadcastBackupTransaction = async (clientConfig, walletName, statechainId, toAddress, feeRate) => {

  await coin_status.updateCoins(clientConfig, walletName);

  let txIds = await broadcast_backup_tx.execute(clientConfig, walletName, statechainId, toAddress, feeRate);

  return txIds;
}

const newTransferAddress = async (walletName, generateBatchId) => {

  const addr = await transfer_receive.newTransferAddress(walletName)
  let res = {transfer_receive: addr};

  if (generateBatchId) {
      const batchId = uuidv4();
      res.batch_id = batchId;
  }

  return res;
}

const transferSend = async (clientConfig, walletName, statechainId, toAddress, forceSend, batchId, duplicatedIndexes) => {

  await coin_status.updateCoins(clientConfig, walletName);

  return await transfer_send.execute(clientConfig, walletName, statechainId, toAddress, forceSend, batchId, duplicatedIndexes);
}

const transferReceive = async (clientConfig, walletName) => {

  await coin_status.updateCoins(clientConfig, walletName);

  return await transfer_receive.execute(clientConfig, walletName);
}

const paymentHash = async (clientConfig, walletName, statechainId) => {

  await coin_status.updateCoins(clientConfig, walletName);

  return await lightningLatch.createPreImage(clientConfig, walletName, statechainId);
}

const confirmPendingInvoice = async (clientConfig, walletName, statechainId) => {

  await coin_status.updateCoins(clientConfig, walletName);

  await lightningLatch.confirmPendingInvoice(clientConfig, walletName, statechainId);
}

const retrievePreImage = async (clientConfig, walletName, statechainId, batchId) => {

  await coin_status.updateCoins(clientConfig, walletName);

  return await lightningLatch.retrievePreImage(clientConfig, walletName, statechainId, batchId);
}

const getPaymentHash = async (clientConfig, batchId) => {

  return await lightningLatch.getPaymentHash(clientConfig, batchId);
}

const verifyInvoice = async (clientConfig, batchId, paymentRequest) => {
  throw new Error("verifyInvoice is not available in the browser runtime package yet.");
}

export default { 
  greet, 
  createWallet, 
  newToken, 
  getDepositBitcoinAddress, 
  listStatecoins,
  withdrawCoin,
  broadcastBackupTransaction,
  newTransferAddress,
  transferSend,
  transferReceive,
  paymentHash,
  confirmPendingInvoice,
  retrievePreImage,
  getPaymentHash,
  verifyInvoice,
  getPreviousOutpoint: utils.getPreviousOutpoint,
  getBlockheight: utils.getBlockheight,
  splitBackupTransactions: transfer_receive.splitBackupTransactions,
  splitInit: split.splitInit,
  splitFinalize: split.splitFinalize,
  splitAbort: split.splitAbort,
  getStatechainTree: split.getStatechainTree,
  infoConfig: utils.infoConfig,
};
