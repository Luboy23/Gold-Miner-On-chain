use std::sync::Arc;

use axum::{
    http::{header, HeaderValue, Method},
    routing::{get, post},
    Router,
};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::{
    app_state::AppState,
        handlers::{
        campaigns::{activate_campaign, campaign_status, create_campaign, upload_campaign_evidence},
        read_model::{
            health, indexer_status, read_campaign_history, read_campaign_leaderboard,
            read_history, read_leaderboard, read_ranked_current, read_ranked_overview,
        },
        runs::upload_run,
        sessions::{activate_session, create_session, finalize_session, session_status},
    },
};

fn is_allowed_dev_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("http://localhost:")
        || origin.starts_with("http://[::1]:")
}

fn build_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _request_parts| is_allowed_dev_origin(origin),
        ))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::ACCEPT])
        .allow_credentials(false)
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ranked/current", get(read_ranked_current))
        .route("/api/ranked/sessions", post(create_session))
        .route("/api/ranked/sessions/activate", post(activate_session))
        .route("/api/campaigns", post(create_campaign))
        .route("/api/campaigns/activate", post(activate_campaign))
        .route("/api/campaigns/:campaign_id/evidence", post(upload_campaign_evidence))
        .route("/api/campaigns/:campaign_id/status", get(campaign_status))
        .route("/api/ranked/runs", post(upload_run))
        .route("/api/ranked/sessions/:session_id/finalize", post(finalize_session))
        .route("/api/ranked/sessions/:session_id/status", get(session_status))
        .route("/api/ranked/leaderboard", get(read_leaderboard))
        .route("/api/ranked/overview/:player", get(read_ranked_overview))
        .route("/api/campaigns/leaderboard", get(read_campaign_leaderboard))
        .route("/api/campaigns/history/:player", get(read_campaign_history))
        .route("/api/ranked/history/:player", get(read_history))
        .route("/api/indexer/status", get(indexer_status))
        .layer(build_cors_layer())
        .with_state(state)
}
