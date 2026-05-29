//! config.rs 负责把环境变量、本地 runtime config 和默认值折叠成 API 进程配置。
//!
//! 这里的目标不是暴露“所有来源的原始值”，而是给后续 app_state/worker 提供一份
//! 已经解析、已带默认值、可直接使用的配置快照。

use std::{env, fs, net::SocketAddr, path::PathBuf, str::FromStr};

use alloy::{primitives::Address, signers::local::PrivateKeySigner};
use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Clone)]
pub struct AppConfig {
    pub bind: SocketAddr,
    pub database_url: String,
    pub rpc_url: String,
    pub chain_id: u64,
    pub deployment_id: String,
    pub scoreboard_address: Address,
    pub level_catalog_address: Address,
    pub session_ttl_seconds: u64,
    pub session_max_runs: u16,
    pub max_batch_runs: usize,
    pub auto_finalize_idle_seconds: u64,
    pub indexer_poll_interval_ms: u64,
    pub indexer_confirmations: u64,
    pub ranked_manifest_path: PathBuf,
    pub adventure_manifest_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfigFile {
    chain_id: u64,
    deployment_id: String,
    #[serde(rename = "apiBaseUrl")]
    _api_base_url: String,
    rpc_url: String,
    gold_miner_level_catalog_address: String,
    gold_miner_scoreboard_address: String,
}

pub fn load_config() -> Result<AppConfig> {
    let runtime_config = load_runtime_config().ok();

    // 环境变量优先级高于 contract-config.json，后者再高于硬编码默认值。
    // 这样本地开发既能直接复用前端部署配置，也能被后端进程环境单独覆盖。
    Ok(AppConfig {
        bind: env::var("GOLDMINER_API_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8788".to_string())
            .parse()
            .context("parse GOLDMINER_API_BIND")?,
        database_url: env::var("GOLDMINER_DATABASE_URL").unwrap_or_else(|_| {
            let default_path = env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("goldminer.sqlite");
            format!("sqlite://{}", default_path.display())
        }),
        rpc_url: env::var("GOLDMINER_RPC_URL")
            .ok()
            .or_else(|| runtime_config.as_ref().map(|value| value.rpc_url.clone()))
            .unwrap_or_else(|| "http://127.0.0.1:8545".to_string()),
        chain_id: env::var("GOLDMINER_CHAIN_ID")
            .ok()
            .map(|value| value.parse().context("parse GOLDMINER_CHAIN_ID"))
            .transpose()?
            .or_else(|| runtime_config.as_ref().map(|value| value.chain_id))
            .unwrap_or(31337),
        deployment_id: env::var("GOLDMINER_DEPLOYMENT_ID")
            .ok()
            .or_else(|| {
                runtime_config
                    .as_ref()
                    .map(|value| value.deployment_id.clone())
            })
            .unwrap_or_else(|| "local-goldminer-diamond-rush".to_string()),
        scoreboard_address: parse_address_env_or_runtime(
            "GOLDMINER_SCOREBOARD_ADDRESS",
            runtime_config
                .as_ref()
                .map(|value| value.gold_miner_scoreboard_address.as_str()),
        )?,
        level_catalog_address: parse_address_env_or_runtime(
            "GOLDMINER_LEVEL_CATALOG_ADDRESS",
            runtime_config
                .as_ref()
                .map(|value| value.gold_miner_level_catalog_address.as_str()),
        )?,
        session_ttl_seconds: env::var("GOLDMINER_SESSION_TTL_SECONDS")
            .unwrap_or_else(|_| "7200".to_string())
            .parse()
            .context("parse GOLDMINER_SESSION_TTL_SECONDS")?,
        session_max_runs: env::var("GOLDMINER_SESSION_MAX_RUNS")
            .unwrap_or_else(|_| "10".to_string())
            .parse()
            .context("parse GOLDMINER_SESSION_MAX_RUNS")?,
        max_batch_runs: env::var("GOLDMINER_MAX_BATCH_RUNS")
            .unwrap_or_else(|_| "8".to_string())
            .parse()
            .context("parse GOLDMINER_MAX_BATCH_RUNS")?,
        auto_finalize_idle_seconds: env::var("GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS")
            .unwrap_or_else(|_| "45".to_string())
            .parse()
            .context("parse GOLDMINER_AUTO_FINALIZE_IDLE_SECONDS")?,
        indexer_poll_interval_ms: env::var("GOLDMINER_INDEXER_POLL_INTERVAL_MS")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .context("parse GOLDMINER_INDEXER_POLL_INTERVAL_MS")?,
        indexer_confirmations: env::var("GOLDMINER_INDEXER_CONFIRMATIONS")
            .unwrap_or_else(|_| "0".to_string())
            .parse()
            .context("parse GOLDMINER_INDEXER_CONFIRMATIONS")?,
        ranked_manifest_path: resolve_existing_path(&[
            "frontend/public/ranked-challenge-manifest.json",
            "../frontend/public/ranked-challenge-manifest.json",
        ])
        .unwrap_or_else(|| PathBuf::from("frontend/public/ranked-challenge-manifest.json")),
        adventure_manifest_path: resolve_existing_path(&[
            "frontend/public/adventure-level-manifest.json",
            "../frontend/public/adventure-level-manifest.json",
        ])
        .unwrap_or_else(|| PathBuf::from("frontend/public/adventure-level-manifest.json")),
    })
}

pub fn parse_signer_env(name: &str) -> Result<PrivateKeySigner> {
    let value = env::var(name).with_context(|| format!("missing {name}"))?;
    PrivateKeySigner::from_str(&value).with_context(|| format!("parse {name}"))
}

fn load_runtime_config() -> Result<RuntimeConfigFile> {
    // 后端复用前端的 contract-config.json 作为默认部署来源，保证 API 与前端
    // 在本地开发时默认指向同一套 chain/deployment/address。
    let path = resolve_existing_path(&[
        "frontend/public/contract-config.json",
        "../frontend/public/contract-config.json",
    ])
    .unwrap_or_else(|| PathBuf::from("frontend/public/contract-config.json"));
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("read runtime config at {}", path.display()))?;
    serde_json::from_str(&raw).context("parse runtime config")
}

fn parse_address_env_or_runtime(name: &str, fallback: Option<&str>) -> Result<Address> {
    // 地址配置必须最终解析成有效 Address；缺失或格式错误都应在启动期直接失败。
    let value = env::var(name)
        .ok()
        .or_else(|| fallback.map(ToString::to_string))
        .with_context(|| format!("missing {name} and runtime config fallback"))?;
    Address::from_str(&value).with_context(|| format!("parse {name}"))
}

fn resolve_existing_path(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}
