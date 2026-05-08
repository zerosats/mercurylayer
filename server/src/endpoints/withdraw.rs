use rocket::{State, http::Status, response::status, serde::json::Json};
use serde_json::{Value, json};

use crate::server::StateChainEntity;

async fn delete_statechain_db(pool: &sqlx::PgPool, statechain_id: &String) {
    let mut transaction = pool.begin().await.unwrap();

    let _ = sqlx::query("DELETE FROM statechain_transfer WHERE statechain_id = $1")
        .bind(statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    let _ = sqlx::query("DELETE FROM statechain_data WHERE statechain_id = $1")
        .bind(statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    let _ = sqlx::query("DELETE FROM statechain_signature_data WHERE statechain_id = $1")
        .bind(statechain_id)
        .execute(&mut *transaction)
        .await
        .unwrap();

    transaction.commit().await.unwrap();
}

#[post(
    "/withdraw/complete",
    format = "json",
    data = "<delete_statechain_payload>"
)]
pub async fn withdraw_complete(
    statechain_entity: &State<StateChainEntity>,
    delete_statechain_payload: Json<mercurylib::withdraw::WithdrawCompletePayload>,
) -> status::Custom<Json<Value>> {
    let statechain_id = delete_statechain_payload.0.statechain_id.clone();
    let signed_statechain_id = delete_statechain_payload.0.signed_statechain_id.clone();

    if !crate::endpoints::utils::validate_signature(
        &statechain_entity.pool,
        &signed_statechain_id,
        &statechain_id,
    )
    .await
    {
        let response_body = json!({
            "message": "Signature does not match authentication key."
        });

        return status::Custom(Status::InternalServerError, Json(response_body));
    }

    if crate::database::split::get_node_status(&statechain_entity.pool, &statechain_id).await
        != Some(crate::database::split::NodeStatus::Active)
    {
        let response_body = json!({
            "message": "Only active leaves can be withdrawn."
        });

        return status::Custom(Status::BadRequest, Json(response_body));
    }

    let config = crate::server_config::ServerConfig::load();

    let enclave_index = crate::database::utils::get_enclave_index_from_database(
        &statechain_entity.pool,
        &statechain_id,
    )
    .await;

    let enclave_index = match enclave_index {
        Some(index) => index,
        None => {
            let response_body = json!({
                "message": format!("Enclave index for statechain {} ID not found.", statechain_id)
            });

            return status::Custom(Status::InternalServerError, Json(response_body));
        }
    };

    let enclave_index = enclave_index as usize;

    let lockbox_endpoint = config.enclaves.get(enclave_index).unwrap().url.clone();
    let path = "delete_statechain";

    let client: reqwest::Client = reqwest::Client::new();
    let request = client.delete(format!("{}/{}/{}", lockbox_endpoint, path, statechain_id));

    let response = request.send().await;

    if response.is_err() {
        let response_body = json!({
            "error": "Internal Server Error",
            "message": response.err().unwrap().to_string()
        });

        return status::Custom(Status::InternalServerError, Json(response_body));
    };

    crate::database::split::set_node_status(
        &statechain_entity.pool,
        &statechain_id,
        crate::database::split::NodeStatus::Withdrawn,
    )
    .await;
    delete_statechain_db(&statechain_entity.pool, &statechain_id).await;

    let response_body = json!({
        "message": "Statechain deleted.",
    });

    status::Custom(Status::Ok, Json(response_body))
}
