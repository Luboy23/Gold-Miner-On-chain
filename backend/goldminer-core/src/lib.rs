//! goldminer-core 定义前后端共享的“可验证游戏真值”。
//!
//! 这个 crate 的职责不是渲染或传输，而是提供一套严格可重放的协议与校验规则：
//! - ranked/campaign evidence 数据结构
//! - deterministic runtime / replay
//! - EIP-712 摘要与验签辅助
//! - 前端上传 payload 的真值验证
//!
//! 阅读重点：
//! - `validate_evidence` 负责单局 ranked evidence 的 replay 校验
//! - `validate_campaign_evidence` 负责多关 campaign 证据与商店购买链路的整体校验
//! - 一旦这里拒绝 evidence，问题通常在“前端记录的终局真值”而不是 transport 层
mod ranked;
#[cfg(feature = "wasm")]
mod wasm;

use std::{collections::BTreeMap, str::FromStr};

use alloy::{
    primitives::{keccak256, Address, PrimitiveSignature, B256, U256},
    signers::{local::PrivateKeySigner, Signer},
    sol,
    sol_types::SolValue,
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

pub use ranked::{
    duration_ms_from_ticks, find_manifest_level, find_ranked_challenge, simulate_diamond_rush_run,
    simulate_ranked_run, simulate_ranked_run_with_loadout, ChallengeLevelSummary,
    RankedCatchAnchor, RankedChallengeCanonical, RankedChallengeEntitySnapshot,
    RankedChallengeHookState, RankedChallengeManifest, RankedChallengeManifestEntry,
    RankedChallengeRuntime, RankedChallengeRuntimeSnapshot, RankedChallengeSummary, RankedDisplaySize,
    RankedEntityConfig, RankedEntityFamily, RankedExplosiveEntityConfig, RankedLevelCanonical,
    RankedLevelDefinition, RankedLevelEntitySpawn, RankedManifest, RankedManifestLevel, RankedMoveDirection,
    RankedMovingEntityConfig, RankedPoint, RankedRandomBagConfig, RankedSimulationConstants,
    RankedSimulationLoadout, RankedSpawnPolicy, SimulationBuffs, DEFAULT_LOGIC_FPS, DEFAULT_SIMULATION_VERSION,
    RANKED_PROTOCOL_VERSION,
};
#[cfg(feature = "wasm")]
pub use wasm::WasmRankedRuntime;

const SESSION_PERMIT_NAME: &str = "GoldMinerSessionPermit";
const VERIFIED_BATCH_NAME: &str = "GoldMinerVerifiedBatch";
const SESSION_PERMIT_VERSION: &str = "1";
const VERIFIED_BATCH_VERSION: &str = "1";
const VERIFIED_CAMPAIGN_NAME: &str = "GoldMinerVerifiedCampaign";
const VERIFIED_CAMPAIGN_VERSION: &str = "1";

sol! {
    struct SessionPermitSol {
        address player;
        address delegate;
        bytes32 sessionId;
        bytes32 deploymentIdHash;
        uint64 issuedAt;
        uint64 deadline;
        uint32 nonce;
        uint16 maxRuns;
    }

    struct VerifiedRunSol {
        bytes32 runId;
        bytes32 challengeId;
        uint32 challengeVersion;
        uint32 diamondsCaught;
        uint32 lastDiamondAtMs;
        bytes32 evidenceHash;
    }

    struct VerifierBatchSol {
        address player;
        address delegate;
        bytes32 sessionId;
        uint32 nonce;
        bytes32 batchId;
        bytes32 runsHash;
    }

    struct VerifiedCampaignSol {
        bytes32 campaignId;
        uint8 reachedLevel;
        bool completed;
        uint32 finalScore;
        uint32 totalDurationMs;
        uint16 purchasedItemCount;
        bytes32 evidenceHash;
    }

    struct VerifierCampaignSol {
        address player;
        address delegate;
        bytes32 sessionId;
        uint32 nonce;
        bytes32 campaignHash;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RankedActionKind {
    FireHook,
    UseDynamite,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRunAction {
    pub kind: RankedActionKind,
    pub tick: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRunSummary {
    pub score: u32,
    pub dynamite_used: u8,
    pub caught_count: u16,
    pub cleared: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRunSummaryV3 {
    pub diamonds_caught: u32,
    pub last_diamond_tick: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRunEvidenceV2 {
    pub protocol_version: u8,
    pub simulation_version: u16,
    pub session_id: B256,
    pub season_id: u32,
    pub level_id: String,
    pub level_version: u32,
    pub level_content_hash: B256,
    pub challenge_seed: B256,
    pub client_build_hash: B256,
    pub logic_fps: u16,
    pub finished_tick: u32,
    pub actions: Vec<RankedRunAction>,
    pub summary: RankedRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRunEvidenceV3 {
    pub protocol_version: u8,
    pub simulation_version: u16,
    pub session_id: B256,
    pub challenge_id: String,
    pub challenge_version: u32,
    pub challenge_content_hash: B256,
    pub challenge_seed: B256,
    pub client_build_hash: B256,
    pub logic_fps: u16,
    pub finished_tick: u32,
    pub actions: Vec<RankedRunAction>,
    pub summary: RankedRunSummaryV3,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignLevelEvidence {
    pub level_group: u8,
    pub level_id: String,
    pub level_version: u32,
    pub level_content_hash: B256,
    pub challenge_seed: B256,
    pub goal: u32,
    pub logic_fps: u16,
    pub finished_tick: u32,
    pub actions: Vec<RankedRunAction>,
    pub summary: RankedRunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignShopPurchaseEvidence {
    pub shop_level_group: u8,
    pub item_id: String,
    pub price: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignEvidenceV1 {
    pub protocol_version: u8,
    pub simulation_version: u16,
    pub campaign_id: B256,
    pub session_id: B256,
    pub season_id: u32,
    pub campaign_seed: B256,
    pub client_build_hash: B256,
    pub levels: Vec<CampaignLevelEvidence>,
    pub purchases: Vec<CampaignShopPurchaseEvidence>,
    pub final_score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignEvidenceV2 {
    pub protocol_version: u8,
    pub simulation_version: u16,
    pub campaign_id: B256,
    pub session_id: B256,
    pub campaign_seed: B256,
    pub client_build_hash: B256,
    pub levels: Vec<CampaignLevelEvidence>,
    pub purchases: Vec<CampaignShopPurchaseEvidence>,
    pub final_score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSessionPermit {
    pub player: Address,
    pub delegate: Address,
    pub session_id: B256,
    pub deployment_id_hash: B256,
    pub issued_at: u64,
    pub deadline: u64,
    pub nonce: u32,
    pub max_runs: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedRunRecord {
    pub run_id: B256,
    pub challenge_id: B256,
    pub challenge_version: u32,
    pub diamonds_caught: u32,
    pub last_diamond_at_ms: u32,
    pub evidence_hash: B256,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedCampaignRecord {
    pub campaign_id: B256,
    pub reached_level: u8,
    pub completed: bool,
    pub final_score: u32,
    pub total_duration_ms: u32,
    pub purchased_item_count: u16,
    pub evidence_hash: B256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedDataField {
    pub name: &'static str,
    #[serde(rename = "type")]
    pub type_name: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedDataDomain {
    pub name: &'static str,
    pub version: &'static str,
    pub chain_id: u64,
    pub verifying_contract: Address,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPermitTypedData {
    pub domain: TypedDataDomain,
    pub primary_type: &'static str,
    pub types: BTreeMap<&'static str, Vec<TypedDataField>>,
    pub message: ActiveSessionPermit,
}

pub fn deployment_id_hash(deployment_id: &str) -> B256 {
    keccak256(deployment_id.as_bytes())
}

pub fn build_session_id(
    player: Address,
    nonce: u32,
    issued_at_ms: u64,
    deployment_id: &str,
) -> B256 {
    keccak256(
        (
            player,
            nonce,
            issued_at_ms,
            deployment_id_hash(deployment_id),
        )
            .abi_encode(),
    )
}

pub fn build_campaign_seed(campaign_id: B256, player: Address, deployment_id: &str) -> B256 {
    keccak256(
        (
            campaign_id,
            player,
            deployment_id_hash(deployment_id),
            keccak256(b"campaign-v1"),
        )
            .abi_encode(),
    )
}

pub fn build_run_id(
    session_id: B256,
    level_id: B256,
    level_version: u32,
    evidence_hash: B256,
) -> B256 {
    keccak256((session_id, level_id, level_version, evidence_hash).abi_encode())
}

pub fn build_batch_id(session_id: B256, nonce: u32, first_run_id: B256, run_count: usize) -> B256 {
    keccak256((session_id, nonce, first_run_id, U256::from(run_count)).abi_encode())
}

pub fn parse_level_id(level_id: &str) -> Result<B256> {
    if level_id.trim().is_empty() {
        bail!("levelId must not be empty");
    }
    let bytes = level_id.as_bytes();
    if bytes.len() > 32 {
        bail!("levelId must fit into bytes32");
    }

    let mut padded = [0u8; 32];
    padded[..bytes.len()].copy_from_slice(bytes);
    Ok(B256::from(padded))
}

pub fn build_session_permit_typed_data(
    permit: &ActiveSessionPermit,
    chain_id: u64,
    verifying_contract: Address,
) -> SessionPermitTypedData {
    let mut types = BTreeMap::new();
    types.insert(
        "EIP712Domain",
        vec![
            TypedDataField {
                name: "name",
                type_name: "string",
            },
            TypedDataField {
                name: "version",
                type_name: "string",
            },
            TypedDataField {
                name: "chainId",
                type_name: "uint256",
            },
            TypedDataField {
                name: "verifyingContract",
                type_name: "address",
            },
        ],
    );
    types.insert(
        "SessionPermit",
        vec![
            TypedDataField {
                name: "player",
                type_name: "address",
            },
            TypedDataField {
                name: "delegate",
                type_name: "address",
            },
            TypedDataField {
                name: "sessionId",
                type_name: "bytes32",
            },
            TypedDataField {
                name: "deploymentIdHash",
                type_name: "bytes32",
            },
            TypedDataField {
                name: "issuedAt",
                type_name: "uint64",
            },
            TypedDataField {
                name: "deadline",
                type_name: "uint64",
            },
            TypedDataField {
                name: "nonce",
                type_name: "uint32",
            },
            TypedDataField {
                name: "maxRuns",
                type_name: "uint16",
            },
        ],
    );

    SessionPermitTypedData {
        domain: TypedDataDomain {
            name: SESSION_PERMIT_NAME,
            version: SESSION_PERMIT_VERSION,
            chain_id,
            verifying_contract,
        },
        primary_type: "SessionPermit",
        types,
        message: permit.clone(),
    }
}

pub fn build_evidence_hash(evidence: &RankedRunEvidenceV3) -> Result<B256> {
    let bytes = serde_json::to_vec(evidence).context("serialize ranked evidence")?;
    Ok(keccak256(bytes))
}

pub fn build_campaign_evidence_hash(evidence: &CampaignEvidenceV2) -> Result<B256> {
    let bytes = serde_json::to_vec(evidence).context("serialize campaign evidence")?;
    Ok(keccak256(bytes))
}

pub fn validate_evidence(
    evidence: &RankedRunEvidenceV3,
    expected_session_id: B256,
    spec: &RankedChallengeManifestEntry,
) -> Result<VerifiedRunRecord> {
    // ranked evidence 的校验模型很直接：
    // 先验证会话与构建哈希，再用 deterministic replay 重放整局，
    // 最后逐项比对 summary，不接受“近似正确”的结果。
    if evidence.session_id != expected_session_id {
        bail!("sessionId does not match active session");
    }
    if evidence.challenge_version == 0 {
        bail!("challengeVersion must be positive");
    }
    if evidence.client_build_hash == B256::ZERO {
        bail!("clientBuildHash must not be zero");
    }

    let outcome = simulate_diamond_rush_run(evidence, spec)?;

    if evidence.summary.diamonds_caught != outcome.diamonds_caught {
        bail!("summary diamondsCaught does not match server replay");
    }
    if evidence.summary.last_diamond_tick != outcome.last_diamond_tick {
        bail!("summary lastDiamondTick does not match server replay");
    }

    let evidence_hash = build_evidence_hash(evidence)?;
    let challenge_id = parse_level_id(&evidence.challenge_id)?;

    Ok(VerifiedRunRecord {
        run_id: build_run_id(
            evidence.session_id,
            challenge_id,
            evidence.challenge_version,
            evidence_hash,
        ),
        challenge_id,
        challenge_version: evidence.challenge_version,
        diamonds_caught: outcome.diamonds_caught,
        last_diamond_at_ms: duration_ms_from_ticks(
            outcome.last_diamond_tick,
            spec.logic_fps,
        ),
        evidence_hash,
    })
}

pub fn validate_campaign_evidence(
    evidence: &CampaignEvidenceV2,
    expected_campaign_id: B256,
    expected_session_id: B256,
    expected_campaign_seed: B256,
    manifest: &RankedManifest,
) -> Result<VerifiedCampaignRecord> {
    // campaign 的验证比 ranked 更严格，因为它不仅要逐关 replay，
    // 还要校验关卡顺序、商店购买、跨关 carry score、炸药库存和最终总分。
    // 当前端仍从 mutable run 现算 evidence 时，这里就是最先暴露漂移的地方。
    if evidence.protocol_version != RANKED_PROTOCOL_VERSION {
        bail!("protocolVersion is not supported");
    }
    if evidence.campaign_id != expected_campaign_id {
        bail!("campaignId does not match active campaign");
    }
    if evidence.session_id != expected_session_id {
        bail!("sessionId does not match active campaign");
    }
    if evidence.campaign_seed != expected_campaign_seed {
        bail!("campaignSeed does not match active campaign");
    }
    if evidence.client_build_hash == B256::ZERO {
        bail!("clientBuildHash must not be zero");
    }
    if evidence.levels.is_empty() {
        bail!("campaign evidence must include at least one level");
    }
    if evidence.levels.len() > 10 {
        bail!("campaign evidence exceeds final level");
    }

    let mut carry_score = 0u32;
    let mut dynamite_count = 0u8;
    let mut buffs = SimulationBuffs::default();
    let mut total_duration_ms = 0u32;
    let mut reached_level = 0u8;
    let mut completed = false;
    let mut purchase_index = 0usize;

    for (index, level) in evidence.levels.iter().enumerate() {
        let expected_group = u8::try_from(index + 1).unwrap_or(0);
        if level.level_group != expected_group {
            bail!("campaign levels must be ordered from L1 to L10");
        }
        let expected_level_id = format!("L{expected_group}");
        if level.level_id != expected_level_id {
            bail!("campaign levelId does not match its group");
        }
        if level.goal == 0 {
            bail!("campaign level goal must be positive");
        }

        let spec = find_manifest_level(manifest, &level.level_id, level.level_version)
            .ok_or_else(|| anyhow::anyhow!("ranked manifest entry not found for campaign level"))?;
        if spec.content_hash != level.level_content_hash {
            bail!("campaign levelContentHash does not match manifest");
        }
        if spec.challenge_seed != level.challenge_seed {
            bail!("campaign challengeSeed does not match manifest");
        }
        if spec.goal != level.goal || spec.canonical.goal != level.goal {
            bail!("campaign goal does not match manifest");
        }
        if spec.logic_fps != level.logic_fps {
            bail!("campaign logicFps does not match manifest");
        }

        let ranked_evidence = RankedRunEvidenceV2 {
            protocol_version: evidence.protocol_version,
            simulation_version: evidence.simulation_version,
            session_id: evidence.session_id,
            season_id: 1,
            level_id: level.level_id.clone(),
            level_version: level.level_version,
            level_content_hash: level.level_content_hash,
            challenge_seed: level.challenge_seed,
            client_build_hash: evidence.client_build_hash,
            logic_fps: level.logic_fps,
            finished_tick: level.finished_tick,
            actions: level.actions.clone(),
            summary: level.summary.clone(),
        };
        let outcome = simulate_ranked_run_with_loadout(
            &ranked_evidence,
            spec,
            RankedSimulationLoadout {
                dynamite_count,
                buffs,
            },
        )?;
        let cleared = level.finished_tick == spec.time_limit_ticks
            && carry_score.saturating_add(outcome.score) >= spec.goal;

        // 约束：campaign summary 不能直接信任前端上传值，
        // 必须全部和服务器 replay 结果逐项一致后才算合法。
        if level.summary.score != outcome.score {
            bail!("campaign summary score does not match server replay");
        }
        if level.summary.dynamite_used != outcome.dynamite_used {
            bail!("campaign summary dynamiteUsed does not match server replay");
        }
        if level.summary.caught_count != outcome.caught_count {
            bail!("campaign summary caughtCount does not match server replay");
        }
        if level.summary.cleared != cleared {
            bail!("campaign summary cleared does not match server replay");
        }

        carry_score = carry_score.saturating_add(outcome.score);
        dynamite_count = outcome.dynamite_count;
        buffs = SimulationBuffs::default();
        total_duration_ms = total_duration_ms.saturating_add(outcome.duration_ms);
        reached_level = expected_group;

        if !cleared {
            if index + 1 != evidence.levels.len() {
                bail!("campaign evidence cannot continue after a failed level");
            }
            break;
        }

        if expected_group == 10 {
            completed = true;
            break;
        }

        while purchase_index < evidence.purchases.len()
            && evidence.purchases[purchase_index].shop_level_group == expected_group + 1
        {
            let purchase = &evidence.purchases[purchase_index];
            // 商店购买只允许出现在“上一关 cleared、下一关解锁后”的窗口里。
            // 这里一边验证 deterministic offers，一边把 carry score/buffs 推进到下一关。
            let offer = validate_shop_purchase(evidence.campaign_seed, carry_score, purchase)?;
            carry_score = carry_score.saturating_sub(offer.price);
            if offer.item_id == "dynamite" {
                dynamite_count = dynamite_count.saturating_add(1).min(12);
            } else {
                apply_shop_buff(&mut buffs, &offer.item_id)?;
            }
            purchase_index += 1;
        }
    }

    if purchase_index != evidence.purchases.len() {
        bail!("campaign contains purchases outside an unlocked shop");
    }
    if evidence.final_score != carry_score {
        bail!("campaign finalScore does not match replay");
    }

    let evidence_hash = build_campaign_evidence_hash(evidence)?;
    Ok(VerifiedCampaignRecord {
        campaign_id: evidence.campaign_id,
        reached_level,
        completed,
        final_score: carry_score,
        total_duration_ms,
        purchased_item_count: u16::try_from(evidence.purchases.len())
            .unwrap_or(u16::MAX),
        evidence_hash,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShopOfferReplay {
    item_id: String,
    price: u32,
}

fn validate_shop_purchase(
    campaign_seed: B256,
    current_score: u32,
    purchase: &CampaignShopPurchaseEvidence,
) -> Result<ShopOfferReplay> {
    if purchase.shop_level_group == 0 || purchase.shop_level_group > 10 {
        bail!("campaign shopLevelGroup is outside L1-L10");
    }

    let offers = build_shop_offers(campaign_seed, purchase.shop_level_group);
    let offer = offers
        .into_iter()
        .find(|offer| offer.item_id == purchase.item_id)
        .ok_or_else(|| anyhow::anyhow!("campaign purchase is not in deterministic shop offers"))?;

    if offer.price != purchase.price {
        bail!("campaign purchase price does not match deterministic shop offer");
    }
    if current_score < offer.price {
        bail!("campaign purchase exceeds available score");
    }

    Ok(offer)
}

fn apply_shop_buff(buffs: &mut SimulationBuffs, item_id: &str) -> Result<()> {
    match item_id {
        "strengthDrink" => buffs.strength_drink = true,
        "luckyClover" => buffs.lucky_clover = true,
        "rockCollectorsBook" => buffs.rock_collectors_book = true,
        "gemPolish" => buffs.gem_polish = true,
        _ => bail!("unknown campaign shop item"),
    }
    Ok(())
}

fn build_shop_offers(campaign_seed: B256, shop_level_group: u8) -> Vec<ShopOfferReplay> {
    let mut rng = CampaignRng::new(&format!("{campaign_seed:#x}:shop:{shop_level_group}"));
    let item_ids = [
        "dynamite",
        "strengthDrink",
        "luckyClover",
        "rockCollectorsBook",
        "gemPolish",
    ];
    let mut offers = Vec::new();

    for item_id in item_ids {
        if rng.next_int(1, 3) >= 2 {
            offers.push(ShopOfferReplay {
                item_id: item_id.to_string(),
                price: shop_price(item_id, shop_level_group, &mut rng),
            });
        }
    }

    if offers.is_empty() {
        offers.push(ShopOfferReplay {
            item_id: "dynamite".to_string(),
            price: shop_price("dynamite", shop_level_group, &mut rng),
        });
    }

    offers
}

fn shop_price(item_id: &str, shop_level_group: u8, rng: &mut CampaignRng) -> u32 {
    let group = u32::from(shop_level_group);
    match item_id {
        "dynamite" => rng.next_int(1, 300) + group * 2,
        "strengthDrink" => rng.next_int(100, 399),
        "luckyClover" => rng.next_int(1, group * 50) + group * 2,
        "rockCollectorsBook" => rng.next_int(1, 150),
        _ => rng.next_int(201, 200 + group * 100),
    }
}

#[derive(Debug, Clone)]
struct CampaignRng {
    state: u32,
}

impl CampaignRng {
    fn new(seed: &str) -> Self {
        Self {
            state: xmur3_once(seed),
        }
    }

    fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut result = (self.state ^ (self.state >> 15)).wrapping_mul(self.state | 1);
        result ^= result.wrapping_add((result ^ (result >> 7)).wrapping_mul(result | 61));
        let value = result ^ (result >> 14);
        f64::from(value) / 4_294_967_296.0
    }

    fn next_int(&mut self, min_inclusive: u32, max_inclusive: u32) -> u32 {
        let range = max_inclusive - min_inclusive + 1;
        (self.next() * f64::from(range)).floor() as u32 + min_inclusive
    }
}

fn xmur3_once(seed: &str) -> u32 {
    let mut hash = 1_779_033_703u32 ^ u32::try_from(seed.len()).unwrap_or(0);

    for value in seed.bytes() {
        hash = (hash ^ u32::from(value)).wrapping_mul(3_432_918_353);
        hash = hash.rotate_left(13);
    }

    hash = (hash ^ (hash >> 16)).wrapping_mul(2_246_822_507);
    hash = (hash ^ (hash >> 13)).wrapping_mul(3_266_489_909);
    hash ^ (hash >> 16)
}

pub fn session_permit_digest(
    permit: &ActiveSessionPermit,
    chain_id: u64,
    verifying_contract: Address,
) -> B256 {
    hash_typed_data(
        domain_separator(
            SESSION_PERMIT_NAME,
            SESSION_PERMIT_VERSION,
            chain_id,
            verifying_contract,
        ),
        hash_session_permit(permit),
    )
}

pub fn verifier_batch_digest(
    permit: &ActiveSessionPermit,
    batch_id: B256,
    runs: &[VerifiedRunRecord],
    chain_id: u64,
    verifying_contract: Address,
) -> B256 {
    let runs_hash = hash_verified_runs(runs);
    hash_typed_data(
        domain_separator(
            VERIFIED_BATCH_NAME,
            VERIFIED_BATCH_VERSION,
            chain_id,
            verifying_contract,
        ),
        hash_verifier_batch(permit, batch_id, runs_hash),
    )
}

pub fn verifier_campaign_digest(
    permit: &ActiveSessionPermit,
    campaign: &VerifiedCampaignRecord,
    chain_id: u64,
    verifying_contract: Address,
) -> B256 {
    let campaign_hash = hash_verified_campaign(campaign);
    hash_typed_data(
        domain_separator(
            VERIFIED_CAMPAIGN_NAME,
            VERIFIED_CAMPAIGN_VERSION,
            chain_id,
            verifying_contract,
        ),
        hash_verifier_campaign(permit, campaign_hash),
    )
}

pub fn hash_verified_runs(runs: &[VerifiedRunRecord]) -> B256 {
    let mut packed = Vec::with_capacity(runs.len() * 32);
    for run in runs {
        packed.extend_from_slice(hash_verified_run(run).as_slice());
    }
    keccak256(packed)
}

pub fn verify_signature(digest: B256, signature_hex: &str, expected_signer: Address) -> Result<()> {
    let normalized = signature_hex.trim_start_matches("0x");
    let signature = PrimitiveSignature::from_str(normalized).context("parse signature hex")?;
    let recovered = signature
        .recover_address_from_prehash(&digest)
        .context("recover signature signer")?;
    if recovered != expected_signer {
        bail!("signature signer mismatch");
    }
    Ok(())
}

pub async fn sign_batch_digest(signer: &PrivateKeySigner, digest: B256) -> Result<String> {
    let signature = signer
        .sign_hash(&digest)
        .await
        .context("sign batch digest")?;
    Ok(format!("0x{signature}"))
}

pub async fn sign_campaign_digest(signer: &PrivateKeySigner, digest: B256) -> Result<String> {
    let signature = signer
        .sign_hash(&digest)
        .await
        .context("sign campaign digest")?;
    Ok(format!("0x{signature}"))
}

fn hash_session_permit(permit: &ActiveSessionPermit) -> B256 {
    keccak256(
        (
            session_permit_typehash(),
            SessionPermitSol {
                player: permit.player,
                delegate: permit.delegate,
                sessionId: permit.session_id,
                deploymentIdHash: permit.deployment_id_hash,
                issuedAt: permit.issued_at,
                deadline: permit.deadline,
                nonce: permit.nonce,
                maxRuns: permit.max_runs,
            },
        )
            .abi_encode(),
    )
}

fn hash_verified_run(run: &VerifiedRunRecord) -> B256 {
    keccak256(
        (
            verified_run_typehash(),
            VerifiedRunSol {
                runId: run.run_id,
                challengeId: run.challenge_id,
                challengeVersion: run.challenge_version,
                diamondsCaught: run.diamonds_caught,
                lastDiamondAtMs: run.last_diamond_at_ms,
                evidenceHash: run.evidence_hash,
            },
        )
            .abi_encode(),
    )
}

fn hash_verified_campaign(campaign: &VerifiedCampaignRecord) -> B256 {
    keccak256(
        (
            verified_campaign_typehash(),
            VerifiedCampaignSol {
                campaignId: campaign.campaign_id,
                reachedLevel: campaign.reached_level,
                completed: campaign.completed,
                finalScore: campaign.final_score,
                totalDurationMs: campaign.total_duration_ms,
                purchasedItemCount: campaign.purchased_item_count,
                evidenceHash: campaign.evidence_hash,
            },
        )
            .abi_encode(),
    )
}

fn hash_verifier_batch(permit: &ActiveSessionPermit, batch_id: B256, runs_hash: B256) -> B256 {
    keccak256(
        (
            verified_batch_typehash(),
            VerifierBatchSol {
                player: permit.player,
                delegate: permit.delegate,
                sessionId: permit.session_id,
                nonce: permit.nonce,
                batchId: batch_id,
                runsHash: runs_hash,
            },
        )
            .abi_encode(),
    )
}

fn hash_verifier_campaign(permit: &ActiveSessionPermit, campaign_hash: B256) -> B256 {
    keccak256(
        (
            verifier_campaign_typehash(),
            VerifierCampaignSol {
                player: permit.player,
                delegate: permit.delegate,
                sessionId: permit.session_id,
                nonce: permit.nonce,
                campaignHash: campaign_hash,
            },
        )
            .abi_encode(),
    )
}

fn hash_typed_data(domain_separator: B256, struct_hash: B256) -> B256 {
    let mut bytes = Vec::with_capacity(66);
    bytes.extend_from_slice(&[0x19, 0x01]);
    bytes.extend_from_slice(domain_separator.as_slice());
    bytes.extend_from_slice(struct_hash.as_slice());
    keccak256(bytes)
}

fn domain_separator(name: &str, version: &str, chain_id: u64, verifying_contract: Address) -> B256 {
    keccak256(
        (
            eip712_domain_typehash(),
            keccak256(name.as_bytes()),
            keccak256(version.as_bytes()),
            U256::from(chain_id),
            verifying_contract,
        )
            .abi_encode(),
    )
}

fn eip712_domain_typehash() -> B256 {
    keccak256(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
}

fn session_permit_typehash() -> B256 {
    keccak256(
        b"SessionPermit(address player,address delegate,bytes32 sessionId,bytes32 deploymentIdHash,uint64 issuedAt,uint64 deadline,uint32 nonce,uint16 maxRuns)",
    )
}

fn verified_run_typehash() -> B256 {
    keccak256(
        b"VerifiedRun(bytes32 runId,bytes32 challengeId,uint32 challengeVersion,uint32 diamondsCaught,uint32 lastDiamondAtMs,bytes32 evidenceHash)",
    )
}

fn verified_batch_typehash() -> B256 {
    keccak256(
        b"VerifierBatch(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 batchId,bytes32 runsHash)",
    )
}

fn verified_campaign_typehash() -> B256 {
    keccak256(
        b"VerifiedCampaign(bytes32 campaignId,uint8 reachedLevel,bool completed,uint32 finalScore,uint32 totalDurationMs,uint16 purchasedItemCount,bytes32 evidenceHash)",
    )
}

fn verifier_campaign_typehash() -> B256 {
    keccak256(
        b"VerifierCampaign(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 campaignHash)",
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::ranked::{
        RankedCatchAnchor, RankedChallengeCanonical, RankedChallengeManifestEntry,
        RankedDisplaySize, RankedEntityConfig, RankedEntityFamily, RankedPoint,
        RankedSimulationConstants, RankedSpawnPolicy,
    };

    fn sample_ranked_challenge_spec() -> RankedChallengeManifestEntry {
        let mut entity_configs = BTreeMap::new();
        entity_configs.insert(
            "Diamond".to_string(),
            RankedEntityConfig {
                id: "Diamond".to_string(),
                family: RankedEntityFamily::Static,
                mass: 1.5,
                base_bonus: 600,
                bonus_tier: "high".to_string(),
                collision_radius: 6.0,
                catch_anchor: RankedCatchAnchor {
                    x_ratio: 0.5,
                    y_ratio: 1.0 / 3.0,
                },
                display_size: RankedDisplaySize {
                    width: 10.0,
                    height: 8.0,
                },
                random_bag: None,
                moving: None,
                explosive: None,
            },
        );

        RankedChallengeManifestEntry {
            challenge_id: "diamond_rush_60".to_string(),
            version: 1,
            order: 1,
            content_hash: keccak256(b"diamond-rush-content"),
            challenge_seed: keccak256(b"diamond-rush-seed"),
            simulation_version: DEFAULT_SIMULATION_VERSION,
            logic_fps: DEFAULT_LOGIC_FPS,
            time_limit_ticks: 3_600,
            enabled: true,
            is_current: true,
            canonical: RankedChallengeCanonical {
                challenge_id: "diamond_rush_60".to_string(),
                challenge_version: 1,
                simulation_version: DEFAULT_SIMULATION_VERSION,
                logic_fps: DEFAULT_LOGIC_FPS,
                time_limit_ticks: 3_600,
                board_kind: "ranked".to_string(),
                theme: "LevelD".to_string(),
                constants: RankedSimulationConstants {
                    hook_origin: RankedPoint { x: 158.0, y: 30.0 },
                    hook_collision_offset: 13.0,
                    hook_min_angle: -75.0,
                    hook_max_angle: 75.0,
                    hook_rotate_speed: 65.0,
                    hook_max_length: 230.0,
                    hook_grab_speed: 100.0,
                    hook_empty_return_speed: 180.0,
                    hook_collision_radius: 6.0,
                    hook_resolve_duration_sec: 1.0,
                    question_bag_extra_dynamite_chance: 0.2,
                    max_dynamite_count: 12,
                    default_strength_multiplier: 1.0,
                    max_strength_multiplier: 6.0,
                    moving_entity_idle_duration_sec: 1.0,
                    moving_entity_pixels_per_second: 60.0,
                    moving_entity_turn_threshold: 1.0,
                },
                entity_configs,
                spawn_points: vec![RankedPoint { x: 56.0, y: 72.0 }],
                spawn_policy: RankedSpawnPolicy {
                    cycle_size: 1,
                    shuffle_algorithm: "seeded-cycle-no-repeat".to_string(),
                    entity_type: "Diamond".to_string(),
                    allow_items: false,
                    allow_dynamite_action: false,
                },
            },
        }
    }

    fn sample_evidence(
        spec: &RankedManifestLevel,
        actions: Vec<RankedRunAction>,
        summary: RankedRunSummary,
    ) -> RankedRunEvidenceV2 {
        RankedRunEvidenceV2 {
            protocol_version: RANKED_PROTOCOL_VERSION,
            simulation_version: spec.simulation_version,
            session_id: keccak256(b"session"),
            season_id: 1,
            level_id: spec.level_id.clone(),
            level_version: spec.version,
            level_content_hash: spec.content_hash,
            challenge_seed: spec.challenge_seed,
            client_build_hash: keccak256(b"build"),
            logic_fps: spec.logic_fps,
            finished_tick: spec.time_limit_ticks,
            actions,
            summary,
        }
    }

    fn sample_ranked_challenge_evidence(
        spec: &RankedChallengeManifestEntry,
        actions: Vec<RankedRunAction>,
        summary: RankedRunSummaryV3,
    ) -> RankedRunEvidenceV3 {
        RankedRunEvidenceV3 {
            protocol_version: RANKED_PROTOCOL_VERSION,
            simulation_version: spec.simulation_version,
            session_id: keccak256(b"ranked-session"),
            challenge_id: spec.challenge_id.clone(),
            challenge_version: spec.version,
            challenge_content_hash: spec.content_hash,
            challenge_seed: spec.challenge_seed,
            client_build_hash: keccak256(b"ranked-build"),
            logic_fps: spec.logic_fps,
            finished_tick: spec.time_limit_ticks,
            actions,
            summary,
        }
    }

    #[test]
    fn validate_evidence_accepts_replay_matched_ranked_run() {
        let spec = sample_ranked_challenge_spec();
        let mut evidence = sample_ranked_challenge_evidence(
            &spec,
            vec![RankedRunAction {
                kind: RankedActionKind::FireHook,
                tick: 47,
            }],
            RankedRunSummaryV3 {
                diamonds_caught: 0,
                last_diamond_tick: 0,
            },
        );

        let outcome = simulate_diamond_rush_run(&evidence, &spec).expect("simulate evidence");
        evidence.summary = RankedRunSummaryV3 {
            diamonds_caught: outcome.diamonds_caught,
            last_diamond_tick: outcome.last_diamond_tick,
        };

        let record =
            validate_evidence(&evidence, evidence.session_id, &spec).expect("valid evidence");

        assert_eq!(record.diamonds_caught, outcome.diamonds_caught);
        assert_eq!(
            record.last_diamond_at_ms,
            duration_ms_from_ticks(outcome.last_diamond_tick, spec.logic_fps),
        );
        assert_ne!(record.run_id, B256::ZERO);
        assert_ne!(record.evidence_hash, B256::ZERO);
    }

    #[test]
    fn validate_evidence_rejects_summary_mismatch() {
        let spec = sample_ranked_challenge_spec();
        let evidence = sample_ranked_challenge_evidence(
            &spec,
            vec![RankedRunAction {
                kind: RankedActionKind::FireHook,
                tick: 47,
            }],
            RankedRunSummaryV3 {
                diamonds_caught: 999,
                last_diamond_tick: 0,
            },
        );

        let error = validate_evidence(&evidence, evidence.session_id, &spec)
            .expect_err("expected mismatch");
        assert!(error
            .to_string()
            .contains("summary diamondsCaught does not match server replay"));
    }

    #[test]
    fn hash_verified_runs_matches_solidity_encode_packed() {
        let runs = vec![
            VerifiedRunRecord {
                run_id: keccak256(b"run-1"),
                challenge_id: parse_level_id("diamond_rush_60").expect("challenge id"),
                challenge_version: 1,
                diamonds_caught: 12,
                last_diamond_at_ms: 15_000,
                evidence_hash: keccak256(b"evidence-1"),
            },
            VerifiedRunRecord {
                run_id: keccak256(b"run-2"),
                challenge_id: parse_level_id("diamond_rush_60").expect("challenge id"),
                challenge_version: 2,
                diamonds_caught: 10,
                last_diamond_at_ms: 16_500,
                evidence_hash: keccak256(b"evidence-2"),
            },
        ];

        let struct_hashes = runs.iter().map(hash_verified_run).collect::<Vec<_>>();
        let mut packed = Vec::with_capacity(struct_hashes.len() * 32);
        for struct_hash in &struct_hashes {
            packed.extend_from_slice(struct_hash.as_slice());
        }

        assert_eq!(hash_verified_runs(&runs), keccak256(packed));
        assert_ne!(
            hash_verified_runs(&runs),
            keccak256(struct_hashes.abi_encode())
        );
    }

    #[test]
    fn build_session_permit_typed_data_includes_eip712_domain() {
        let permit = ActiveSessionPermit {
            player: Address::repeat_byte(0x11),
            delegate: Address::repeat_byte(0x22),
            session_id: keccak256(b"session"),
            deployment_id_hash: keccak256(b"deployment"),
            issued_at: 1,
            deadline: 2,
            nonce: 3,
            max_runs: 4,
        };
        let verifying_contract = Address::repeat_byte(0x33);
        let typed_data = build_session_permit_typed_data(&permit, 31337, verifying_contract);

        assert_eq!(typed_data.primary_type, "SessionPermit");
        assert_eq!(typed_data.domain.chain_id, 31337);
        assert_eq!(typed_data.domain.verifying_contract, verifying_contract);

        let domain_fields = typed_data
            .types
            .get("EIP712Domain")
            .expect("expected EIP712Domain fields");
        assert_eq!(domain_fields.len(), 4);
        assert_eq!(domain_fields[0].name, "name");
        assert_eq!(domain_fields[1].name, "version");
        assert_eq!(domain_fields[2].name, "chainId");
        assert_eq!(domain_fields[3].name, "verifyingContract");

        let permit_fields = typed_data
            .types
            .get("SessionPermit")
            .expect("expected SessionPermit fields");
        assert_eq!(permit_fields.len(), 8);
    }

    fn load_campaign_ranked_fixture() -> RankedManifestLevel {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../frontend/src/test-fixtures/ranked-golden-question-bag.json");
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read fixture {}: {error}", path.display()));
        let json: serde_json::Value = serde_json::from_str(&source)
            .unwrap_or_else(|error| panic!("parse fixture {}: {error}", path.display()));
        serde_json::from_value(json["spec"].clone())
            .unwrap_or_else(|error| panic!("decode spec {}: {error}", path.display()))
    }

    fn sample_campaign_evidence(spec: &RankedManifestLevel) -> CampaignEvidenceV2 {
        let ranked_evidence = sample_evidence(
            spec,
            vec![RankedRunAction {
                kind: RankedActionKind::FireHook,
                tick: 59,
            }],
            RankedRunSummary {
                score: 300,
                dynamite_used: 0,
                caught_count: 1,
                cleared: true,
            },
        );
        let player = Address::repeat_byte(0x11);
        let campaign_id = ranked_evidence.session_id;
        let campaign_seed = build_campaign_seed(campaign_id, player, "test-deployment");

        CampaignEvidenceV2 {
            protocol_version: ranked_evidence.protocol_version,
            simulation_version: ranked_evidence.simulation_version,
            campaign_id,
            session_id: ranked_evidence.session_id,
            campaign_seed,
            client_build_hash: ranked_evidence.client_build_hash,
            levels: vec![CampaignLevelEvidence {
                level_group: 1,
                level_id: ranked_evidence.level_id,
                level_version: ranked_evidence.level_version,
                level_content_hash: ranked_evidence.level_content_hash,
                challenge_seed: ranked_evidence.challenge_seed,
                goal: spec.goal,
                logic_fps: ranked_evidence.logic_fps,
                finished_tick: ranked_evidence.finished_tick,
                actions: ranked_evidence.actions,
                summary: ranked_evidence.summary,
            }],
            purchases: Vec::new(),
            final_score: 300,
        }
    }

    fn sample_two_level_campaign_evidence_with_purchase(
        first_spec: &RankedManifestLevel,
        second_spec: &RankedManifestLevel,
    ) -> CampaignEvidenceV2 {
        let first_level = sample_evidence(
            first_spec,
            vec![RankedRunAction {
                kind: RankedActionKind::FireHook,
                tick: 59,
            }],
            RankedRunSummary {
                score: 300,
                dynamite_used: 0,
                caught_count: 1,
                cleared: true,
            },
        );
        let player = Address::repeat_byte(0x11);
        let campaign_id = first_level.session_id;
        let campaign_seed = build_campaign_seed(campaign_id, player, "test-deployment");
        let offers = build_shop_offers(campaign_seed, 2);
        let purchase_offer = offers
            .into_iter()
            .find(|offer| offer.item_id == "dynamite")
            .unwrap_or_else(|| build_shop_offers(campaign_seed, 2).into_iter().next().expect("shop offer"));

        let carry_after_purchase = first_level
            .summary
            .score
            .saturating_sub(purchase_offer.price);

        let second_level = sample_evidence(
            second_spec,
            vec![RankedRunAction {
                kind: RankedActionKind::FireHook,
                tick: 59,
            }],
            RankedRunSummary {
                score: 0,
                dynamite_used: 0,
                caught_count: 0,
                cleared: false,
            },
        );
        let second_outcome = simulate_ranked_run_with_loadout(
            &second_level,
            second_spec,
            RankedSimulationLoadout {
                dynamite_count: 1,
                buffs: SimulationBuffs::default(),
            },
        )
        .expect("simulate second campaign level");
        let second_level_score = second_outcome.score;

        CampaignEvidenceV2 {
            protocol_version: first_level.protocol_version,
            simulation_version: first_level.simulation_version,
            campaign_id,
            session_id: first_level.session_id,
            campaign_seed,
            client_build_hash: first_level.client_build_hash,
            levels: vec![
                CampaignLevelEvidence {
                    level_group: 1,
                    level_id: first_level.level_id,
                    level_version: first_level.level_version,
                    level_content_hash: first_level.level_content_hash,
                    challenge_seed: first_level.challenge_seed,
                    goal: first_spec.goal,
                    logic_fps: first_level.logic_fps,
                    finished_tick: first_level.finished_tick,
                    actions: first_level.actions,
                    summary: first_level.summary,
                },
                CampaignLevelEvidence {
                    level_group: 2,
                    level_id: second_level.level_id,
                    level_version: second_level.level_version,
                    level_content_hash: second_level.level_content_hash,
                    challenge_seed: second_level.challenge_seed,
                    goal: second_spec.goal,
                    logic_fps: second_level.logic_fps,
                    finished_tick: second_level.finished_tick,
                    actions: second_level.actions,
                    summary: RankedRunSummary {
                        score: second_outcome.score,
                        dynamite_used: second_outcome.dynamite_used,
                        caught_count: second_outcome.caught_count,
                        cleared: second_outcome.cleared,
                    },
                },
            ],
            purchases: vec![CampaignShopPurchaseEvidence {
                shop_level_group: 2,
                item_id: purchase_offer.item_id,
                price: purchase_offer.price,
            }],
            final_score: carry_after_purchase.saturating_add(second_level_score),
        }
    }

    #[test]
    fn parse_level_id_accepts_l10() {
        assert_eq!(parse_level_id("L10").expect("L10 should parse"), B256::from_slice(&{
            let mut bytes = [0u8; 32];
            bytes[..3].copy_from_slice(b"L10");
            bytes
        }));
    }

    #[test]
    fn validate_campaign_evidence_accepts_verified_progress() {
        let spec = load_campaign_ranked_fixture();
        let manifest = RankedManifest {
            version: 1,
            generated_at: "test".to_string(),
            simulation_version: spec.simulation_version,
            logic_fps: spec.logic_fps,
            levels: vec![spec.clone()],
        };
        let evidence = sample_campaign_evidence(&spec);
        let verified = validate_campaign_evidence(
            &evidence,
            evidence.campaign_id,
            evidence.session_id,
            evidence.campaign_seed,
            &manifest,
        )
        .expect("campaign evidence should validate");

        assert_eq!(verified.reached_level, 1);
        assert!(!verified.completed);
        assert_eq!(verified.final_score, 300);
    }

    #[test]
    fn validate_campaign_evidence_rejects_tampered_content_hash() {
        let spec = load_campaign_ranked_fixture();
        let manifest = RankedManifest {
            version: 1,
            generated_at: "test".to_string(),
            simulation_version: spec.simulation_version,
            logic_fps: spec.logic_fps,
            levels: vec![spec.clone()],
        };
        let mut evidence = sample_campaign_evidence(&spec);
        evidence.levels[0].level_content_hash = keccak256(b"tampered");

        let error = validate_campaign_evidence(
            &evidence,
            evidence.campaign_id,
            evidence.session_id,
            evidence.campaign_seed,
            &manifest,
        )
        .expect_err("tampered content hash should fail");
        assert!(error.to_string().contains("levelContentHash"));
    }

    #[test]
    fn validate_campaign_evidence_rejects_illegal_purchase() {
        let spec = load_campaign_ranked_fixture();
        let manifest = RankedManifest {
            version: 1,
            generated_at: "test".to_string(),
            simulation_version: spec.simulation_version,
            logic_fps: spec.logic_fps,
            levels: vec![spec.clone()],
        };
        let mut evidence = sample_campaign_evidence(&spec);
        evidence.purchases.push(CampaignShopPurchaseEvidence {
            shop_level_group: 2,
            item_id: "gemPolish".to_string(),
            price: 1,
        });

        let error = validate_campaign_evidence(
            &evidence,
            evidence.campaign_id,
            evidence.session_id,
            evidence.campaign_seed,
            &manifest,
        )
        .expect_err("illegal purchase should fail");
        assert!(error.to_string().contains("deterministic shop offer"));
    }

    #[test]
    fn validate_campaign_evidence_accepts_two_levels_with_shop_purchase() {
        let mut first_spec = load_campaign_ranked_fixture();
        first_spec.level_id = "L1".to_string();
        first_spec.version = 1;
        first_spec.goal = 100;
        first_spec.canonical.goal = 100;

        let mut second_spec = first_spec.clone();
        second_spec.level_id = "L2".to_string();
        second_spec.version = 1;
        second_spec.content_hash = keccak256(b"campaign-l2-content");
        second_spec.challenge_seed = keccak256(b"campaign-l2-seed");

        let manifest = RankedManifest {
            version: 1,
            generated_at: "test".to_string(),
            simulation_version: first_spec.simulation_version,
            logic_fps: first_spec.logic_fps,
            levels: vec![first_spec.clone(), second_spec.clone()],
        };
        let evidence =
            sample_two_level_campaign_evidence_with_purchase(&first_spec, &second_spec);

        let verified = validate_campaign_evidence(
            &evidence,
            evidence.campaign_id,
            evidence.session_id,
            evidence.campaign_seed,
            &manifest,
        )
        .expect("two-level campaign evidence should validate");

        assert_eq!(verified.reached_level, 2);
        assert!(!verified.completed);
        assert_eq!(verified.purchased_item_count, 1);
        assert_eq!(verified.final_score, evidence.final_score);
    }
}
