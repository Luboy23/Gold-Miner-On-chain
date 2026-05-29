//! campaign_write.rs 负责 campaigns 表的写入与状态推进。
//!
//! 这里保存的是 campaign 会话生命周期：
//! - 创建
//! - 激活
//! - 上传 payload / verified payload
//! - relay 状态更新
//!
//! 它不负责 replay 校验，也不负责 read model 展示查询；那些边界分别在 core 和
//! campaign_read_model 中处理。

use alloy::primitives::{Address, B256};
use anyhow::Result;
use sqlx::{query, SqlitePool};

use super::sqlite_decode::map_campaign_row;
use crate::{
    format_address, format_b256,
    models::{CampaignRow, CAMPAIGN_STATUS_ACTIVE, CAMPAIGN_STATUS_CREATED},
};

pub async fn insert_campaign_session(
    pool: &SqlitePool,
    campaign_id: B256,
    session_id: B256,
    player: Address,
    campaign_seed: B256,
    created_at_ms: u64,
) -> Result<()> {
    // campaign 初始行只记录会话身份与种子，不预先写入 payload；payload 只能在 evidence
    // 校验通过后再落库，避免把未验证数据误当成可 relay 内容。
    query(
        r#"
        INSERT INTO campaigns (
            campaign_id, session_id, player, campaign_seed, permit_signature,
            payload_json, verified_payload_json, status, tx_hash, last_error, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)
        "#,
    )
    .bind(format_b256(campaign_id))
    .bind(format_b256(session_id))
    .bind(format_address(player))
    .bind(format_b256(campaign_seed))
    .bind(CAMPAIGN_STATUS_CREATED)
    .bind(created_at_ms as i64)
    .bind(created_at_ms as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn load_campaign_row(
    pool: &SqlitePool,
    campaign_id: B256,
    player: Address,
) -> Result<Option<CampaignRow>> {
    let row = query(
        r#"
        SELECT *
        FROM campaigns
        WHERE campaign_id = ? AND player = ?
        "#,
    )
    .bind(format_b256(campaign_id))
    .bind(format_address(player))
    .fetch_optional(pool)
    .await?;

    row.map(map_campaign_row).transpose()
}

pub async fn load_campaign_row_by_id(
    pool: &SqlitePool,
    campaign_id: B256,
) -> Result<Option<CampaignRow>> {
    let row = query(
        r#"
        SELECT *
        FROM campaigns
        WHERE campaign_id = ?
        "#,
    )
    .bind(format_b256(campaign_id))
    .fetch_optional(pool)
    .await?;

    row.map(map_campaign_row).transpose()
}

pub async fn activate_campaign(
    pool: &SqlitePool,
    campaign_id: B256,
    player: Address,
    signature: &str,
    activated_at_ms: u64,
) -> Result<()> {
    // 激活阶段只补 permit signature 并切换到 active，不在这里写 verified payload。
    query(
        r#"
        UPDATE campaigns
        SET permit_signature = ?, status = ?, updated_at_ms = ?
        WHERE campaign_id = ? AND player = ?
        "#,
    )
    .bind(signature)
    .bind(CAMPAIGN_STATUS_ACTIVE)
    .bind(activated_at_ms as i64)
    .bind(format_b256(campaign_id))
    .bind(format_address(player))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn store_campaign_submission(
    pool: &SqlitePool,
    campaign_id: B256,
    player: Address,
    payload_json: &str,
    verified_payload_json: &str,
    status: &str,
    tx_hash: Option<B256>,
    last_error: Option<&str>,
    updated_at_ms: u64,
) -> Result<()> {
    // payload_json 保存前端原始上传体，verified_payload_json 保存后端验证/规范化后的摘要。
    // 两者并存是为了审计与问题排查，不代表数据库里存在两份独立真相源。
    query(
        r#"
        UPDATE campaigns
        SET payload_json = ?, verified_payload_json = ?, status = ?, tx_hash = ?, last_error = ?, updated_at_ms = ?
        WHERE campaign_id = ? AND player = ?
        "#,
    )
    .bind(payload_json)
    .bind(verified_payload_json)
    .bind(status)
    .bind(tx_hash.map(format_b256))
    .bind(last_error)
    .bind(updated_at_ms as i64)
    .bind(format_b256(campaign_id))
    .bind(format_address(player))
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_campaign_submission_status(
    pool: &SqlitePool,
    campaign_id: B256,
    status: &str,
    tx_hash: Option<B256>,
    last_error: Option<&str>,
    updated_at_ms: u64,
) -> Result<()> {
    // relay 轮询只更新链上派发状态，不回写 payload 内容本身。
    query(
        r#"
        UPDATE campaigns
        SET status = ?, tx_hash = ?, last_error = ?, updated_at_ms = ?
        WHERE campaign_id = ?
        "#,
    )
    .bind(status)
    .bind(tx_hash.map(format_b256))
    .bind(last_error)
    .bind(updated_at_ms as i64)
    .bind(format_b256(campaign_id))
    .execute(pool)
    .await?;
    Ok(())
}
