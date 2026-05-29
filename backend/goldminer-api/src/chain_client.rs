//! chain_client 是 API 服务唯一允许直接触链的边界。
//!
//! handlers / services 通过 trait 读取 catalog、提交验证结果、轮询 receipt，而不直接依赖
//! 具体 RPC 客户端实现。这样生产环境可以用 Alloy 实现，测试可以替换成内存/fixture client，
//! 同时把“链上回执状态”和“本地 replay 真值”明确分开。

use alloy::{
    consensus::BlockHeader,
    network::EthereumWallet,
    primitives::{hex, Address, Bytes, B256},
    providers::{Provider, ProviderBuilder},
    rpc::types::{BlockTransactionsKind, Filter, Log},
    signers::local::PrivateKeySigner,
    sol,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use goldminer_core::{parse_level_id, ActiveSessionPermit, VerifiedCampaignRecord, VerifiedRunRecord};

use crate::{config::AppConfig, models::RelayDispatchOutcome};

sol! {
    #[sol(rpc)]
    contract GoldMinerLevelCatalogRpc {
        struct LevelConfig {
            bytes32 levelId;
            uint32 version;
            bytes32 contentHash;
            uint32 order;
            bool enabled;
            bytes32 challengeSeed;
        }

        function getLevel(bytes32 levelId, uint32 version) external view returns (LevelConfig memory);
    }

    #[sol(rpc)]
    contract GoldMinerScoreboardRpc {
        struct SessionPermit {
            address player;
            address delegate;
            bytes32 sessionId;
            bytes32 deploymentIdHash;
            uint64 issuedAt;
            uint64 deadline;
            uint32 nonce;
            uint16 maxRuns;
        }

        struct VerifiedRun {
            bytes32 runId;
            bytes32 challengeId;
            uint32 challengeVersion;
            uint32 diamondsCaught;
            uint32 lastDiamondAtMs;
            bytes32 evidenceHash;
        }

        struct VerifiedCampaign {
            bytes32 campaignId;
            uint8 reachedLevel;
            bool completed;
            uint32 finalScore;
            uint32 totalDurationMs;
            uint16 purchasedItemCount;
            bytes32 evidenceHash;
        }

        function currentRankedChallengeId() external view returns (bytes32);
        function currentRankedChallengeVersion() external view returns (uint32);

        function submitVerifiedBatch(
            SessionPermit calldata permit,
            bytes calldata playerPermitSig,
            VerifiedRun[] calldata runs,
            bytes32 batchId,
            bytes calldata verifierSig
        ) external;

        function submitVerifiedCampaign(
            SessionPermit calldata permit,
            bytes calldata playerPermitSig,
            VerifiedCampaign calldata campaign,
            bytes calldata verifierSig
        ) external;
    }
}

#[derive(Clone)]
pub struct ChainReceipt {
    pub success: bool,
}

#[derive(Clone)]
pub struct LevelCatalogEntry {
    pub content_hash: B256,
    pub order: u32,
    pub enabled: bool,
    pub challenge_seed: B256,
}

#[derive(Clone)]
pub struct RankedChallengePointer {
    pub challenge_id: String,
    pub challenge_version: u32,
}

#[async_trait]
pub trait ChainClient: Send + Sync {
    // ChainClient 抽象的是“链 I/O”，不是 replay 校验器。只要进入这一层，说明前面的
    // evidence 校验已经完成；链客户端只负责把已验证的摘要送上链并观察链上结果。
    async fn fetch_level_catalog_entry(
        &self,
        level_id: &str,
        level_version: u32,
    ) -> Result<LevelCatalogEntry>;
    async fn fetch_current_ranked_challenge(&self) -> Result<Option<RankedChallengePointer>>;
    async fn submit_verified_batch(
        &self,
        permit: &ActiveSessionPermit,
        player_permit_sig: &str,
        runs: &[VerifiedRunRecord],
        batch_id: B256,
        verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome>;
    async fn submit_verified_campaign(
        &self,
        permit: &ActiveSessionPermit,
        player_permit_sig: &str,
        campaign: &VerifiedCampaignRecord,
        verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome>;
    async fn get_transaction_receipt(&self, tx_hash: B256) -> Result<Option<ChainReceipt>>;
    async fn get_latest_block_number(&self) -> Result<u64>;
    async fn get_logs(&self, filter: Filter) -> Result<Vec<Log>>;
    async fn get_block_timestamp(&self, block_number: u64) -> Result<u64>;
}

pub struct AlloyChainClient {
    rpc_url: String,
    scoreboard_address: Address,
    level_catalog_address: Address,
    relayer_signer: PrivateKeySigner,
}

impl AlloyChainClient {
    pub fn new(config: &AppConfig, relayer_signer: PrivateKeySigner) -> Result<Self> {
        Ok(Self {
            rpc_url: config.rpc_url.clone(),
            scoreboard_address: config.scoreboard_address,
            level_catalog_address: config.level_catalog_address,
            relayer_signer,
        })
    }

    async fn fetch_level_config(
        &self,
        level_id: &str,
        level_version: u32,
    ) -> Result<GoldMinerLevelCatalogRpc::LevelConfig> {
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        let contract = GoldMinerLevelCatalogRpc::new(self.level_catalog_address, provider);
        let response = contract
            .getLevel(parse_level_id(level_id)?, level_version)
            .call()
            .await
            .with_context(|| format!("fetch level config for {level_id} v{level_version}"))?;
        Ok(response._0)
    }
}

#[async_trait]
impl ChainClient for AlloyChainClient {
    async fn fetch_level_catalog_entry(
        &self,
        level_id: &str,
        level_version: u32,
    ) -> Result<LevelCatalogEntry> {
        let config = self.fetch_level_config(level_id, level_version).await?;
        Ok(LevelCatalogEntry {
            content_hash: config.contentHash,
            order: config.order,
            enabled: config.enabled,
            challenge_seed: config.challengeSeed,
        })
    }

    async fn fetch_current_ranked_challenge(&self) -> Result<Option<RankedChallengePointer>> {
        // 链上 scoreboard 只保存当前 challenge 的 pointer；更完整的元数据仍由本地
        // manifest/catalog 提供。API 层不能把这个 pointer 直接当作展示文案真相源。
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        let contract = GoldMinerScoreboardRpc::new(self.scoreboard_address, provider);
        let challenge_id = contract
            .currentRankedChallengeId()
            .call()
            .await
            .context("fetch current ranked challenge id")?
            ._0;
        let challenge_version = contract
            .currentRankedChallengeVersion()
            .call()
            .await
            .context("fetch current ranked challenge version")?
            ._0;

        if challenge_id == B256::ZERO || challenge_version == 0 {
            return Ok(None);
        }

        Ok(Some(RankedChallengePointer {
            challenge_id: bytes32_to_string(challenge_id),
            challenge_version,
        }))
    }

    async fn submit_verified_batch(
        &self,
        permit: &ActiveSessionPermit,
        player_permit_sig: &str,
        runs: &[VerifiedRunRecord],
        batch_id: B256,
        verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome> {
        // 这一层返回的是 relay 派发结果：已提交、已确认或已回滚。
        // 它描述的是链上交易生命周期，不重新解释前面的 ranked replay 是否正确。
        let provider = ProviderBuilder::new()
            .wallet(EthereumWallet::from(self.relayer_signer.clone()))
            .on_http(self.rpc_url.parse()?);
        let contract = GoldMinerScoreboardRpc::new(self.scoreboard_address, provider);

        let permit_arg = GoldMinerScoreboardRpc::SessionPermit {
            player: permit.player,
            delegate: permit.delegate,
            sessionId: permit.session_id,
            deploymentIdHash: permit.deployment_id_hash,
            issuedAt: permit.issued_at,
            deadline: permit.deadline,
            nonce: permit.nonce,
            maxRuns: permit.max_runs,
        };
        let runs_arg = runs
            .iter()
            .map(|run| GoldMinerScoreboardRpc::VerifiedRun {
                runId: run.run_id,
                challengeId: run.challenge_id,
                challengeVersion: run.challenge_version,
                diamondsCaught: run.diamonds_caught,
                lastDiamondAtMs: run.last_diamond_at_ms,
                evidenceHash: run.evidence_hash,
            })
            .collect::<Vec<_>>();

        let pending = contract
            .submitVerifiedBatch(
                permit_arg,
                signature_bytes(player_permit_sig)?,
                runs_arg,
                batch_id,
                signature_bytes(verifier_sig)?,
            )
            .send()
            .await
            .context("send submitVerifiedBatch transaction")?;
        let tx_hash = *pending.tx_hash();

        let receipt = match pending.get_receipt().await {
            Ok(receipt) => receipt,
            Err(error) => {
                return Ok(RelayDispatchOutcome::Submitted(
                    tx_hash,
                    format!("waiting for relay receipt: {error}"),
                ))
            }
        };

        if receipt.status() {
            return Ok(RelayDispatchOutcome::Confirmed(tx_hash));
        }

        Ok(RelayDispatchOutcome::Reverted(tx_hash))
    }

    async fn submit_verified_campaign(
        &self,
        permit: &ActiveSessionPermit,
        player_permit_sig: &str,
        campaign: &VerifiedCampaignRecord,
        verifier_sig: &str,
    ) -> Result<RelayDispatchOutcome> {
        // campaign 路径同样只提交链下已验证过的摘要；这里不重复 replay，也不修正证据。
        let provider = ProviderBuilder::new()
            .wallet(EthereumWallet::from(self.relayer_signer.clone()))
            .on_http(self.rpc_url.parse()?);
        let contract = GoldMinerScoreboardRpc::new(self.scoreboard_address, provider);

        let permit_arg = GoldMinerScoreboardRpc::SessionPermit {
            player: permit.player,
            delegate: permit.delegate,
            sessionId: permit.session_id,
            deploymentIdHash: permit.deployment_id_hash,
            issuedAt: permit.issued_at,
            deadline: permit.deadline,
            nonce: permit.nonce,
            maxRuns: permit.max_runs,
        };
        let campaign_arg = GoldMinerScoreboardRpc::VerifiedCampaign {
            campaignId: campaign.campaign_id,
            reachedLevel: campaign.reached_level,
            completed: campaign.completed,
            finalScore: campaign.final_score,
            totalDurationMs: campaign.total_duration_ms,
            purchasedItemCount: campaign.purchased_item_count,
            evidenceHash: campaign.evidence_hash,
        };

        let pending = contract
            .submitVerifiedCampaign(
                permit_arg,
                signature_bytes(player_permit_sig)?,
                campaign_arg,
                signature_bytes(verifier_sig)?,
            )
            .send()
            .await
            .context("send submitVerifiedCampaign transaction")?;
        let tx_hash = *pending.tx_hash();

        let receipt = match pending.get_receipt().await {
            Ok(receipt) => receipt,
            Err(error) => {
                return Ok(RelayDispatchOutcome::Submitted(
                    tx_hash,
                    format!("waiting for relay receipt: {error}"),
                ))
            }
        };

        if receipt.status() {
            return Ok(RelayDispatchOutcome::Confirmed(tx_hash));
        }

        Ok(RelayDispatchOutcome::Reverted(tx_hash))
    }

    async fn get_transaction_receipt(&self, tx_hash: B256) -> Result<Option<ChainReceipt>> {
        // receipt/status 查询主要服务于状态轮询与运维诊断，不参与 gameplay 真值判定。
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        let receipt = provider
            .get_transaction_receipt(tx_hash)
            .await
            .with_context(|| format!("fetch receipt for {tx_hash:#x}"))?;
        Ok(receipt.map(|value| ChainReceipt {
            success: value.status(),
        }))
    }

    async fn get_latest_block_number(&self) -> Result<u64> {
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        provider
            .get_block_number()
            .await
            .context("fetch latest block number")
    }

    async fn get_logs(&self, filter: Filter) -> Result<Vec<Log>> {
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        provider
            .get_logs(&filter)
            .await
            .context("fetch indexer logs")
    }

    async fn get_block_timestamp(&self, block_number: u64) -> Result<u64> {
        let provider = ProviderBuilder::new().on_http(self.rpc_url.parse()?);
        let block = provider
            .get_block_by_number(block_number.into(), BlockTransactionsKind::Hashes)
            .await
            .with_context(|| format!("fetch block {block_number} for timestamp"))?
            .ok_or_else(|| anyhow::anyhow!("block {block_number} not found"))?;
        Ok(block.header.timestamp())
    }
}

fn bytes32_to_string(value: B256) -> String {
    let bytes = value.as_slice();
    let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

fn signature_bytes(signature_hex: &str) -> Result<Bytes> {
    Ok(Bytes::from(hex::decode(
        signature_hex.trim_start_matches("0x"),
    )?))
}
