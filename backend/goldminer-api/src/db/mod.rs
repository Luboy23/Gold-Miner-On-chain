//! db/mod.rs 是 API 侧数据库能力的汇总入口。
//!
//! 这里不承载具体 SQL 细节，而是把 session、campaign、relay、indexer、read model
//! 各自的写入/读取能力重新导出成清晰边界。handler/service 只依赖这些导出函数，
//! 不应该跨模块直接拼接底层实现。

pub mod common;
pub mod campaign_read_model;
pub mod campaign_write;
pub mod indexed_read_model_write;
pub mod indexer_worker;
pub mod ranked_read_model;
pub mod relay_worker;
pub mod run_write;
pub mod schema;
pub mod session_write;
pub mod session_write_model;
pub mod sqlite_decode;

pub use campaign_read_model::{query_campaign_history, query_campaign_leaderboard};
pub use indexed_read_model_write::{
    insert_indexed_campaign, insert_indexed_run, load_indexer_cursor, query_indexer_status,
    update_indexer_status,
};
pub use indexer_worker::spawn_indexer_worker;
pub use ranked_read_model::{query_history, query_leaderboard};
pub use relay_worker::spawn_relay_worker;
pub use schema::init_db;
// 下面这些 re-export 代表对上层暴露的“数据库契约”。
// 一旦某项能力需要跨模块组合，优先在对应子模块收口，而不是把 handler 变成 DB 编排器。
pub use session_write_model::{
    activate_campaign, activate_game_session, allocate_session_nonce, count_run_statuses,
    count_runs_by_status, create_game_session, increment_accepted_run_count,
    insert_campaign_session, insert_game_session, insert_validated_run,
    insert_validated_run_for_active_session, load_campaign_row, load_campaign_row_by_id,
    load_session_row, load_session_row_by_id, queue_session_for_finalize,
    session_tx_hashes, store_campaign_submission, update_campaign_submission_status,
};
pub use common::{RunStatusCounts, StoredRun, ValidatedRunInsertOutcome};
#[cfg(test)]
mod tests;
