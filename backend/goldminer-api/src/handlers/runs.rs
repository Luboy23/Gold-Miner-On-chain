//! runs.rs 负责 ranked run evidence 上传入口。
//!
//! 这条链路的职责顺序固定为：
//! 1. 校验 session 是否存在且仍可上传
//! 2. 校验本地 manifest 与链上 catalog 是否一致
//! 3. 调用 core 做 ranked replay 校验
//! 4. 把 validated run 与原始/规范化 payload 落库
//!
//! handler 不负责链上 relay；通过 replay 校验后的 run 会交给后续 relay worker 处理。

use std::sync::Arc;

use axum::{extract::State, Json};
use goldminer_core::validate_evidence;

use crate::{
    app_state::AppState,
    db,
    models::{UploadRunRequest, UploadRunResponse, SESSION_STATUS_ACTIVE},
    now_ms, ApiError,
};

pub async fn upload_run(
    State(state): State<Arc<AppState>>,
    Json(request): Json<UploadRunRequest>,
) -> Result<Json<UploadRunResponse>, ApiError> {
    let session = db::load_session_row(
        &state.db,
        request.session_id,
        request.player,
        &state.config.deployment_id,
    )
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::bad_request("session not found"))?;

    // run 上传只能发生在已激活 session 内；未激活或已失效的会话不允许继续接受 evidence。
    if session.permit_signature.is_none() || session.status != SESSION_STATUS_ACTIVE {
        return Err(ApiError::bad_request(
            "session must be active before uploading runs",
        ));
    }
    if now_ms() / 1_000 > session.permit.deadline {
        return Err(ApiError::bad_request("session permit expired"));
    }
    if session.accepted_run_count >= i64::from(session.permit.max_runs) {
        return Err(ApiError::bad_request("session maxRuns exceeded"));
    }

    // 前端上传的 challenge 元数据必须同时和本地 manifest、链上 catalog 对齐；
    // 这一步先收紧“配置真相源”，再进入更昂贵的 replay 校验。
    let manifest_level = state
        .ranked_challenge(&request.evidence.challenge_id, request.evidence.challenge_version)
        .ok_or_else(|| ApiError::bad_request("ranked challenge manifest entry not found"))?;
    let chain_level = state
        .chain_client
        .fetch_level_catalog_entry(
            &request.evidence.challenge_id,
            request.evidence.challenge_version,
        )
        .await
        .map_err(ApiError::internal)?;

    if chain_level.content_hash != manifest_level.content_hash
        || chain_level.challenge_seed != manifest_level.challenge_seed
    {
        return Err(ApiError::internal(
            "ranked challenge manifest is out of sync with the chain catalog",
        ));
    }
    if request.evidence.challenge_content_hash != chain_level.content_hash {
        return Err(ApiError::bad_request(
            "challengeContentHash does not match chain catalog",
        ));
    }
    if request.evidence.challenge_seed != chain_level.challenge_seed {
        return Err(ApiError::bad_request(
            "challengeSeed does not match chain catalog",
        ));
    }
    if !chain_level.enabled {
        return Err(ApiError::bad_request(
            "ranked challenge is not enabled on chain",
        ));
    }

    let validated = validate_evidence(&request.evidence, request.session_id, manifest_level)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;

    let now = now_ms();
    let payload_json = serde_json::to_string(&request.evidence).map_err(ApiError::internal)?;
    let verified_payload_json = serde_json::to_string(&validated).map_err(ApiError::internal)?;
    // 落库时同时保留原始 payload 与已验证 payload，便于后续 relay、审计和失败排查。
    let insert_outcome = db::insert_validated_run_for_active_session(
        &state.db,
        request.session_id,
        request.player,
        &validated,
        request.evidence.protocol_version,
        request.evidence.simulation_version,
        request.evidence.challenge_seed,
        request.evidence.finished_tick,
        &payload_json,
        &verified_payload_json,
        now,
    )
    .await
    .map_err(ApiError::internal)?;

    if insert_outcome == db::ValidatedRunInsertOutcome::Rejected {
        return Err(ApiError::bad_request(
            "session cannot accept more validated runs",
        ));
    }

    Ok(Json(UploadRunResponse {
        run: validated,
        status: "validated",
    }))
}
