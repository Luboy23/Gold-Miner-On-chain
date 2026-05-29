//! session_write_model.rs 汇总与 session/run 写模型直接相关的数据库能力。
//!
//! 这里的 re-export 不是简单转发，而是对上层声明：
//! - session 生命周期操作从 session_write 暴露
//! - run 提交与 relay 状态推进从 run_write 暴露
//! - campaign 生命周期单独走 campaign_write
//!
//! handler/worker 只依赖这一层的组合出口，避免直接知道底层文件拆分细节。

pub use super::campaign_write::{
    activate_campaign, insert_campaign_session, load_campaign_row, load_campaign_row_by_id,
    store_campaign_submission, update_campaign_submission_status,
};
pub use super::run_write::{
    count_run_statuses, count_runs_by_status, insert_validated_run,
    insert_validated_run_for_active_session, load_runs_for_relay,
    load_submitted_transactions, session_tx_hashes, update_run_status_for_session,
    update_run_status_for_tx_hash,
};
pub use super::session_write::{
    activate_game_session, allocate_session_nonce, create_game_session,
    increment_accepted_run_count, insert_game_session, load_session_row,
    load_session_row_by_id, load_sessions_ready_for_finalize, queue_session_for_finalize,
    set_session_status,
};
