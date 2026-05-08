use std::str::FromStr;

use bitcoin::{Address, OutPoint, ScriptBuf, Transaction, TxIn, TxOut, Txid, Witness, absolute};
use secp256k1_zkp::{PublicKey, Secp256k1};
use serde::{Deserialize, Serialize};

use crate::{MercuryError, utils::get_network};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitChild {
    pub amount_sats: u64,
    pub user_pubkey: String,
    pub auth_xonly_public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitInitRequest {
    pub statechain_id: String,
    pub auth_sig: String,
    pub parent_user_pubkey: String,
    pub parent_txid: String,
    pub parent_vout: u32,
    pub parent_amount_sats: u64,
    pub t: String,
    pub branch_fee_sats: u64,
    pub children: Vec<SplitChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitInitChild {
    pub statechain_id: String,
    pub amount_sats: u64,
    pub server_pubkey: String,
    pub aggregate_pubkey: String,
    pub aggregate_address: String,
    pub child_index: u32,
    pub logical_tx_n_offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitInitResponse {
    pub split_id: String,
    pub branch_logical_tx_n: u32,
    pub children: Vec<SplitInitChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitFinalizeChild {
    pub statechain_id: String,
    pub funding_vout: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitFinalizeRequest {
    pub split_id: String,
    pub statechain_id: String,
    pub auth_sig: String,
    pub branch_tx: String,
    pub children: Vec<SplitFinalizeChild>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitFinalizeResponse {
    pub finalized: bool,
    pub branch_txid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitAbortRequest {
    pub split_id: String,
    pub statechain_id: String,
    pub auth_sig: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct SplitAbortResponse {
    pub aborted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct BranchTxProof {
    pub split_id: String,
    pub parent_statechain_id: String,
    pub branch_tx: String,
    pub child_vout: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct LeafProof {
    pub root_statechain_id: String,
    pub branches: Vec<BranchTxProof>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct StatechainTreeNode {
    pub statechain_id: String,
    pub root_statechain_id: String,
    pub parent_statechain_id: Option<String>,
    pub status: String,
    pub amount_sats: Option<u64>,
    pub funding_txid: Option<String>,
    pub funding_vout: Option<u32>,
    pub child_index: Option<u32>,
    pub user_public_key: Option<String>,
    pub server_public_key: Option<String>,
    pub logical_tx_n_offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct StatechainTreeSignature {
    pub statechain_id: String,
    pub server_pubnonce: String,
    pub challenge: Option<String>,
    pub tx_n: u32,
    pub logical_tx_n: u32,
    pub purpose: String,
    pub split_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(uniffi::Record))]
pub struct StatechainTreeResponse {
    pub nodes: Vec<StatechainTreeNode>,
    pub signatures: Vec<StatechainTreeSignature>,
}

pub fn aggregate_pubkey(user_pubkey: &str, server_pubkey: &str) -> Result<PublicKey, MercuryError> {
    let user_pubkey = PublicKey::from_str(user_pubkey)?;
    let server_pubkey = PublicKey::from_str(server_pubkey)?;
    Ok(user_pubkey.combine(&server_pubkey)?)
}

pub fn aggregate_address(
    user_pubkey: &str,
    server_pubkey: &str,
    network: &str,
) -> Result<String, MercuryError> {
    let network = get_network(network)?;
    let aggregate_pubkey = aggregate_pubkey(user_pubkey, server_pubkey)?;
    let address = Address::p2tr(
        &Secp256k1::new(),
        aggregate_pubkey.x_only_public_key().0,
        None,
        network,
    );
    Ok(address.to_string())
}

pub fn build_unsigned_branch_tx(
    parent_txid: &str,
    parent_vout: u32,
    children: &[SplitInitChild],
    network: &str,
) -> Result<String, MercuryError> {
    let network = get_network(network)?;
    let input_txid = Txid::from_str(parent_txid)?;

    let mut outputs = Vec::with_capacity(children.len());
    for child in children {
        let aggregate_pubkey = PublicKey::from_str(&child.aggregate_pubkey)?;
        let address = Address::p2tr(
            &Secp256k1::new(),
            aggregate_pubkey.x_only_public_key().0,
            None,
            network,
        );
        outputs.push(TxOut {
            value: child.amount_sats,
            script_pubkey: address.script_pubkey(),
        });
    }

    let tx = Transaction {
        version: 2,
        lock_time: absolute::LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: input_txid,
                vout: parent_vout,
            },
            script_sig: ScriptBuf::new(),
            sequence: bitcoin::Sequence(0),
            witness: Witness::default(),
        }],
        output: outputs,
    };

    Ok(hex::encode(bitcoin::consensus::encode::serialize(&tx)))
}

pub fn branch_txid(branch_tx_hex: &str) -> Result<String, MercuryError> {
    let tx: Transaction = bitcoin::consensus::encode::deserialize(&hex::decode(branch_tx_hex)?)?;
    Ok(tx.txid().to_string())
}
