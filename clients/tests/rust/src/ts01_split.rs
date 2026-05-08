use std::{env, fs, str::FromStr, thread, time::Duration};

use anyhow::{Result, anyhow};
use bitcoin::PrivateKey;
use mercurylib::split::{SplitFinalizeChild, branch_txid};
use mercuryrustlib::{
    BackupTx, BranchTxProof, Coin, CoinStatus, LeafProof, SplitChild, SplitFinalizeRequest,
    SplitInitRequest, Wallet, build_unsigned_branch_tx,
};
use secp256k1_zkp::{PublicKey, Scalar};

use crate::{bitcoin_core, electrs};

fn remove_wallet_db() {
    for path in ["wallet.db", "wallet.db-shm", "wallet.db-wal"] {
        let _ = fs::remove_file(path);
    }
}

fn auth_xonly_pubkey(coin: &Coin) -> Result<String> {
    let auth_pubkey = PublicKey::from_str(&coin.auth_pubkey)?;
    Ok(auth_pubkey.x_only_public_key().0.to_string())
}

fn secret_key_from_wif(wif: &str) -> Result<secp256k1_zkp::SecretKey> {
    Ok(PrivateKey::from_wif(wif)?.inner)
}

fn calculate_split_t(parent: &Coin, children: &[Coin]) -> Result<String> {
    if children.is_empty() {
        return Err(anyhow!("Cannot calculate split tweak without children"));
    }

    let parent_secret = secret_key_from_wif(&parent.user_privkey)?;
    let mut child_sum = secret_key_from_wif(&children[0].user_privkey)?;

    for child in children.iter().skip(1) {
        let child_secret = secret_key_from_wif(&child.user_privkey)?;
        child_sum = child_sum.add_tweak(&Scalar::from(child_secret))?;
    }

    let t = child_sum.negate().add_tweak(&Scalar::from(parent_secret))?;

    Ok(hex::encode(t.secret_bytes()))
}

async fn create_confirmed_parent_coin(
    client_config: &mercuryrustlib::client_config::ClientConfig,
    wallet_name: &str,
    amount: u32,
) -> Result<Coin> {
    let token_response = mercuryrustlib::deposit::get_token(client_config).await?;
    let token_id = crate::utils::handle_token_response(client_config, &token_response).await?;

    let deposit_address = mercuryrustlib::deposit::get_deposit_bitcoin_address(
        client_config,
        wallet_name,
        &token_id,
        amount,
    )
    .await?;

    println!("Deposit address: {}", deposit_address);
    let _ = bitcoin_core::sendtoaddress(amount, &deposit_address)?;

    let mut is_tx_indexed = false;
    while !is_tx_indexed {
        is_tx_indexed = electrs::check_address(client_config, &deposit_address, amount).await?;
        thread::sleep(Duration::from_secs(1));
    }

    let core_wallet_address = bitcoin_core::getnewaddress()?;
    let _ =
        bitcoin_core::generatetoaddress(client_config.confirmation_target, &core_wallet_address)?;

    mercuryrustlib::coin_status::update_coins(client_config, wallet_name).await?;

    let wallet =
        mercuryrustlib::sqlite_manager::get_wallet(&client_config.pool, wallet_name).await?;
    let coin = wallet
        .coins
        .iter()
        .find(|coin| coin.aggregated_address == Some(deposit_address.clone()))
        .ok_or_else(|| anyhow!("Confirmed parent coin not found"))?
        .clone();

    if coin.status != CoinStatus::CONFIRMED {
        return Err(anyhow!(
            "Parent coin status is {}, expected CONFIRMED",
            coin.status
        ));
    }

    Ok(coin)
}

fn create_child_coins(wallet: &Wallet, count: usize) -> Result<Vec<Coin>> {
    let mut wallet_for_derivation = wallet.clone();
    let mut children = Vec::with_capacity(count);

    for _ in 0..count {
        let child = wallet_for_derivation.get_new_coin()?;
        wallet_for_derivation.coins.push(child.clone());
        children.push(child);
    }

    Ok(children)
}

fn apply_split_child_response(
    child: &mut Coin,
    response: &mercuryrustlib::SplitInitChild,
    parent: &Coin,
    signed_branch_tx: &str,
) -> Result<()> {
    let child_statechain_id = response.statechain_id.clone();
    child.statechain_id = Some(child_statechain_id.clone());
    child.signed_statechain_id = Some(mercurylib_sign_statechain_id(&child_statechain_id, child)?);
    child.server_pubkey = Some(response.server_pubkey.clone());
    child.aggregated_pubkey = Some(response.aggregate_pubkey.clone());
    child.aggregated_address = Some(response.aggregate_address.clone());
    child.amount = Some(response.amount_sats as u32);
    child.utxo_txid = Some(branch_txid(signed_branch_tx)?);
    child.utxo_vout = Some(response.child_index);
    child.status = CoinStatus::CONFIRMED;
    child.root_statechain_id = parent
        .root_statechain_id
        .clone()
        .or_else(|| parent.statechain_id.clone());
    child.parent_statechain_id = parent.statechain_id.clone();
    child.logical_tx_n_offset = response.logical_tx_n_offset;
    child.is_split_leaf = true;
    child.leaf_proof = Some(LeafProof {
        root_statechain_id: child.root_statechain_id.clone().unwrap(),
        branches: vec![BranchTxProof {
            split_id: String::new(),
            parent_statechain_id: parent.statechain_id.clone().unwrap(),
            branch_tx: signed_branch_tx.to_string(),
            child_vout: response.child_index,
        }],
    });

    Ok(())
}

fn set_child_split_id(child: &mut Coin, split_id: &str) {
    if let Some(leaf_proof) = child.leaf_proof.as_mut() {
        if let Some(branch) = leaf_proof.branches.last_mut() {
            branch.split_id = split_id.to_string();
        }
    }
}

fn mercurylib_sign_statechain_id(statechain_id: &str, coin: &Coin) -> Result<String> {
    Ok(mercurylib::transfer::receiver::sign_message(
        statechain_id,
        coin,
    )?)
}

async fn sign_child_backup(
    client_config: &mercuryrustlib::client_config::ClientConfig,
    child: &mut Coin,
    split_id: &str,
    network: &str,
) -> Result<BackupTx> {
    let server_info = mercuryrustlib::utils::info_config(client_config).await?;
    let to_address = mercurylib::transaction::get_user_backup_address(child, network.to_string())?;

    let signed_tx = mercuryrustlib::transaction::new_transaction_with_signing_purpose(
        client_config,
        child,
        &to_address,
        0,
        false,
        None,
        network,
        client_config.max_fee_rate,
        server_info.initlock,
        server_info.interval,
        Some("split_child_backup".to_string()),
        Some(split_id.to_string()),
    )
    .await?;

    child.locktime = Some(mercuryrustlib::get_blockheight(&BackupTx {
        tx_n: 1,
        tx: signed_tx.clone(),
        client_public_nonce: child.public_nonce.as_ref().unwrap().to_string(),
        server_public_nonce: child.server_public_nonce.as_ref().unwrap().to_string(),
        client_public_key: child.user_pubkey.clone(),
        server_public_key: child.server_pubkey.as_ref().unwrap().to_string(),
        blinding_factor: child.blinding_factor.as_ref().unwrap().to_string(),
    })?);

    Ok(BackupTx {
        tx_n: 1,
        tx: signed_tx,
        client_public_nonce: child.public_nonce.as_ref().unwrap().to_string(),
        server_public_nonce: child.server_public_nonce.as_ref().unwrap().to_string(),
        client_public_key: child.user_pubkey.clone(),
        server_public_key: child.server_pubkey.as_ref().unwrap().to_string(),
        blinding_factor: child.blinding_factor.as_ref().unwrap().to_string(),
    })
}

async fn run_split_flow(
    client_config: &mercuryrustlib::client_config::ClientConfig,
    wallet1: &Wallet,
    wallet2: &Wallet,
) -> Result<()> {
    let mut parent = create_confirmed_parent_coin(client_config, &wallet1.name, 2000).await?;
    let parent_statechain_id = parent.statechain_id.clone().unwrap();
    println!("Parent statechain_id: {}", parent_statechain_id);

    let current_wallet =
        mercuryrustlib::sqlite_manager::get_wallet(&client_config.pool, &wallet1.name).await?;
    let mut child_coins = create_child_coins(&current_wallet, 2)?;
    let t = calculate_split_t(&parent, &child_coins)?;

    let split_init = mercuryrustlib::split::split_init(
        client_config,
        &SplitInitRequest {
            statechain_id: parent_statechain_id.clone(),
            auth_sig: parent.signed_statechain_id.clone().unwrap(),
            parent_user_pubkey: parent.user_pubkey.clone(),
            parent_txid: parent.utxo_txid.clone().unwrap(),
            parent_vout: parent.utxo_vout.unwrap(),
            parent_amount_sats: parent.amount.unwrap() as u64,
            t,
            branch_fee_sats: 300,
            children: vec![
                SplitChild {
                    amount_sats: 1000,
                    user_pubkey: child_coins[0].user_pubkey.clone(),
                    auth_xonly_public_key: auth_xonly_pubkey(&child_coins[0])?,
                },
                SplitChild {
                    amount_sats: 700,
                    user_pubkey: child_coins[1].user_pubkey.clone(),
                    auth_xonly_public_key: auth_xonly_pubkey(&child_coins[1])?,
                },
            ],
        },
    )
    .await?;

    println!("Split id: {}", split_init.split_id);

    let unsigned_branch_tx = build_unsigned_branch_tx(
        parent.utxo_txid.as_ref().unwrap(),
        parent.utxo_vout.unwrap(),
        &split_init.children,
        &current_wallet.network,
    )?;

    let parent_amount = parent.amount.unwrap() as u64;
    let parent_aggregate_address = parent.aggregated_address.clone().unwrap();
    let signed_branch_tx = mercuryrustlib::transaction::sign_unsigned_tx_with_purpose(
        client_config,
        &mut parent,
        unsigned_branch_tx,
        parent_amount,
        parent_aggregate_address,
        &current_wallet.network,
        "split_branch".to_string(),
        Some(split_init.split_id.clone()),
    )
    .await?;

    for (child, response) in child_coins.iter_mut().zip(split_init.children.iter()) {
        apply_split_child_response(child, response, &parent, &signed_branch_tx)?;
        set_child_split_id(child, &split_init.split_id);
    }

    let mut child_backups = Vec::with_capacity(child_coins.len());
    for child in child_coins.iter_mut() {
        let backup = sign_child_backup(
            client_config,
            child,
            &split_init.split_id,
            &current_wallet.network,
        )
        .await?;
        child_backups.push(backup);
    }

    let finalize = mercuryrustlib::split::split_finalize(
        client_config,
        &SplitFinalizeRequest {
            split_id: split_init.split_id.clone(),
            statechain_id: parent_statechain_id.clone(),
            auth_sig: parent.signed_statechain_id.clone().unwrap(),
            branch_tx: signed_branch_tx.clone(),
            children: split_init
                .children
                .iter()
                .map(|child| SplitFinalizeChild {
                    statechain_id: child.statechain_id.clone(),
                    funding_vout: child.child_index,
                })
                .collect(),
        },
    )
    .await?;

    println!("Finalized split branch txid: {}", finalize.branch_txid);

    let tree = mercuryrustlib::split::get_statechain_tree(
        client_config,
        &child_coins[0].statechain_id.clone().unwrap(),
    )
    .await?;
    if tree.nodes.len() < 2 {
        return Err(anyhow!(
            "Tree response should include parent and child nodes"
        ));
    }
    println!(
        "Tree info: {} nodes, {} signatures",
        tree.nodes.len(),
        tree.signatures.len()
    );

    let mut wallet =
        mercuryrustlib::sqlite_manager::get_wallet(&client_config.pool, &wallet1.name).await?;
    for coin in wallet.coins.iter_mut() {
        if coin.statechain_id == Some(parent_statechain_id.clone()) {
            coin.status = CoinStatus::TRANSFERRED;
        }
    }
    wallet.coins.extend(child_coins.clone());
    mercuryrustlib::sqlite_manager::update_wallet(&client_config.pool, &wallet).await?;
    for (child, backup) in child_coins.iter().zip(child_backups.iter()) {
        mercuryrustlib::sqlite_manager::insert_or_update_backup_txs(
            &client_config.pool,
            &wallet1.name,
            child.statechain_id.as_ref().unwrap(),
            &vec![backup.clone()],
        )
        .await?;
    }

    let wallet2_transfer_address =
        mercuryrustlib::transfer_receiver::new_transfer_address(client_config, &wallet2.name)
            .await?;
    // Transfer the smaller child and withdraw the larger child. A 400 sat child
    // is useful for exercising small-leaf transfer, but it is dust once a
    // withdrawal fee is subtracted.
    let transfer_child_index = 1;
    let withdraw_child_index = 0;
    mercuryrustlib::transfer_sender::execute(
        client_config,
        &wallet2_transfer_address,
        &wallet1.name,
        child_coins[transfer_child_index]
            .statechain_id
            .as_ref()
            .unwrap(),
        None,
        false,
        None,
    )
    .await?;
    let receive_result =
        mercuryrustlib::transfer_receiver::execute(client_config, &wallet2.name).await?;
    if !receive_result.received_statechain_ids.contains(
        child_coins[transfer_child_index]
            .statechain_id
            .as_ref()
            .unwrap(),
    ) {
        return Err(anyhow!("Receiver did not receive transfer split child"));
    }
    println!(
        "Transferred child statechain_id: {}",
        child_coins[transfer_child_index]
            .statechain_id
            .as_ref()
            .unwrap()
    );

    let withdraw_address = bitcoin_core::getnewaddress()?;
    mercuryrustlib::withdraw::execute(
        client_config,
        &wallet1.name,
        child_coins[withdraw_child_index]
            .statechain_id
            .as_ref()
            .unwrap(),
        &withdraw_address,
        Some(1.0),
        None,
    )
    .await?;
    println!(
        "Withdrew child statechain_id: {}",
        child_coins[withdraw_child_index]
            .statechain_id
            .as_ref()
            .unwrap()
    );

    Ok(())
}

pub async fn execute() -> Result<()> {
    remove_wallet_db();
    env::set_var("ML_NETWORK", "regtest");

    let client_config = mercuryrustlib::client_config::load().await;

    let wallet1 = mercuryrustlib::wallet::create_wallet("split-wallet-1", &client_config).await?;
    mercuryrustlib::sqlite_manager::insert_wallet(&client_config.pool, &wallet1).await?;

    let wallet2 = mercuryrustlib::wallet::create_wallet("split-wallet-2", &client_config).await?;
    mercuryrustlib::sqlite_manager::insert_wallet(&client_config.pool, &wallet2).await?;

    run_split_flow(&client_config, &wallet1, &wallet2).await?;

    println!("TS01 - Split flow completed successfully");

    Ok(())
}
