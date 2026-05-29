use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use goldminer_core::{
    build_campaign_seed, build_campaign_evidence_hash, build_session_id,
    build_session_permit_typed_data, deployment_id_hash, session_permit_digest,
    sign_campaign_digest, validate_campaign_evidence, verifier_campaign_digest,
    verify_signature, ActiveSessionPermit,
};

use crate::{
    app_state::AppState,
    db,
    models::{
        ActivateCampaignRequest, ActivateCampaignResponse, CampaignStatusResponse,
        CreateCampaignRequest, CreateCampaignResponse, UploadCampaignEvidenceRequest,
        UploadCampaignEvidenceResponse, CAMPAIGN_STATUS_ACTIVE, CAMPAIGN_STATUS_CONFIRMED,
        CAMPAIGN_STATUS_FAILED, CAMPAIGN_STATUS_SUBMITTED,
    },
    now_ms, ApiError,
};

/// campaigns handler 负责 campaign 会话的 HTTP 生命周期：
/// 1. create：创建链下会话和 permit
/// 2. activate：验证玩家签名并激活当前 campaign
/// 3. upload evidence：做 replay 校验、生成 verifier 摘要并提交链上
/// 4. status：轮询链上确认结果并回写数据库状态
///
/// 关键边界：
/// - 这里负责“请求合法性 + replay 校验 + 持久化 + relay”
/// - 不负责修正前端 evidence；前端一旦上传错误 payload，这里只会拒绝
pub async fn create_campaign(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateCampaignRequest>,
) -> Result<Json<CreateCampaignResponse>, ApiError> {
    let created_at_ms = now_ms();
    let now_seconds = created_at_ms / 1_000;
    let permit = db::create_game_session(
        &state.db,
        request.player,
        &state.config.deployment_id,
        created_at_ms,
        |nonce| ActiveSessionPermit {
            player: request.player,
            delegate: state.relayer_address,
            session_id: build_session_id(
                request.player,
                nonce,
                created_at_ms,
                &state.config.deployment_id,
            ),
            deployment_id_hash: deployment_id_hash(&state.config.deployment_id),
            issued_at: now_seconds,
            deadline: now_seconds + state.config.session_ttl_seconds,
            nonce,
            max_runs: 1,
        },
    )
    .await
    .map_err(ApiError::internal)?;
    let campaign_id = permit.session_id;
    let campaign_seed = build_campaign_seed(campaign_id, request.player, &state.config.deployment_id);
    db::insert_campaign_session(
        &state.db,
        campaign_id,
        permit.session_id,
        request.player,
        campaign_seed,
        created_at_ms,
    )
    .await
    .map_err(ApiError::internal)?;
    let typed_data = build_session_permit_typed_data(
        &permit,
        state.config.chain_id,
        state.config.scoreboard_address,
    );

    Ok(Json(CreateCampaignResponse {
        campaign_id,
        session_id: permit.session_id,
        campaign_seed,
        deadline: permit.deadline,
        max_runs: permit.max_runs,
        permit,
        typed_data,
        levels: state.adventure_levels.clone(),
    }))
}

pub async fn activate_campaign(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ActivateCampaignRequest>,
) -> Result<Json<ActivateCampaignResponse>, ApiError> {
    // 约束：当前实现把 campaign_id 绑定为 session_id，
    // 这样前后端与合约侧都可以用同一根会话真值追踪整次 campaign。
    if request.campaign_id != request.session_id {
        return Err(ApiError::bad_request("campaignId must match sessionId"));
    }

    let campaign = db::load_campaign_row(&state.db, request.campaign_id, request.player)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("campaign not found"))?;
    let session = db::load_session_row(
        &state.db,
        campaign.session_id,
        request.player,
        &state.config.deployment_id,
    )
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::bad_request("campaign session not found"))?;

    let digest = session_permit_digest(
        &session.permit,
        state.config.chain_id,
        state.config.scoreboard_address,
    );
    verify_signature(digest, &request.signature, request.player)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;

    let now = now_ms();
    db::activate_game_session(
        &state.db,
        campaign.session_id,
        request.player,
        &request.signature,
        now,
    )
    .await
    .map_err(ApiError::internal)?;
    db::activate_campaign(
        &state.db,
        request.campaign_id,
        request.player,
        &request.signature,
        now,
    )
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(ActivateCampaignResponse { ok: true }))
}

pub async fn upload_campaign_evidence(
    State(state): State<Arc<AppState>>,
    Path(campaign_id): Path<String>,
    Json(request): Json<UploadCampaignEvidenceRequest>,
) -> Result<Json<UploadCampaignEvidenceResponse>, ApiError> {
    let campaign_id = campaign_id
        .parse()
        .map_err(|error| ApiError::bad_request(format!("parse campaign id: {error}")))?;
    let campaign = db::load_campaign_row(&state.db, campaign_id, request.player)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("campaign not found"))?;
    let session = db::load_session_row(
        &state.db,
        campaign.session_id,
        request.player,
        &state.config.deployment_id,
    )
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::bad_request("campaign session not found"))?;

    if campaign.status != CAMPAIGN_STATUS_ACTIVE && campaign.status != CAMPAIGN_STATUS_FAILED {
        return Err(ApiError::bad_request("campaign must be active before uploading evidence"));
    }
    if session.permit_signature.is_none() || session.status != CAMPAIGN_STATUS_ACTIVE {
        return Err(ApiError::bad_request("campaign session must be active before uploading evidence"));
    }
    if now_ms() / 1_000 > session.permit.deadline {
        return Err(ApiError::bad_request("session permit expired"));
    }
    if request.evidence.campaign_id != campaign.campaign_id {
        return Err(ApiError::bad_request("evidence campaignId does not match active campaign"));
    }
    if request.evidence.session_id != campaign.session_id {
        return Err(ApiError::bad_request("evidence sessionId does not match active campaign"));
    }
    for level in &request.evidence.levels {
        // 先比对本地 manifest 与链上 catalog，避免服务端在目录漂移时错误接受旧关卡。
        let manifest_level = state
            .adventure_level(&level.level_id, level.level_version)
            .ok_or_else(|| ApiError::bad_request("adventure manifest entry not found"))?;
        let chain_level = state
            .chain_client
            .fetch_level_catalog_entry(&level.level_id, level.level_version)
            .await
            .map_err(ApiError::internal)?;
        if chain_level.content_hash != manifest_level.content_hash
            || chain_level.challenge_seed != manifest_level.challenge_seed
        {
            return Err(ApiError::internal(
                "adventure manifest is out of sync with the chain catalog",
            ));
        }
        if !chain_level.enabled {
            return Err(ApiError::bad_request("campaign level is not enabled on chain"));
        }
    }

    let verified = validate_campaign_evidence(
        &request.evidence,
        campaign.campaign_id,
        campaign.session_id,
        campaign.campaign_seed,
        &state.adventure_manifest,
    )
    .map_err(|error| ApiError::bad_request(error.to_string()))?;
    // 走到这里意味着逐关 replay、shop purchases、关卡顺序和 finalScore 都已通过校验。

    let payload_json = serde_json::to_string(&request.evidence).map_err(ApiError::internal)?;
    let verified_payload_json = serde_json::to_string(&verified).map_err(ApiError::internal)?;
    let digest = verifier_campaign_digest(
        &session.permit,
        &verified,
        state.config.chain_id,
        state.config.scoreboard_address,
    );
    let verifier_signature = sign_campaign_digest(&state.verifier_signer, digest)
        .await
        .map_err(ApiError::internal)?;
    let player_signature = session
        .permit_signature
        .clone()
        .ok_or_else(|| ApiError::bad_request("campaign permit signature missing"))?;

    let relay_outcome = state
        .chain_client
        .submit_verified_campaign(
            &session.permit,
            &player_signature,
            &verified,
            &verifier_signature,
        )
        .await
        .map_err(ApiError::internal)?;

    let now = now_ms();
    // 数据库中的 status 记录的是 relay 当前已知状态，而不是 replay 校验状态；
    // replay 在提交链上之前就已经完成。
    let (status, tx_hash, last_error) = match relay_outcome {
        crate::models::RelayDispatchOutcome::Confirmed(tx_hash) => {
            (CAMPAIGN_STATUS_CONFIRMED.to_string(), Some(tx_hash), None)
        }
        crate::models::RelayDispatchOutcome::Submitted(tx_hash, message) => (
            CAMPAIGN_STATUS_SUBMITTED.to_string(),
            Some(tx_hash),
            Some(message),
        ),
        crate::models::RelayDispatchOutcome::Reverted(tx_hash) => (
            CAMPAIGN_STATUS_FAILED.to_string(),
            Some(tx_hash),
            Some("relay transaction reverted".to_string()),
        ),
    };
    db::store_campaign_submission(
        &state.db,
        campaign.campaign_id,
        request.player,
        &payload_json,
        &verified_payload_json,
        &status,
        tx_hash,
        last_error.as_deref(),
        now,
    )
    .await
    .map_err(ApiError::internal)?;

    let _ = build_campaign_evidence_hash(&request.evidence).map_err(ApiError::internal)?;

    Ok(Json(UploadCampaignEvidenceResponse {
        campaign: verified,
        status,
    }))
}

pub async fn campaign_status(
    State(state): State<Arc<AppState>>,
    Path(campaign_id): Path<String>,
) -> Result<Json<CampaignStatusResponse>, ApiError> {
    let campaign_id = campaign_id
        .parse()
        .map_err(|error| ApiError::bad_request(format!("parse campaign id: {error}")))?;
    let campaign = db::load_campaign_row_by_id(&state.db, campaign_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("campaign not found"))?;

    if campaign.status == CAMPAIGN_STATUS_SUBMITTED {
        // SUBMITTED 只是“交易已发出但前端还没拿到最终确认”。
        // status 查询会尽量把这类中间态折叠成 confirmed/failed。
        if let Some(tx_hash) = campaign.tx_hash {
            if let Some(receipt) = state
                .chain_client
                .get_transaction_receipt(tx_hash)
                .await
                .map_err(ApiError::internal)?
            {
                let next_status = if receipt.success {
                    CAMPAIGN_STATUS_CONFIRMED
                } else {
                    CAMPAIGN_STATUS_FAILED
                };
                let next_error = if receipt.success {
                    None
                } else {
                    Some("relay transaction reverted")
                };
                db::update_campaign_submission_status(
                    &state.db,
                    campaign.campaign_id,
                    next_status,
                    Some(tx_hash),
                    next_error,
                    now_ms(),
                )
                .await
                .map_err(ApiError::internal)?;
            }
        }
    }

    let refreshed = db::load_campaign_row_by_id(&state.db, campaign_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("campaign not found"))?;

    Ok(Json(CampaignStatusResponse {
        campaign_id: refreshed.campaign_id,
        session_id: refreshed.session_id,
        status: refreshed.status,
        tx_hash: refreshed.tx_hash,
        last_error: refreshed.last_error,
    }))
}
