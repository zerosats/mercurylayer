
import axios from 'axios';
import initWasm from 'mercury-wasm';
import wasmUrl from 'mercury-wasm/mercury_wasm_bg.wasm?url'
import * as mercury_wasm from 'mercury-wasm';
import storageManager from './storage_manager.js';
import transaction from './transaction.js';
import utils from './utils.js';

const getTokenFromServer = async (clientConfig) => {

    const statechain_entity_url = clientConfig.statechainEntity;
    const path = "deposit/get_token";
    const url = statechain_entity_url + '/' + path;

    const response = await axios.get(url);

    if (response.status != 200) {
        throw new Error(`Token error: ${response.data}`);
    }

    let token = response.data;

    return token;
}

const getToken = async (clientConfig) => {
    return await getTokenFromServer(clientConfig);
}

const init = async (clientConfig, wallet, token_id) => {

    let coin = mercury_wasm.getNewCoin(wallet);    

    wallet.coins.push(coin);

    storageManager.updateWallet(wallet);

    let depositMsg1 = mercury_wasm.createDepositMsg1(coin, token_id);

    const statechain_entity_url = clientConfig.statechainEntity;
    const path = "deposit/init/pod";
    const url = statechain_entity_url + '/' + path;

    let response = null;
    try {
        response = await axios.post(url, depositMsg1);
      } catch (error) {
        // Get error message from response body
        let err_msg = "";
        if (error.response) {
          // Server responded with error
          console.log('Error body:', error.response.data);
          err_msg = error.response.data;
        } else if (error.request) {
          // Request made but no response received
          console.log('No response received:', error.request);
          err_msg = error.request;
        } else {
          // Error setting up request
          console.log('Error:', error.message);
          err_msg = error.message;
        }

        if (typeof err_msg === "object") {
          err_msg = JSON.stringify(err_msg);
        }

        throw new Error(`Deposit error: ${err_msg}`);
      }


    let depositMsg1Response = response.data;

    let depositInitResult = mercury_wasm.handleDepositMsg1Response(coin, depositMsg1Response);

    coin.statechain_id = depositInitResult.statechain_id;
    coin.signed_statechain_id = depositInitResult.signed_statechain_id;
    coin.server_pubkey = depositInitResult.server_pubkey;

    storageManager.updateWallet(wallet);
}

const getDepositBitcoinAddress = async (clientConfig, walletName, token_id, amount) => {

    await initWasm(wasmUrl);

    let wallet = storageManager.getWallet(walletName);

    await init(clientConfig, wallet, token_id);

    let coin = wallet.coins[wallet.coins.length - 1];

    let aggregatedPublicKey = mercury_wasm.createAggregatedAddress(coin, wallet.network);

    coin.amount = parseInt(amount, 10);
    coin.aggregated_address = aggregatedPublicKey.aggregate_address;
    coin.aggregated_pubkey = aggregatedPublicKey.aggregate_pubkey;

    storageManager.updateWallet(wallet);

    return { "deposit_address":  coin.aggregated_address, "statechain_id": coin.statechain_id };
}

const createTx1 = async (clientConfig, coin, walletNetwork, txN) => {

    const toAddress = mercury_wasm.getUserBackupAddress(coin, walletNetwork);
    const isWithdrawal = false;
    const qtBackupTx = 0;

    const serverInfo = await utils.infoConfig(clientConfig);

    let feeRateSatsPerByte = (serverInfo.feeRateSatsPerByte > clientConfig.maxFeeRate) ? clientConfig.maxFeeRate: serverInfo.feeRateSatsPerByte;

    let signedTx = await transaction.newTransaction(
        clientConfig, 
        coin, 
        toAddress, 
        isWithdrawal, 
        qtBackupTx, 
        null, 
        walletNetwork,
        feeRateSatsPerByte,
        serverInfo.initlock,
        serverInfo.interval
    );

    let backupTx = {
        tx_n: txN,
        tx: signedTx,
        client_public_nonce: coin.public_nonce, 
        server_public_nonce: coin.server_public_nonce,
        client_public_key: coin.user_pubkey,
        server_public_key: coin.server_pubkey,
        blinding_factor: coin.blinding_factor
    };

    coin.locktime = mercury_wasm.getBlockheight(backupTx);

    return backupTx;
}

export default { getToken, getDepositBitcoinAddress, createTx1 }
