use anyhow::{Result, anyhow};
use mercurylib::split::{
    SplitAbortRequest, SplitAbortResponse, SplitFinalizeRequest, SplitFinalizeResponse,
    SplitInitRequest, SplitInitResponse, StatechainTreeResponse,
};

use crate::client_config::ClientConfig;

pub async fn split_init(
    client_config: &ClientConfig,
    payload: &SplitInitRequest,
) -> Result<SplitInitResponse> {
    let client = client_config.get_reqwest_client()?;
    let response = client
        .post(format!("{}/split/init", client_config.statechain_entity))
        .json(payload)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow!(body));
    }

    Ok(serde_json::from_str(&body)?)
}

pub async fn split_finalize(
    client_config: &ClientConfig,
    payload: &SplitFinalizeRequest,
) -> Result<SplitFinalizeResponse> {
    let client = client_config.get_reqwest_client()?;
    let response = client
        .post(format!(
            "{}/split/finalize",
            client_config.statechain_entity
        ))
        .json(payload)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow!(body));
    }

    Ok(serde_json::from_str(&body)?)
}

pub async fn split_abort(
    client_config: &ClientConfig,
    payload: &SplitAbortRequest,
) -> Result<SplitAbortResponse> {
    let client = client_config.get_reqwest_client()?;
    let response = client
        .post(format!("{}/split/abort", client_config.statechain_entity))
        .json(payload)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow!(body));
    }

    Ok(serde_json::from_str(&body)?)
}

pub async fn get_statechain_tree(
    client_config: &ClientConfig,
    statechain_id: &str,
) -> Result<StatechainTreeResponse> {
    let client = client_config.get_reqwest_client()?;
    let response = client
        .get(format!(
            "{}/info/statechain/{}/tree",
            client_config.statechain_entity, statechain_id
        ))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        return Err(anyhow!(body));
    }

    Ok(serde_json::from_str(&body)?)
}
