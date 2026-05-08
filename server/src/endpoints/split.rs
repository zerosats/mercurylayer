use std::{collections::HashSet, str::FromStr};

use bitcoin::{Address, Transaction};
use mercurylib::split::{
    SplitAbortRequest, SplitAbortResponse, SplitFinalizeRequest, SplitFinalizeResponse,
    SplitInitChild, SplitInitRequest, SplitInitResponse, StatechainTreeResponse, branch_txid,
};
use rocket::{State, http::Status, response::status, serde::json::Json};
use secp256k1_zkp::{PublicKey, SecretKey, XOnlyPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{database::split::NodeStatus, server::StateChainEntity};

#[derive(Serialize)]
struct LockboxSplitPrepareChild<'a> {
    statechain_id: &'a str,
}

#[derive(Serialize)]
struct LockboxSplitPrepareRequest<'a> {
    split_id: &'a str,
    parent_statechain_id: &'a str,
    t: &'a str,
    children: Vec<LockboxSplitPrepareChild<'a>>,
}

#[derive(Deserialize)]
struct LockboxSplitPrepareChildResponse {
    statechain_id: String,
    server_pubkey: String,
}

#[derive(Deserialize)]
struct LockboxSplitPrepareResponse {
    children: Vec<LockboxSplitPrepareChildResponse>,
}

#[derive(Serialize)]
struct LockboxSplitLifecycleRequest<'a> {
    split_id: &'a str,
    parent_statechain_id: &'a str,
}

fn strip_0x(value: &str) -> &str {
    value.strip_prefix("0x").unwrap_or(value)
}

fn validate_split_amounts(
    config: &crate::server_config::ServerConfig,
    parent_amount: u64,
    branch_fee: u64,
    child_sum: u64,
) -> Result<(), String> {
    if child_sum + branch_fee != parent_amount {
        return Err("Child amounts plus branch fee must equal parent amount.".to_string());
    }

    let production_network = config.network == "bitcoin" || config.network == "mainnet";
    if production_network && branch_fee == 0 {
        return Err("Zero-fee split branches are not allowed on production networks.".to_string());
    }

    Ok(())
}

async fn post_lockbox_json<T: Serialize>(
    endpoint: &str,
    path: &str,
    payload: &T,
) -> Result<String, String> {
    let client: reqwest::Client = reqwest::Client::new();
    let request = client.post(format!("{}/{}", endpoint, path));

    let response = request
        .json(payload)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(body);
    }

    Ok(body)
}

fn compute_aggregate(
    user_pubkey: &PublicKey,
    server_pubkey: &PublicKey,
    network: &str,
) -> Result<(String, String), String> {
    let aggregate_pubkey = user_pubkey
        .combine(server_pubkey)
        .map_err(|err| err.to_string())?;
    let network = mercurylib::utils::get_network(network).map_err(|err| err.to_string())?;
    let address = Address::p2tr(
        &secp256k1_zkp::Secp256k1::new(),
        aggregate_pubkey.x_only_public_key().0,
        None,
        network,
    );
    Ok((aggregate_pubkey.to_string(), address.to_string()))
}

#[post("/split/init", format = "json", data = "<split_init_request>")]
pub async fn split_init(
    statechain_entity: &State<StateChainEntity>,
    split_init_request: Json<SplitInitRequest>,
) -> status::Custom<Json<Value>> {
    let payload = split_init_request.0.clone();

    if !crate::endpoints::utils::validate_signature(
        &statechain_entity.pool,
        &payload.auth_sig,
        &payload.statechain_id,
    )
    .await
    {
        return status::Custom(
            Status::Unauthorized,
            Json(json!({"message": "Signature does not match authentication key."})),
        );
    }

    let node_status =
        crate::database::split::get_node_status(&statechain_entity.pool, &payload.statechain_id)
            .await;
    if node_status != Some(NodeStatus::Active) {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "Only active leaves can be split."})),
        );
    }

    if payload.children.len() < 2 {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "A split must have at least two children."})),
        );
    }

    let t_bytes = match hex::decode(strip_0x(&payload.t)) {
        Ok(bytes) => bytes,
        Err(_) => {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Invalid t hex."})),
            );
        }
    };
    if t_bytes.len() != 32 || SecretKey::from_slice(&t_bytes).is_err() {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "t must be a valid 32-byte scalar."})),
        );
    }

    let config = crate::server_config::ServerConfig::load();
    let child_sum = payload.children.iter().map(|child| child.amount_sats).sum();
    if let Err(message) = validate_split_amounts(
        &config,
        payload.parent_amount_sats,
        payload.branch_fee_sats,
        child_sum,
    ) {
        return status::Custom(Status::BadRequest, Json(json!({ "message": message })));
    }

    if let Some(stored_amount) =
        crate::database::split::get_parent_amount(&statechain_entity.pool, &payload.statechain_id)
            .await
    {
        if stored_amount != payload.parent_amount_sats {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Parent amount does not match server record."})),
            );
        }
    }

    let parent_user_pubkey = match PublicKey::from_str(&payload.parent_user_pubkey) {
        Ok(public_key) => public_key,
        Err(_) => {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Invalid parent user public key."})),
            );
        }
    };

    let mut unique_child_auth_keys = HashSet::new();
    let mut parsed_children = Vec::with_capacity(payload.children.len());
    for (index, child) in payload.children.iter().enumerate() {
        let user_pubkey = match PublicKey::from_str(&child.user_pubkey) {
            Ok(public_key) => public_key,
            Err(_) => {
                return status::Custom(
                    Status::BadRequest,
                    Json(
                        json!({"message": format!("Invalid child user public key at index {}.", index)}),
                    ),
                );
            }
        };

        let auth_xonly_public_key = match XOnlyPublicKey::from_str(&child.auth_xonly_public_key) {
            Ok(public_key) => public_key,
            Err(_) => {
                return status::Custom(
                    Status::BadRequest,
                    Json(json!({"message": format!("Invalid child auth key at index {}.", index)})),
                );
            }
        };

        if !unique_child_auth_keys.insert(auth_xonly_public_key.to_string()) {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Child auth keys must be unique."})),
            );
        }

        parsed_children.push((child.amount_sats, user_pubkey, auth_xonly_public_key));
    }

    let enclave_index = crate::database::utils::get_enclave_index_from_database(
        &statechain_entity.pool,
        &payload.statechain_id,
    )
    .await
    .unwrap();

    let lockbox_endpoint = config
        .enclaves
        .get(enclave_index as usize)
        .unwrap()
        .url
        .clone();
    let split_id = uuid::Uuid::new_v4().as_simple().to_string();
    let child_statechain_ids: Vec<String> = (0..payload.children.len())
        .map(|_| uuid::Uuid::new_v4().as_simple().to_string())
        .collect();

    let lockbox_payload = LockboxSplitPrepareRequest {
        split_id: &split_id,
        parent_statechain_id: &payload.statechain_id,
        t: strip_0x(&payload.t),
        children: child_statechain_ids
            .iter()
            .map(|id| LockboxSplitPrepareChild { statechain_id: id })
            .collect(),
    };

    let body = match post_lockbox_json(&lockbox_endpoint, "split/prepare", &lockbox_payload).await {
        Ok(body) => body,
        Err(message) => {
            return status::Custom(
                Status::InternalServerError,
                Json(json!({ "message": message })),
            );
        }
    };

    let lockbox_response: LockboxSplitPrepareResponse = match serde_json::from_str(&body) {
        Ok(response) => response,
        Err(err) => {
            return status::Custom(
                Status::InternalServerError,
                Json(json!({"message": format!("Invalid lockbox split response: {}", err)})),
            );
        }
    };

    let branch_logical_tx_n = crate::database::split::get_latest_logical_tx_n(
        &statechain_entity.pool,
        &payload.statechain_id,
    )
    .await
        + 1;

    let mut db_children = Vec::with_capacity(lockbox_response.children.len());
    let mut response_children = Vec::with_capacity(lockbox_response.children.len());

    for (index, child_response) in lockbox_response.children.iter().enumerate() {
        let server_pubkey_hex = strip_0x(&child_response.server_pubkey);
        let server_pubkey = match PublicKey::from_str(server_pubkey_hex) {
            Ok(public_key) => public_key,
            Err(_) => {
                return status::Custom(
                    Status::InternalServerError,
                    Json(json!({"message": "Lockbox returned invalid child server key."})),
                );
            }
        };

        let (amount_sats, user_public_key, auth_xonly_public_key) = parsed_children[index];
        let (aggregate_pubkey, aggregate_address) =
            match compute_aggregate(&user_public_key, &server_pubkey, &config.network) {
                Ok(values) => values,
                Err(message) => {
                    return status::Custom(
                        Status::InternalServerError,
                        Json(json!({ "message": message })),
                    );
                }
            };

        db_children.push(crate::database::split::SplitChildRow {
            statechain_id: child_response.statechain_id.clone(),
            amount_sats,
            user_public_key,
            auth_xonly_public_key,
            server_public_key: server_pubkey,
            child_index: index as u32,
        });

        response_children.push(SplitInitChild {
            statechain_id: child_response.statechain_id.clone(),
            amount_sats,
            server_pubkey: server_pubkey.to_string(),
            aggregate_pubkey,
            aggregate_address,
            child_index: index as u32,
            logical_tx_n_offset: branch_logical_tx_n,
        });
    }

    crate::database::split::create_pending_split(
        &statechain_entity.pool,
        &split_id,
        &payload.statechain_id,
        &parent_user_pubkey,
        &payload.parent_txid,
        payload.parent_vout,
        payload.parent_amount_sats,
        payload.branch_fee_sats,
        &db_children,
        branch_logical_tx_n,
    )
    .await;

    status::Custom(
        Status::Ok,
        Json(json!(SplitInitResponse {
            split_id,
            branch_logical_tx_n,
            children: response_children,
        })),
    )
}

#[post("/split/finalize", format = "json", data = "<split_finalize_request>")]
pub async fn split_finalize(
    statechain_entity: &State<StateChainEntity>,
    split_finalize_request: Json<SplitFinalizeRequest>,
) -> status::Custom<Json<Value>> {
    let payload = split_finalize_request.0.clone();

    if !crate::endpoints::utils::validate_signature(
        &statechain_entity.pool,
        &payload.auth_sig,
        &payload.statechain_id,
    )
    .await
    {
        return status::Custom(
            Status::Unauthorized,
            Json(json!({"message": "Signature does not match authentication key."})),
        );
    }

    let split = crate::database::split::get_split(&statechain_entity.pool, &payload.split_id).await;
    let split = match split {
        Some(split) => split,
        None => {
            return status::Custom(
                Status::NotFound,
                Json(json!({"message": "Split not found."})),
            );
        }
    };

    if split.parent_statechain_id != payload.statechain_id || split.status != "pending" {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "Split is not pending for this parent."})),
        );
    }

    if !crate::database::split::has_completed_signature(
        &statechain_entity.pool,
        &payload.statechain_id,
        "split_branch",
        &payload.split_id,
    )
    .await
    {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "Split branch signature is not complete."})),
        );
    }

    let children =
        crate::database::split::get_split_children(&statechain_entity.pool, &payload.split_id)
            .await;
    for child in &children {
        if !crate::database::split::has_completed_signature(
            &statechain_entity.pool,
            &child.statechain_id,
            "split_child_backup",
            &payload.split_id,
        )
        .await
        {
            return status::Custom(
                Status::BadRequest,
                Json(
                    json!({"message": format!("Child {} initial backup signature is not complete.", child.statechain_id)}),
                ),
            );
        }
    }

    let branch_tx_bytes = match hex::decode(strip_0x(&payload.branch_tx)) {
        Ok(bytes) => bytes,
        Err(_) => {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Invalid branch transaction hex."})),
            );
        }
    };
    let branch_tx: Transaction = match bitcoin::consensus::encode::deserialize(&branch_tx_bytes) {
        Ok(tx) => tx,
        Err(_) => {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Invalid branch transaction."})),
            );
        }
    };
    let branch_txid = match branch_txid(strip_0x(&payload.branch_tx)) {
        Ok(txid) => txid,
        Err(err) => {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": err.to_string()})),
            );
        }
    };

    if payload.children.len() != children.len() {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "Finalize child count does not match split child count."})),
        );
    }

    let network =
        mercurylib::utils::get_network(&crate::server_config::ServerConfig::load().network)
            .unwrap();
    let mut child_outpoints = Vec::with_capacity(children.len());

    for child in &children {
        let finalize_child = payload
            .children
            .iter()
            .find(|item| item.statechain_id == child.statechain_id);
        let finalize_child = match finalize_child {
            Some(child) => child,
            None => {
                return status::Custom(
                    Status::BadRequest,
                    Json(
                        json!({"message": format!("Missing finalize data for child {}.", child.statechain_id)}),
                    ),
                );
            }
        };

        let tx_output = branch_tx.output.get(finalize_child.funding_vout as usize);
        let tx_output = match tx_output {
            Some(output) => output,
            None => {
                return status::Custom(
                    Status::BadRequest,
                    Json(json!({"message": "Child funding vout is outside branch outputs."})),
                );
            }
        };

        let aggregate_pubkey = child
            .user_public_key
            .combine(&child.server_public_key)
            .unwrap();
        let expected_address = Address::p2tr(
            &secp256k1_zkp::Secp256k1::new(),
            aggregate_pubkey.x_only_public_key().0,
            None,
            network,
        );
        if tx_output.value != child.amount_sats
            || tx_output.script_pubkey != expected_address.script_pubkey()
        {
            return status::Custom(
                Status::BadRequest,
                Json(json!({"message": "Branch output does not match child amount/key."})),
            );
        }

        child_outpoints.push((child.statechain_id.clone(), finalize_child.funding_vout));
    }

    let config = crate::server_config::ServerConfig::load();
    let enclave_index = crate::database::utils::get_enclave_index_from_database(
        &statechain_entity.pool,
        &payload.statechain_id,
    )
    .await
    .unwrap();
    let lockbox_endpoint = config
        .enclaves
        .get(enclave_index as usize)
        .unwrap()
        .url
        .clone();
    let lockbox_payload = LockboxSplitLifecycleRequest {
        split_id: &payload.split_id,
        parent_statechain_id: &payload.statechain_id,
    };

    if let Err(message) =
        post_lockbox_json(&lockbox_endpoint, "split/finalize", &lockbox_payload).await
    {
        return status::Custom(
            Status::InternalServerError,
            Json(json!({ "message": message })),
        );
    }

    crate::database::split::finalize_split(
        &statechain_entity.pool,
        &payload.split_id,
        &branch_tx_bytes,
        &branch_txid,
        &child_outpoints,
    )
    .await;

    status::Custom(
        Status::Ok,
        Json(json!(SplitFinalizeResponse {
            finalized: true,
            branch_txid,
        })),
    )
}

#[post("/split/abort", format = "json", data = "<split_abort_request>")]
pub async fn split_abort(
    statechain_entity: &State<StateChainEntity>,
    split_abort_request: Json<SplitAbortRequest>,
) -> status::Custom<Json<Value>> {
    let payload = split_abort_request.0.clone();

    if !crate::endpoints::utils::validate_signature(
        &statechain_entity.pool,
        &payload.auth_sig,
        &payload.statechain_id,
    )
    .await
    {
        return status::Custom(
            Status::Unauthorized,
            Json(json!({"message": "Signature does not match authentication key."})),
        );
    }

    let split = crate::database::split::get_split(&statechain_entity.pool, &payload.split_id).await;
    let split = match split {
        Some(split) => split,
        None => {
            return status::Custom(
                Status::NotFound,
                Json(json!({"message": "Split not found."})),
            );
        }
    };

    if split.parent_statechain_id != payload.statechain_id || split.status != "pending" {
        return status::Custom(
            Status::BadRequest,
            Json(json!({"message": "Only pending splits can be aborted."})),
        );
    }

    let config = crate::server_config::ServerConfig::load();
    let enclave_index = crate::database::utils::get_enclave_index_from_database(
        &statechain_entity.pool,
        &payload.statechain_id,
    )
    .await
    .unwrap();
    let lockbox_endpoint = config
        .enclaves
        .get(enclave_index as usize)
        .unwrap()
        .url
        .clone();
    let lockbox_payload = LockboxSplitLifecycleRequest {
        split_id: &payload.split_id,
        parent_statechain_id: &payload.statechain_id,
    };

    if let Err(message) =
        post_lockbox_json(&lockbox_endpoint, "split/abort", &lockbox_payload).await
    {
        return status::Custom(
            Status::InternalServerError,
            Json(json!({ "message": message })),
        );
    }

    crate::database::split::abort_split(&statechain_entity.pool, &payload.split_id).await;

    status::Custom(
        Status::Ok,
        Json(json!(SplitAbortResponse { aborted: true })),
    )
}

#[get("/info/statechain/<statechain_id>/tree")]
pub async fn statechain_tree(
    statechain_entity: &State<StateChainEntity>,
    statechain_id: &str,
) -> status::Custom<Json<Value>> {
    let nodes =
        crate::database::split::get_tree_nodes(&statechain_entity.pool, statechain_id).await;

    if nodes.is_empty() {
        return status::Custom(
            Status::NotFound,
            Json(json!({"message": "Statechain tree not found."})),
        );
    }

    let statechain_ids = nodes
        .iter()
        .map(|node| node.statechain_id.clone())
        .collect::<Vec<_>>();
    let signatures =
        crate::database::split::get_tree_signatures(&statechain_entity.pool, &statechain_ids).await;

    status::Custom(
        Status::Ok,
        Json(json!(StatechainTreeResponse { nodes, signatures })),
    )
}
