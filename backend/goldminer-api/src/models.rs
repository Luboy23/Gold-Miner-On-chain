//! models.rs 定义 API 层的数据契约与数据库映射结构。
//!
//! 这里的“status”大多描述的是上传、relay、索引和读取模型生命周期，不等价于
//! core crate 里的 replay 校验真值。把两类状态拆开，能避免前端把“链上尚未确认”
//! 误解成“本局成绩无效”。

use alloy::primitives::{Address, B256};
use goldminer_core::{
    ActiveSessionPermit, CampaignEvidenceV2, RankedChallengeSummary, RankedRunEvidenceV3,
    SessionPermitTypedData,
    VerifiedCampaignRecord, VerifiedRunRecord,
};
use serde::{Deserialize, Serialize};

pub use goldminer_core::ChallengeLevelSummary;

pub const SESSION_STATUS_CREATED: &str = "created";
pub const SESSION_STATUS_ACTIVE: &str = "active";
pub const SESSION_STATUS_QUEUED: &str = "queued";
pub const SESSION_STATUS_SUBMITTED: &str = "submitted";
pub const SESSION_STATUS_CONFIRMED: &str = "confirmed";
pub const SESSION_STATUS_FAILED: &str = "failed";

pub const RUN_STATUS_VALIDATED: &str = "validated";
pub const RUN_STATUS_SUBMITTED: &str = "submitted";
pub const RUN_STATUS_CONFIRMED: &str = "confirmed";
pub const RUN_STATUS_FAILED: &str = "failed";

pub const INDEXER_STATUS_IDLE: &str = "idle";
pub const INDEXER_STATUS_RUNNING: &str = "running";
pub const INDEXER_STATUS_ERROR: &str = "error";
pub const INDEXER_CURSOR_KEY: &str = "goldminer-scoreboard-read-model";
pub const RUN_SUBMITTED_SIGNATURE: &str =
    "RunSubmitted(address,bytes32,uint32,uint32,uint32,bytes32)";
pub const CAMPAIGN_STATUS_CREATED: &str = "created";
pub const CAMPAIGN_STATUS_ACTIVE: &str = "active";
pub const CAMPAIGN_STATUS_SUBMITTED: &str = "submitted";
pub const CAMPAIGN_STATUS_CONFIRMED: &str = "confirmed";
pub const CAMPAIGN_STATUS_FAILED: &str = "failed";
pub const CAMPAIGN_SUBMITTED_SIGNATURE: &str =
    "CampaignSubmitted(address,bytes32,uint8,bool,uint32,uint32,uint16,bytes32)";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub player: Address,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampaignRequest {
    pub player: Address,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionResponse {
    pub session_id: B256,
    pub deadline: u64,
    pub max_runs: u16,
    pub permit: ActiveSessionPermit,
    pub typed_data: SessionPermitTypedData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampaignResponse {
    pub campaign_id: B256,
    pub session_id: B256,
    pub campaign_seed: B256,
    pub deadline: u64,
    pub max_runs: u16,
    pub permit: ActiveSessionPermit,
    pub typed_data: SessionPermitTypedData,
    pub levels: Vec<ChallengeLevelSummary>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateSessionRequest {
    pub player: Address,
    pub session_id: B256,
    pub signature: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateCampaignRequest {
    pub player: Address,
    pub campaign_id: B256,
    pub session_id: B256,
    pub signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateSessionResponse {
    pub ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateCampaignResponse {
    pub ok: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRunRequest {
    pub player: Address,
    pub session_id: B256,
    pub evidence: RankedRunEvidenceV3,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadCampaignEvidenceRequest {
    pub player: Address,
    pub evidence: CampaignEvidenceV2,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRunResponse {
    pub run: VerifiedRunRecord,
    pub status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadCampaignEvidenceResponse {
    pub campaign: VerifiedCampaignRecord,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeSessionResponse {
    pub ok: bool,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatusResponse {
    pub session_id: B256,
    pub status: String,
    pub validated_runs: i64,
    pub submitted_runs: i64,
    pub confirmed_runs: i64,
    pub failed_runs: i64,
    pub tx_hashes: Vec<String>,
    pub last_error: Option<String>,
}

// Session/Campaign 的 status response 反映的是 relay/database 生命周期：
// 例如 pending、submitted、confirmed、failed。它们不是 replay 重算结果，
// 也不负责解释 hook 合法性、score 真值等 core 约束。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignStatusResponse {
    pub campaign_id: B256,
    pub session_id: B256,
    pub status: String,
    pub tx_hash: Option<B256>,
    pub last_error: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardQuery {
    pub challenge_id: Option<String>,
    pub challenge_version: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Deserialize, Default)]
pub struct PaginationQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RankedOverviewQuery {
    pub challenge_id: Option<String>,
    pub challenge_version: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelRunResult {
    pub challenge_id: String,
    pub challenge_version: u32,
    pub diamonds_caught: u32,
    pub last_diamond_at_ms: u32,
    pub evidence_hash: B256,
    pub submitted_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelLeaderboardEntry {
    pub player: Address,
    pub result: ReadModelRunResult,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelHistoryEntry {
    pub player: Address,
    pub result: ReadModelRunResult,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelCampaignResult {
    pub campaign_id: B256,
    pub reached_level: u8,
    pub completed: bool,
    pub final_score: u32,
    pub total_duration_ms: u32,
    pub purchased_item_count: u16,
    pub evidence_hash: B256,
    pub submitted_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelCampaignLeaderboardEntry {
    pub player: Address,
    pub result: ReadModelCampaignResult,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelCampaignHistoryEntry {
    pub player: Address,
    pub result: ReadModelCampaignResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerStatusResponse {
    pub ok: bool,
    pub status: String,
    pub last_processed_block: u64,
    pub last_processed_log_index: i64,
    pub last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedCurrentResponse {
    pub board_id: String,
    pub current_challenge: Option<RankedChallengeSummary>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelGapSummary {
    pub diamonds_delta: u32,
    pub time_delta_ms: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RankedOverviewPersonalBest {
    pub best_diamonds_caught: u32,
    pub best_last_diamond_at_ms: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RankedOverviewLatestRun {
    pub diamonds_caught: u32,
    pub last_diamond_at_ms: u32,
    pub submitted_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RankedOverviewResponse {
    pub challenge_id: String,
    pub challenge_version: u32,
    pub personal_best: Option<RankedOverviewPersonalBest>,
    pub latest_run: Option<RankedOverviewLatestRun>,
    pub run_count: u32,
    pub current_best_rank: Option<u32>,
    pub leader_gap: Option<ReadModelGapSummary>,
    pub next_beat_gap: Option<ReadModelGapSummary>,
}

#[derive(Clone)]
pub struct SessionRow {
    pub permit: ActiveSessionPermit,
    pub permit_signature: Option<String>,
    pub status: String,
    pub finalize_requested_at_ms: Option<i64>,
    pub accepted_run_count: i64,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct CampaignRow {
    pub campaign_id: B256,
    pub session_id: B256,
    pub player: Address,
    pub campaign_seed: B256,
    pub permit_signature: Option<String>,
    pub status: String,
    pub tx_hash: Option<B256>,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct IndexerCursorRow {
    pub status: String,
    pub last_processed_block: u64,
    pub last_processed_log_index: i64,
    pub last_error: Option<String>,
}

pub enum RelayDispatchOutcome {
    // RelayDispatchOutcome 只表达链交易派发到了哪一步，便于 handler 写库和前端轮询。
    // 它不会覆盖或修正前面 replay 校验阶段的成功/失败结论。
    Confirmed(B256),
    Submitted(B256, String),
    Reverted(B256),
}
