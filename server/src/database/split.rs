use mercurylib::split::{StatechainTreeNode, StatechainTreeSignature};
use secp256k1_zkp::{PublicKey, XOnlyPublicKey};
use sqlx::Row;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeStatus {
    Active,
    PendingSplit,
    PendingChild,
    Split,
    Withdrawn,
    Unknown(String),
}

impl NodeStatus {
    pub fn from_db(value: String) -> Self {
        match value.as_str() {
            "active" => Self::Active,
            "pending_split" => Self::PendingSplit,
            "pending_child" => Self::PendingChild,
            "split" => Self::Split,
            "withdrawn" => Self::Withdrawn,
            _ => Self::Unknown(value),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::Active => "active",
            Self::PendingSplit => "pending_split",
            Self::PendingChild => "pending_child",
            Self::Split => "split",
            Self::Withdrawn => "withdrawn",
            Self::Unknown(value) => value.as_str(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SplitChildRow {
    pub statechain_id: String,
    pub amount_sats: u64,
    pub user_public_key: PublicKey,
    pub auth_xonly_public_key: XOnlyPublicKey,
    pub server_public_key: PublicKey,
    pub child_index: u32,
}

#[derive(Debug, Clone)]
pub struct SplitRow {
    pub parent_statechain_id: String,
    pub status: String,
}

pub async fn get_node_status(pool: &sqlx::PgPool, statechain_id: &str) -> Option<NodeStatus> {
    let row = sqlx::query("SELECT status FROM statechain_data WHERE statechain_id = $1")
        .bind(statechain_id)
        .fetch_optional(pool)
        .await
        .unwrap();

    row.map(|row| NodeStatus::from_db(row.get::<String, _>(0)))
}

pub async fn set_node_status(pool: &sqlx::PgPool, statechain_id: &str, status: NodeStatus) {
    let _ = sqlx::query("UPDATE statechain_data SET status = $1 WHERE statechain_id = $2")
        .bind(status.as_str())
        .bind(statechain_id)
        .execute(pool)
        .await
        .unwrap();
}

pub async fn get_latest_logical_tx_n(pool: &sqlx::PgPool, statechain_id: &str) -> u32 {
    let row = sqlx::query(
        "SELECT COALESCE(MAX(logical_tx_n), 0) FROM statechain_signature_data WHERE statechain_id \
         = $1",
    )
    .bind(statechain_id)
    .fetch_one(pool)
    .await
    .unwrap();

    row.get::<i32, _>(0) as u32
}

pub async fn get_parent_amount(pool: &sqlx::PgPool, statechain_id: &str) -> Option<u64> {
    let row = sqlx::query("SELECT amount_sats FROM statechain_data WHERE statechain_id = $1")
        .bind(statechain_id)
        .fetch_optional(pool)
        .await
        .unwrap();

    row.and_then(|row| row.get::<Option<i64>, _>(0).map(|v| v as u64))
}

pub async fn create_pending_split(
    pool: &sqlx::PgPool,
    split_id: &str,
    parent_statechain_id: &str,
    parent_user_pubkey: &PublicKey,
    parent_txid: &str,
    parent_vout: u32,
    parent_amount_sats: u64,
    branch_fee_sats: u64,
    children: &[SplitChildRow],
    logical_tx_n_offset: u32,
) {
    let mut transaction = pool.begin().await.unwrap();

    let parent_root_row = sqlx::query(
        "SELECT root_statechain_id FROM statechain_data WHERE statechain_id = $1 FOR UPDATE",
    )
    .bind(parent_statechain_id)
    .fetch_one(&mut *transaction)
    .await
    .unwrap();

    let root_statechain_id: String = parent_root_row.get(0);

    let _ = sqlx::query(
        "UPDATE statechain_data SET status = 'pending_split', amount_sats = COALESCE(amount_sats, \
         $1), funding_txid = COALESCE(funding_txid, $2), funding_vout = COALESCE(funding_vout, \
         $3), user_public_key = COALESCE(user_public_key, $4) WHERE statechain_id = $5",
    )
    .bind(parent_amount_sats as i64)
    .bind(parent_txid)
    .bind(parent_vout as i32)
    .bind(parent_user_pubkey.serialize())
    .bind(parent_statechain_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    let _ = sqlx::query(
        "INSERT INTO statechain_splits (split_id, parent_statechain_id, status, branch_fee_sats) \
         VALUES ($1, $2, 'pending', $3)",
    )
    .bind(split_id)
    .bind(parent_statechain_id)
    .bind(branch_fee_sats as i64)
    .execute(&mut *transaction)
    .await
    .unwrap();

    for child in children {
        let _ = sqlx::query(
            "INSERT INTO statechain_data (auth_xonly_public_key, server_public_key, \
             statechain_id, enclave_index, root_statechain_id, parent_statechain_id, status, \
             amount_sats, child_index, user_public_key, logical_tx_n_offset) SELECT $1, $2, $3, \
             enclave_index, $4, $5, 'pending_child', $6, $7, $8, $9 FROM statechain_data WHERE \
             statechain_id = $5",
        )
        .bind(child.auth_xonly_public_key.serialize())
        .bind(child.server_public_key.serialize())
        .bind(&child.statechain_id)
        .bind(&root_statechain_id)
        .bind(parent_statechain_id)
        .bind(child.amount_sats as i64)
        .bind(child.child_index as i32)
        .bind(child.user_public_key.serialize())
        .bind(logical_tx_n_offset as i32)
        .execute(&mut *transaction)
        .await
        .unwrap();

        let _ = sqlx::query(
            "INSERT INTO statechain_split_children (split_id, child_statechain_id, child_index, \
             amount_sats, user_public_key, auth_xonly_public_key, server_public_key) VALUES ($1, \
             $2, $3, $4, $5, $6, $7)",
        )
        .bind(split_id)
        .bind(&child.statechain_id)
        .bind(child.child_index as i32)
        .bind(child.amount_sats as i64)
        .bind(child.user_public_key.serialize())
        .bind(child.auth_xonly_public_key.serialize())
        .bind(child.server_public_key.serialize())
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    transaction.commit().await.unwrap();
}

pub async fn get_split(pool: &sqlx::PgPool, split_id: &str) -> Option<SplitRow> {
    let row = sqlx::query(
        "SELECT split_id, parent_statechain_id, status FROM statechain_splits WHERE split_id = $1",
    )
    .bind(split_id)
    .fetch_optional(pool)
    .await
    .unwrap();

    row.map(|row| SplitRow {
        parent_statechain_id: row.get(1),
        status: row.get(2),
    })
}

pub async fn get_split_children(pool: &sqlx::PgPool, split_id: &str) -> Vec<SplitChildRow> {
    let rows = sqlx::query(
        "SELECT child_statechain_id, amount_sats, user_public_key, auth_xonly_public_key, \
         server_public_key, child_index FROM statechain_split_children WHERE split_id = $1 ORDER \
         BY child_index ASC",
    )
    .bind(split_id)
    .fetch_all(pool)
    .await
    .unwrap();

    rows.iter()
        .map(|row| SplitChildRow {
            statechain_id: row.get(0),
            amount_sats: row.get::<i64, _>(1) as u64,
            user_public_key: PublicKey::from_slice(&row.get::<Vec<u8>, _>(2)).unwrap(),
            auth_xonly_public_key: XOnlyPublicKey::from_slice(&row.get::<Vec<u8>, _>(3)).unwrap(),
            server_public_key: PublicKey::from_slice(&row.get::<Vec<u8>, _>(4)).unwrap(),
            child_index: row.get::<i32, _>(5) as u32,
        })
        .collect()
}

pub async fn has_completed_signature(
    pool: &sqlx::PgPool,
    statechain_id: &str,
    purpose: &str,
    split_id: &str,
) -> bool {
    let row = sqlx::query(
        "SELECT 1 FROM statechain_signature_data WHERE statechain_id = $1 AND purpose = $2 AND \
         split_id = $3 AND challenge IS NOT NULL LIMIT 1",
    )
    .bind(statechain_id)
    .bind(purpose)
    .bind(split_id)
    .fetch_optional(pool)
    .await
    .unwrap();

    row.is_some()
}

pub async fn finalize_split(
    pool: &sqlx::PgPool,
    split_id: &str,
    branch_tx: &[u8],
    branch_txid: &str,
    child_outpoints: &[(String, u32)],
) {
    let mut transaction = pool.begin().await.unwrap();

    let split_row = sqlx::query(
        "SELECT parent_statechain_id FROM statechain_splits WHERE split_id = $1 FOR UPDATE",
    )
    .bind(split_id)
    .fetch_one(&mut *transaction)
    .await
    .unwrap();

    let parent_statechain_id: String = split_row.get(0);

    let _ = sqlx::query(
        "UPDATE statechain_splits SET status = 'finalized', branch_tx = $1, branch_txid = $2, \
         updated_at = NOW() WHERE split_id = $3",
    )
    .bind(branch_tx)
    .bind(branch_txid)
    .bind(split_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    let _ = sqlx::query("UPDATE statechain_data SET status = 'split' WHERE statechain_id = $1")
        .bind(&parent_statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    for (child_statechain_id, child_vout) in child_outpoints {
        let _ = sqlx::query(
            "UPDATE statechain_data SET status = 'active', funding_txid = $1, funding_vout = $2 \
             WHERE statechain_id = $3",
        )
        .bind(branch_txid)
        .bind(*child_vout as i32)
        .bind(child_statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();
    }

    transaction.commit().await.unwrap();
}

pub async fn abort_split(pool: &sqlx::PgPool, split_id: &str) -> Option<String> {
    let mut transaction = pool.begin().await.unwrap();

    let split_row = sqlx::query(
        "SELECT parent_statechain_id FROM statechain_splits WHERE split_id = $1 FOR UPDATE",
    )
    .bind(split_id)
    .fetch_optional(&mut *transaction)
    .await
    .unwrap();

    let split_row = split_row?;
    let parent_statechain_id: String = split_row.get(0);

    let child_rows = sqlx::query(
        "SELECT child_statechain_id FROM statechain_split_children WHERE split_id = $1",
    )
    .bind(split_id)
    .fetch_all(&mut *transaction)
    .await
    .unwrap();

    for row in child_rows {
        let child_statechain_id: String = row.get(0);
        let _ = sqlx::query("DELETE FROM statechain_signature_data WHERE statechain_id = $1")
            .bind(&child_statechain_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
        let _ = sqlx::query("DELETE FROM statechain_data WHERE statechain_id = $1")
            .bind(&child_statechain_id)
            .execute(&mut *transaction)
            .await
            .unwrap();
    }

    let _ = sqlx::query("DELETE FROM statechain_split_children WHERE split_id = $1")
        .bind(split_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    let _ = sqlx::query(
        "UPDATE statechain_splits SET status = 'aborted', updated_at = NOW() WHERE split_id = $1",
    )
    .bind(split_id)
    .execute(&mut *transaction)
    .await
    .unwrap();

    let _ = sqlx::query("UPDATE statechain_data SET status = 'active' WHERE statechain_id = $1")
        .bind(&parent_statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    transaction.commit().await.unwrap();

    Some(parent_statechain_id)
}

pub async fn get_tree_nodes(pool: &sqlx::PgPool, statechain_id: &str) -> Vec<StatechainTreeNode> {
    let root_row =
        sqlx::query("SELECT root_statechain_id FROM statechain_data WHERE statechain_id = $1")
            .bind(statechain_id)
            .fetch_optional(pool)
            .await
            .unwrap();

    if root_row.is_none() {
        return vec![];
    }

    let root_statechain_id: String = root_row.unwrap().get(0);
    let rows = sqlx::query(
        "SELECT statechain_id, root_statechain_id, parent_statechain_id, status, amount_sats, \
         funding_txid, funding_vout, child_index, user_public_key, server_public_key, \
         logical_tx_n_offset FROM statechain_data WHERE root_statechain_id = $1 ORDER BY id ASC",
    )
    .bind(root_statechain_id)
    .fetch_all(pool)
    .await
    .unwrap();

    rows.iter()
        .map(|row| {
            let server_public_key = row
                .get::<Option<Vec<u8>>, _>(9)
                .map(|bytes| PublicKey::from_slice(&bytes).unwrap().to_string());
            StatechainTreeNode {
                statechain_id: row.get(0),
                root_statechain_id: row.get(1),
                parent_statechain_id: row.get(2),
                status: row.get(3),
                amount_sats: row.get::<Option<i64>, _>(4).map(|v| v as u64),
                funding_txid: row.get(5),
                funding_vout: row.get::<Option<i32>, _>(6).map(|v| v as u32),
                child_index: row.get::<Option<i32>, _>(7).map(|v| v as u32),
                user_public_key: row
                    .get::<Option<Vec<u8>>, _>(8)
                    .map(|bytes| PublicKey::from_slice(&bytes).unwrap().to_string()),
                server_public_key,
                logical_tx_n_offset: row.get::<i32, _>(10) as u32,
            }
        })
        .collect()
}

pub async fn get_tree_signatures(
    pool: &sqlx::PgPool,
    statechain_ids: &[String],
) -> Vec<StatechainTreeSignature> {
    if statechain_ids.is_empty() {
        return vec![];
    }

    let rows = sqlx::query(
        "SELECT statechain_id, server_pubnonce, challenge, tx_n, logical_tx_n, purpose, split_id \
         FROM statechain_signature_data WHERE statechain_id = ANY($1) ORDER BY created_at ASC",
    )
    .bind(statechain_ids)
    .fetch_all(pool)
    .await
    .unwrap();

    rows.iter()
        .map(|row| StatechainTreeSignature {
            statechain_id: row.get(0),
            server_pubnonce: row.get(1),
            challenge: row.get(2),
            tx_n: row.get::<i32, _>(3) as u32,
            logical_tx_n: row.get::<i32, _>(4) as u32,
            purpose: row.get(5),
            split_id: row.get(6),
        })
        .collect()
}
