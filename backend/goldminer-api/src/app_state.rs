//! AppState 是 API 进程级共享依赖的聚合根。
//!
//! handlers、workers 和服务层都只从这里读取：
//! - 配置
//! - 数据库连接池
//! - 链客户端
//! - verifier / relayer 身份
//! - ranked / adventure manifest 及其查找表
//!
//! 关键约束是：manifest 的原始列表与 lookup 表必须在启动时一起构建完成，
//! 运行期只读访问，不在请求处理中动态重建。

use std::collections::BTreeMap;
use std::sync::Arc;

use alloy::signers::local::PrivateKeySigner;
use goldminer_core::{
    ChallengeLevelSummary, RankedChallengeManifest, RankedChallengeManifestEntry,
    RankedChallengeSummary, RankedManifest, RankedManifestLevel,
};
use sqlx::SqlitePool;

use crate::{chain_client::ChainClient, config::AppConfig};

pub struct AppState {
    pub config: AppConfig,
    pub db: SqlitePool,
    pub chain_client: Arc<dyn ChainClient>,
    pub relayer_address: alloy::primitives::Address,
    pub verifier_signer: PrivateKeySigner,
    pub ranked_manifest: RankedChallengeManifest,
    pub ranked_challenges: Vec<RankedChallengeSummary>,
    pub ranked_challenge_lookup: BTreeMap<(String, u32), RankedChallengeManifestEntry>,
    pub adventure_manifest: RankedManifest,
    pub adventure_levels: Vec<ChallengeLevelSummary>,
    pub adventure_level_lookup: BTreeMap<(String, u32), RankedManifestLevel>,
}

impl AppState {
    pub fn ranked_challenge(
        &self,
        challenge_id: &str,
        version: u32,
    ) -> Option<&RankedChallengeManifestEntry> {
        // ranked challenge lookup 是运行期热点路径；启动时预建索引，避免 handler 每次线性扫描 manifest。
        self.ranked_challenge_lookup
            .get(&(challenge_id.to_string(), version))
    }

    pub fn adventure_level(&self, level_id: &str, version: u32) -> Option<&RankedManifestLevel> {
        // adventure level 也遵循同样约束：请求期只查只读索引，不在链路中临时拼接 lookup key 集合。
        self.adventure_level_lookup
            .get(&(level_id.to_string(), version))
    }
}
