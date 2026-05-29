use alloy::primitives::{Address, B256};
use anyhow::{anyhow, Result};
use goldminer_core::{ActiveSessionPermit, VerifiedRunRecord};
use sqlx::Row;

use crate::{models::{CampaignRow, SessionRow}, parse_address};

use super::common::StoredRun;

pub(crate) fn map_session_row(row: sqlx::sqlite::SqliteRow) -> Result<SessionRow> {
    Ok(SessionRow {
        permit: ActiveSessionPermit {
            player: parse_address(&row.try_get::<String, _>("player")?)?,
            delegate: parse_address(&row.try_get::<String, _>("delegate")?)?,
            session_id: row.try_get::<String, _>("session_id")?.parse()?,
            deployment_id_hash: goldminer_core::deployment_id_hash(
                &row.try_get::<String, _>("deployment_id")?,
            ),
            issued_at: row.try_get::<i64, _>("issued_at")? as u64,
            deadline: row.try_get::<i64, _>("deadline")? as u64,
            nonce: row.try_get::<i64, _>("nonce")? as u32,
            max_runs: row.try_get::<i64, _>("max_runs")? as u16,
        },
        permit_signature: row.try_get("permit_signature")?,
        status: row.try_get("status")?,
        finalize_requested_at_ms: row.try_get("finalize_requested_at_ms")?,
        accepted_run_count: row.try_get("accepted_run_count")?,
        last_error: row.try_get("last_error")?,
    })
}

pub(crate) fn map_campaign_row(row: sqlx::sqlite::SqliteRow) -> Result<CampaignRow> {
    Ok(CampaignRow {
        campaign_id: row.try_get::<String, _>("campaign_id")?.parse()?,
        session_id: row.try_get::<String, _>("session_id")?.parse()?,
        player: parse_address(&row.try_get::<String, _>("player")?)?,
        campaign_seed: row.try_get::<String, _>("campaign_seed")?.parse()?,
        permit_signature: row.try_get("permit_signature")?,
        status: row.try_get("status")?,
        tx_hash: row
            .try_get::<Option<String>, _>("tx_hash")?
            .map(|value| value.parse())
            .transpose()?,
        last_error: row.try_get("last_error")?,
    })
}

pub(crate) fn map_stored_run(row: sqlx::sqlite::SqliteRow) -> Result<StoredRun> {
    let permit_signature: Option<String> = row.try_get("permit_signature")?;
    Ok(StoredRun {
        session_id: row.try_get::<String, _>("session_id")?.parse()?,
        player: parse_address(&row.try_get::<String, _>("player")?)?,
        verified_run: VerifiedRunRecord {
            run_id: row.try_get::<String, _>("run_id")?.parse()?,
            challenge_id: goldminer_core::parse_level_id(&row.try_get::<String, _>("challenge_id")?)?,
            challenge_version: row.try_get::<i64, _>("challenge_version")? as u32,
            diamonds_caught: row.try_get::<i64, _>("diamonds_caught")? as u32,
            last_diamond_at_ms: row.try_get::<i64, _>("last_diamond_at_ms")? as u32,
            evidence_hash: row.try_get::<String, _>("evidence_hash")?.parse()?,
        },
        permit_signature: permit_signature.unwrap_or_default(),
    })
}

pub(crate) fn event_signature_hash(signature: &str) -> B256 {
    alloy::primitives::keccak256(signature.as_bytes())
}

pub(crate) fn decode_address_topic(topic: &B256) -> Address {
    Address::from_slice(&topic.as_slice()[12..32])
}

pub(crate) fn decode_u32_topic(topic: &B256) -> u32 {
    let bytes = topic.as_slice();
    u32::from_be_bytes([bytes[28], bytes[29], bytes[30], bytes[31]])
}

pub(crate) fn decode_u8_word(data: &[u8], offset: usize) -> Result<u8> {
    let slice = data
        .get(offset + 31)
        .ok_or_else(|| anyhow!("decode u8 word at offset {offset}"))?;
    Ok(*slice)
}

pub(crate) fn decode_bool_word(data: &[u8], offset: usize) -> Result<bool> {
    Ok(decode_u8_word(data, offset)? != 0)
}

pub(crate) fn decode_u16_word(data: &[u8], offset: usize) -> Result<u16> {
    let slice = data
        .get(offset + 30..offset + 32)
        .ok_or_else(|| anyhow!("decode u16 word at offset {offset}"))?;
    Ok(u16::from_be_bytes([slice[0], slice[1]]))
}

pub(crate) fn decode_u32_word(data: &[u8], offset: usize) -> Result<u32> {
    let slice = data
        .get(offset + 28..offset + 32)
        .ok_or_else(|| anyhow!("decode u32 word at offset {offset}"))?;
    Ok(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

pub(crate) fn decode_b256_word(data: &[u8], offset: usize) -> Result<B256> {
    let slice = data
        .get(offset..offset + 32)
        .ok_or_else(|| anyhow!("decode bytes32 word at offset {offset}"))?;
    Ok(B256::from_slice(slice))
}

pub(crate) fn bytes32_level_id(value: B256) -> String {
    let bytes = value.as_slice();
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}
