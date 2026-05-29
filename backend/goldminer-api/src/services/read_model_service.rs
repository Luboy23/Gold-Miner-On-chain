use std::sync::Arc;

use alloy::primitives::Address;

use crate::{
    app_state::AppState,
    db::{
        campaign_read_model, indexed_read_model_write, ranked_read_model,
    },
    models::{
        IndexerStatusResponse, RankedCurrentResponse, ReadModelCampaignHistoryEntry,
        ReadModelCampaignLeaderboardEntry, ReadModelHistoryEntry, ReadModelLeaderboardEntry,
        RankedOverviewResponse,
    },
    ApiError,
};

/// read_model_service 是 API 层对只读视图的统一门面。
///
/// 它把三类来源收口成前端可消费的查询接口：
/// - 链上当前 challenge 指针
/// - 本地数据库中的 ranked/campaign read model
/// - indexer 自身状态
///
/// 它不负责 replay 校验，也不负责写链。
pub async fn read_ranked_current(
    state: &Arc<AppState>,
) -> Result<RankedCurrentResponse, ApiError> {
    let current = state
        .chain_client
        .fetch_current_ranked_challenge()
        .await
        .map_err(ApiError::internal)?;
    // 链上只保存“当前 challenge 指针”，给前端展示的可读摘要仍然来自本地 manifest。
    let current_challenge = current.and_then(|pointer| {
        state
            .ranked_challenge(&pointer.challenge_id, pointer.challenge_version)
            .map(|entry| entry.summary())
    });

    Ok(RankedCurrentResponse {
        board_id: state.ranked_manifest.board_id.clone(),
        current_challenge,
    })
}

pub async fn read_leaderboard(
    state: &Arc<AppState>,
    challenge_id: String,
    challenge_version: u32,
    limit: u32,
) -> Result<Vec<ReadModelLeaderboardEntry>, ApiError> {
    // leaderboard/history/overview 都只从本地 read model 读，不在查询链路里再触链或重做 replay。
    ranked_read_model::query_leaderboard(&state.db, &challenge_id, challenge_version, limit)
        .await
        .map_err(ApiError::internal)
}

pub async fn read_history(
    state: &Arc<AppState>,
    player: Address,
    limit: u32,
    offset: u32,
) -> Result<Vec<ReadModelHistoryEntry>, ApiError> {
    ranked_read_model::query_history(&state.db, player, limit, offset)
        .await
        .map_err(ApiError::internal)
}

pub async fn read_ranked_overview(
    state: &Arc<AppState>,
    player: Address,
    challenge_id: String,
    challenge_version: u32,
) -> Result<RankedOverviewResponse, ApiError> {
    ranked_read_model::query_overview(&state.db, player, &challenge_id, challenge_version)
        .await
        .map_err(ApiError::internal)
}

pub async fn read_campaign_leaderboard(
    state: &Arc<AppState>,
    limit: u32,
) -> Result<Vec<ReadModelCampaignLeaderboardEntry>, ApiError> {
    // campaign 结果页和冒险中心使用的是链下 read model 视图，而不是直接回放 campaigns payload。
    campaign_read_model::query_campaign_leaderboard(&state.db, limit)
        .await
        .map_err(ApiError::internal)
}

pub async fn read_campaign_history(
    state: &Arc<AppState>,
    player: Address,
    limit: u32,
    offset: u32,
) -> Result<Vec<ReadModelCampaignHistoryEntry>, ApiError> {
    campaign_read_model::query_campaign_history(&state.db, player, limit, offset)
        .await
        .map_err(ApiError::internal)
}

pub async fn read_indexer_status(
    state: &Arc<AppState>,
) -> Result<IndexerStatusResponse, ApiError> {
    // indexer status 只服务运维/调试可见性，不参与 gameplay 或结果真值判断。
    indexed_read_model_write::query_indexer_status(&state.db)
        .await
        .map_err(ApiError::internal)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, str::FromStr, sync::Arc};

    use alloy::{primitives::{Address, B256}, signers::local::PrivateKeySigner};
    use anyhow::Result;
    use async_trait::async_trait;
    use goldminer_core::{
        RankedChallengeManifest, RankedChallengeManifestEntry, RankedManifest,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::{
        chain_client::{ChainClient, ChainReceipt, LevelCatalogEntry, RankedChallengePointer},
        config::AppConfig,
        db::init_db,
        models::RelayDispatchOutcome,
    };

    const TEST_PRIVATE_KEY: &str =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    #[derive(Clone)]
    struct TestChainClient {
        current: Option<RankedChallengePointer>,
    }

    #[async_trait]
    impl ChainClient for TestChainClient {
        async fn fetch_level_catalog_entry(
            &self,
            _level_id: &str,
            _level_version: u32,
        ) -> Result<LevelCatalogEntry> {
            unreachable!("unused in read_model_service tests")
        }

        async fn fetch_current_ranked_challenge(&self) -> Result<Option<RankedChallengePointer>> {
            Ok(self.current.clone())
        }

        async fn submit_verified_batch(
            &self,
            _permit: &goldminer_core::ActiveSessionPermit,
            _player_permit_sig: &str,
            _runs: &[goldminer_core::VerifiedRunRecord],
            _batch_id: B256,
            _verifier_sig: &str,
        ) -> Result<RelayDispatchOutcome> {
            unreachable!("unused in read_model_service tests")
        }

        async fn submit_verified_campaign(
            &self,
            _permit: &goldminer_core::ActiveSessionPermit,
            _player_permit_sig: &str,
            _campaign: &goldminer_core::VerifiedCampaignRecord,
            _verifier_sig: &str,
        ) -> Result<RelayDispatchOutcome> {
            unreachable!("unused in read_model_service tests")
        }

        async fn get_transaction_receipt(&self, _tx_hash: B256) -> Result<Option<ChainReceipt>> {
            Ok(None)
        }

        async fn get_latest_block_number(&self) -> Result<u64> {
            Ok(0)
        }

        async fn get_logs(&self, _filter: alloy::rpc::types::Filter) -> Result<Vec<alloy::rpc::types::Log>> {
            Ok(Vec::new())
        }

        async fn get_block_timestamp(&self, _block_number: u64) -> Result<u64> {
            Ok(0)
        }
    }

    async fn create_test_pool() -> Result<sqlx::SqlitePool> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        init_db(&pool).await?;
        Ok(pool)
    }

    fn build_test_config() -> AppConfig {
        AppConfig {
            bind: "127.0.0.1:8788".parse().expect("parse bind"),
            database_url: "sqlite::memory:".to_string(),
            rpc_url: "http://127.0.0.1:8545".to_string(),
            chain_id: 31337,
            deployment_id: "test-deployment".to_string(),
            scoreboard_address: Address::from([0x11; 20]),
            level_catalog_address: Address::from([0x22; 20]),
            session_ttl_seconds: 7200,
            session_max_runs: 10,
            max_batch_runs: 8,
            auto_finalize_idle_seconds: 45,
            indexer_poll_interval_ms: 3000,
            indexer_confirmations: 0,
            ranked_manifest_path: "unused.json".into(),
            adventure_manifest_path: "unused.json".into(),
        }
    }

    fn build_test_ranked_entry() -> RankedChallengeManifestEntry {
        RankedChallengeManifestEntry {
            challenge_id: "diamond_rush_60".to_string(),
            version: 1,
            order: 1,
            content_hash: B256::from([0x11; 32]),
            challenge_seed: B256::from([0x22; 32]),
            simulation_version: 1,
            logic_fps: 60,
            time_limit_ticks: 3600,
            enabled: true,
            is_current: true,
            canonical: serde_json::from_value(serde_json::json!({
                "challengeId": "diamond_rush_60",
                "challengeVersion": 1,
                "simulationVersion": 1,
                "logicFps": 60,
                "timeLimitTicks": 3600,
                "boardKind": "ranked",
                "theme": "LevelD",
                "constants": {
                    "hookOrigin": { "x": 0.0, "y": 0.0 },
                    "hookCollisionOffset": 0.0,
                    "hookMinAngle": 0.0,
                    "hookMaxAngle": 0.0,
                    "hookRotateSpeed": 0.0,
                    "hookMaxLength": 0.0,
                    "hookGrabSpeed": 0.0,
                    "hookEmptyReturnSpeed": 0.0,
                    "hookCollisionRadius": 0.0,
                    "hookResolveDurationSec": 0.0,
                    "questionBagExtraDynamiteChance": 0.0,
                    "maxDynamiteCount": 0,
                    "defaultStrengthMultiplier": 0.0,
                    "maxStrengthMultiplier": 0.0,
                    "movingEntityIdleDurationSec": 0.0,
                    "movingEntityPixelsPerSecond": 0.0,
                    "movingEntityTurnThreshold": 0.0
                },
                "entityConfigs": {},
                "spawnPoints": [],
                "spawnPolicy": {
                    "cycleSize": 0,
                    "shuffleAlgorithm": "seeded-cycle-no-repeat",
                    "entityType": "Diamond",
                    "allowItems": false,
                    "allowDynamiteAction": false
                }
            }))
            .expect("deserialize ranked challenge canonical"),
        }
    }

    fn build_test_state(
        pool: sqlx::SqlitePool,
        current: Option<RankedChallengePointer>,
    ) -> Arc<AppState> {
        let verifier_signer =
            PrivateKeySigner::from_str(TEST_PRIVATE_KEY).expect("parse verifier signer");
        let ranked_entry = build_test_ranked_entry();
        let ranked_manifest = RankedChallengeManifest {
            version: 1,
            generated_at: "test".to_string(),
            board_id: "diamond_rush_60".to_string(),
            simulation_version: 1,
            logic_fps: 60,
            challenges: vec![ranked_entry.clone()],
        };

        Arc::new(AppState {
            config: build_test_config(),
            db: pool,
            chain_client: Arc::new(TestChainClient { current }),
            relayer_address: Address::from([0x33; 20]),
            verifier_signer,
            ranked_manifest,
            ranked_challenges: vec![ranked_entry.summary()],
            ranked_challenge_lookup: BTreeMap::from([(
                (ranked_entry.challenge_id.clone(), ranked_entry.version),
                ranked_entry,
            )]),
            adventure_manifest: RankedManifest {
                version: 1,
                generated_at: "test".to_string(),
                simulation_version: 1,
                logic_fps: 60,
                levels: Vec::new(),
            },
            adventure_levels: Vec::new(),
            adventure_level_lookup: BTreeMap::new(),
        })
    }

    #[tokio::test]
    async fn read_ranked_current_combines_chain_pointer_with_manifest_summary() -> Result<()> {
        let pool = create_test_pool().await?;
        let state = build_test_state(
            pool,
            Some(RankedChallengePointer {
                challenge_id: "diamond_rush_60".to_string(),
                challenge_version: 1,
            }),
        );

        let response = read_ranked_current(&state).await.expect("read ranked current");
        let summary = response.current_challenge.expect("current challenge");

        assert_eq!(response.board_id, "diamond_rush_60");
        assert_eq!(summary.challenge_id, "diamond_rush_60");
        assert_eq!(summary.version, 1);
        assert!(summary.is_current);

        Ok(())
    }

    #[tokio::test]
    async fn read_ranked_current_returns_none_when_pointer_is_unknown() -> Result<()> {
        let pool = create_test_pool().await?;
        let state = build_test_state(
            pool,
            Some(RankedChallengePointer {
                challenge_id: "missing".to_string(),
                challenge_version: 7,
            }),
        );

        let response = read_ranked_current(&state).await.expect("read ranked current");
        assert!(response.current_challenge.is_none());

        Ok(())
    }
}
