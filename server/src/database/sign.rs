use sqlx::Row;

pub async fn get_server_pubnonce_from_null_challenge(
    pool: &sqlx::PgPool,
    statechain_id: &str,
    purpose: &str,
    split_id: &Option<String>,
) -> Option<String> {
    let query = "SELECT server_pubnonce FROM statechain_signature_data WHERE statechain_id = $1 \
                 AND purpose = $2 AND split_id IS NOT DISTINCT FROM $3 AND challenge is NULL \
                 ORDER BY created_at ASC";

    let row = sqlx::query(query)
        .bind(statechain_id)
        .bind(purpose)
        .bind(split_id)
        .fetch_optional(pool)
        .await
        .unwrap();

    row.as_ref()?;

    let row = row.unwrap();

    let server_pubnonce: String = row.get(0);

    Some(server_pubnonce)
}

pub async fn insert_new_signature_data(
    pool: &sqlx::PgPool,
    server_pubnonce: &str,
    statechain_id: &str,
    purpose: &str,
    split_id: &Option<String>,
) {
    let mut transaction = pool.begin().await.unwrap();

    // FOR UPDATE is used to lock the row for the duration of the transaction
    // It is not allowed with aggregate functions (MAX in this case), so we need to
    // wrap it in a subquery
    let max_tx_k_query = "\
        SELECT COALESCE(MAX(tx_n), 0) FROM (SELECT * FROM statechain_signature_data WHERE \
                          statechain_id = $1 FOR UPDATE) AS result";

    let row = sqlx::query(max_tx_k_query)
        .bind(statechain_id)
        .fetch_one(&mut *transaction)
        .await
        .unwrap();

    let mut new_tx_n = row.get::<i32, _>(0);
    new_tx_n += 1;

    let offset_query =
        "SELECT logical_tx_n_offset FROM statechain_data WHERE statechain_id = $1 FOR UPDATE";
    let row = sqlx::query(offset_query)
        .bind(statechain_id)
        .fetch_one(&mut *transaction)
        .await
        .unwrap();
    let logical_tx_n_offset = row.get::<i32, _>(0);
    let logical_tx_n = logical_tx_n_offset + new_tx_n;

    let query = "\
        INSERT INTO statechain_signature_data (server_pubnonce, statechain_id, tx_n, purpose, \
                 split_id, logical_tx_n) VALUES ($1, $2, $3, $4, $5, $6)";

    let _ = sqlx::query(query)
        .bind(server_pubnonce)
        .bind(statechain_id)
        .bind(new_tx_n)
        .bind(purpose)
        .bind(split_id)
        .bind(logical_tx_n)
        .execute(&mut *transaction)
        .await
        .unwrap();

    transaction.commit().await.unwrap();
}

pub async fn update_signature_data_challenge(
    pool: &sqlx::PgPool,
    server_pub_nonce: &str,
    challenge: &str,
    statechain_id: &str,
    purpose: &str,
    split_id: &Option<String>,
) {
    let query = "\
        UPDATE statechain_signature_data SET challenge = $1 WHERE statechain_id = $2 AND \
                 server_pubnonce= $3 AND purpose = $4 AND split_id IS NOT DISTINCT FROM $5";

    let _ = sqlx::query(query)
        .bind(challenge)
        .bind(statechain_id)
        .bind(server_pub_nonce)
        .bind(purpose)
        .bind(split_id)
        .execute(pool)
        .await
        .unwrap();
}
