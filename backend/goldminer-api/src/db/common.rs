use alloy::primitives::{Address, B256};
use goldminer_core::VerifiedRunRecord;

pub(crate) fn is_unique_violation(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::Database(database_error) => {
            database_error.is_unique_violation()
                || database_error
                    .message()
                    .contains("UNIQUE constraint failed")
        }
        _ => false,
    }
}

#[derive(Clone)]
pub struct StoredRun {
    pub session_id: B256,
    pub player: Address,
    pub verified_run: VerifiedRunRecord,
    pub permit_signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidatedRunInsertOutcome {
    Inserted,
    Duplicate,
    Rejected,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunStatusCounts {
    pub validated: i64,
    pub submitted: i64,
    pub confirmed: i64,
    pub failed: i64,
}
