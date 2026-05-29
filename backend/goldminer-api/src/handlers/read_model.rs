//! read_model.rs 负责只读查询 HTTP 入口。
//!
//! 这些 handler 只做三件事：
//! - 解析 path/query 参数
//! - 选择默认 challenge/limit
//! - 调用 read_model_service 返回只读视图
//!
//! 它们不触碰 replay、session 激活或链上写入。

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Json,
};

use crate::{
    app_state::AppState,
    models::{
        HealthResponse, IndexerStatusResponse, LeaderboardQuery, PaginationQuery,
        RankedCurrentResponse, RankedOverviewQuery, RankedOverviewResponse,
        ReadModelCampaignHistoryEntry, ReadModelCampaignLeaderboardEntry,
    },
    parse_address, ApiError,
    services::read_model_service,
};

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

pub async fn read_ranked_current(
    State(state): State<Arc<AppState>>,
) -> Result<Json<RankedCurrentResponse>, ApiError> {
    read_model_service::read_ranked_current(&state).await.map(Json)
}

pub async fn read_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LeaderboardQuery>,
) -> Result<Json<Vec<crate::models::ReadModelLeaderboardEntry>>, ApiError> {
    // 如果客户端未显式指定 challenge，就回落到 manifest 中的默认当前 challenge。
    let challenge = if let Some(challenge_id) = query.challenge_id.clone() {
        let challenge_version = query.challenge_version.unwrap_or(1);
        (challenge_id, challenge_version)
    } else {
        let default_challenge = state
            .ranked_challenges
            .first()
            .ok_or_else(|| ApiError::bad_request("ranked challenge manifest is empty"))?;
        (
            default_challenge.challenge_id.clone(),
            default_challenge.version,
        )
    };
    let limit = query.limit.unwrap_or(20).clamp(1, 100);

    read_model_service::read_leaderboard(&state, challenge.0, challenge.1, limit)
        .await
        .map(Json)
}

pub async fn read_history(
    State(state): State<Arc<AppState>>,
    Path(player): Path<String>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<Vec<crate::models::ReadModelHistoryEntry>>, ApiError> {
    // history/overview 这类按地址查询的接口，先把 path 参数解析成 Address，再进入 service 层。
    let player = parse_address(&player).map_err(ApiError::internal)?;
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);

    read_model_service::read_history(&state, player, limit, offset)
        .await
        .map(Json)
}

pub async fn read_ranked_overview(
    State(state): State<Arc<AppState>>,
    Path(player): Path<String>,
    Query(query): Query<RankedOverviewQuery>,
) -> Result<Json<RankedOverviewResponse>, ApiError> {
    let player = parse_address(&player).map_err(ApiError::internal)?;
    let challenge = if let Some(challenge_id) = query.challenge_id.clone() {
        let challenge_version = query.challenge_version.unwrap_or(1);
        (challenge_id, challenge_version)
    } else {
        let default_challenge = state
            .ranked_challenges
            .first()
            .ok_or_else(|| ApiError::bad_request("ranked challenge manifest is empty"))?;
        (
            default_challenge.challenge_id.clone(),
            default_challenge.version,
        )
    };

    read_model_service::read_ranked_overview(&state, player, challenge.0, challenge.1)
        .await
        .map(Json)
}

pub async fn indexer_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<IndexerStatusResponse>, ApiError> {
    read_model_service::read_indexer_status(&state)
        .await
        .map(Json)
}

pub async fn read_campaign_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LeaderboardQuery>,
) -> Result<Json<Vec<ReadModelCampaignLeaderboardEntry>>, ApiError> {
    // campaign leaderboard 不按 challenge 过滤；这里只消费 limit，并复用统一 read model service。
    let limit = query.limit.unwrap_or(20).clamp(1, 100);

    read_model_service::read_campaign_leaderboard(&state, limit)
        .await
        .map(Json)
}

pub async fn read_campaign_history(
    State(state): State<Arc<AppState>>,
    Path(player): Path<String>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<Vec<ReadModelCampaignHistoryEntry>>, ApiError> {
    let player = parse_address(&player).map_err(ApiError::internal)?;
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = query.offset.unwrap_or(0);

    read_model_service::read_campaign_history(&state, player, limit, offset)
        .await
        .map(Json)
}
