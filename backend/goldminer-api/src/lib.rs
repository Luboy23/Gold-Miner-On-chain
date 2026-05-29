pub mod app_state;
pub mod chain_client;
pub mod config;
pub mod db;
pub mod handlers;
pub mod models;
pub mod router;
pub mod services;

use std::{collections::BTreeMap, fs, str::FromStr, sync::Arc};

use alloy::primitives::Address;
use anyhow::{Context, Result};
use app_state::AppState;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chain_client::AlloyChainClient;
use config::{load_config, parse_signer_env};
use goldminer_core::{RankedChallengeManifest, RankedManifest};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
    SqlitePool,
};
use tokio::net::TcpListener;
use tracing::info;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    pub fn internal(error: impl ToString) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "ok": false, "error": self.message })),
        )
            .into_response()
    }
}

pub async fn run() -> Result<()> {
    let config = load_config()?;
    let sqlite_options = SqliteConnectOptions::from_str(&config.database_url)
        .context("parse sqlite url")?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let db = SqlitePool::connect_with(sqlite_options)
        .await
        .context("connect sqlite")?;
    db::init_db(&db).await?;

    let relayer_signer = parse_signer_env("GOLDMINER_RELAYER_PRIVATE_KEY")?;
    let verifier_signer = parse_signer_env("GOLDMINER_VERIFIER_PRIVATE_KEY")?;
    let relayer_address = relayer_signer.address();
    let chain_client = Arc::new(AlloyChainClient::new(&config, relayer_signer)?);
    let ranked_manifest = load_ranked_manifest(&config.ranked_manifest_path)?;
    let ranked_challenges = ranked_manifest
        .challenges
        .iter()
        .map(|challenge| challenge.summary())
        .collect::<Vec<_>>();
    let ranked_challenge_lookup = ranked_manifest
        .challenges
        .iter()
        .cloned()
        .map(|challenge| ((challenge.challenge_id.clone(), challenge.version), challenge))
        .collect::<BTreeMap<_, _>>();
    let adventure_manifest = load_adventure_manifest(&config.adventure_manifest_path)?;
    let adventure_levels = adventure_manifest
        .levels
        .iter()
        .map(|level| level.summary())
        .collect::<Vec<_>>();
    let adventure_level_lookup = adventure_manifest
        .levels
        .iter()
        .cloned()
        .map(|level| ((level.level_id.clone(), level.version), level))
        .collect::<BTreeMap<_, _>>();

    let state = Arc::new(AppState {
        config: config.clone(),
        db: db.clone(),
        chain_client,
        relayer_address,
        verifier_signer,
        ranked_manifest,
        ranked_challenges,
        ranked_challenge_lookup,
        adventure_manifest,
        adventure_levels,
        adventure_level_lookup,
    });

    db::spawn_relay_worker(state.clone());
    db::spawn_indexer_worker(state.clone());

    let app = router::build_router(state);
    let listener = TcpListener::bind(config.bind)
        .await
        .context("bind Gold Miner API")?;
    info!("Gold Miner API listening on http://{}", config.bind);
    axum::serve(listener, app).await.context("serve axum app")?;
    Ok(())
}

fn load_ranked_manifest(path: &std::path::Path) -> Result<RankedChallengeManifest> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read ranked manifest at {}", path.display()))?;
    serde_json::from_str(&raw).context("parse ranked manifest")
}

fn load_adventure_manifest(path: &std::path::Path) -> Result<RankedManifest> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read adventure manifest at {}", path.display()))?;
    serde_json::from_str(&raw).context("parse adventure manifest")
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn format_address(address: Address) -> String {
    format!("{address:#x}")
}

pub fn format_b256(value: alloy::primitives::B256) -> String {
    format!("{value:#x}")
}

pub fn parse_address(value: &str) -> Result<Address> {
    value
        .parse()
        .with_context(|| format!("parse address {value}"))
}
