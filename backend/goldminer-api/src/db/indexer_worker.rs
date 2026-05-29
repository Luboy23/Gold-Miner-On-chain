//! indexer_worker 负责把 scoreboard 合约事件持续折叠成 read model。
//!
//! 它只消费“已确认到足够深度”的链上日志，并把 RunSubmitted/CampaignSubmitted
//! 写入本地排行榜/历史表。它不参与 replay 校验，也不负责 relay 派发。

use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::time::Duration;
use tracing::error;

use crate::{app_state::AppState, models::{CAMPAIGN_SUBMITTED_SIGNATURE, INDEXER_STATUS_ERROR, INDEXER_STATUS_RUNNING, RUN_SUBMITTED_SIGNATURE}};

use super::{indexed_read_model_write::{insert_indexed_campaign, insert_indexed_run, load_indexer_cursor, update_indexer_status}, sqlite_decode::{bytes32_level_id, decode_address_topic, decode_b256_word, decode_bool_word, decode_u16_word, decode_u32_topic, decode_u32_word, decode_u8_word, event_signature_hash}};

pub fn spawn_indexer_worker(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            // indexer worker 同样是常驻后台任务；单次 tick 失败写入游标错误态后继续轮询，
            // 避免因为临时 RPC 故障让 read model 永久停摆。
            if let Err(error) = process_indexer_worker_tick(state.clone()).await {
                let _ = update_indexer_status(
                    &state.db,
                    INDEXER_STATUS_ERROR,
                    0,
                    -1,
                    Some(&error.to_string()),
                )
                .await;
                error!("indexer worker tick failed: {error:#}");
            }
            tokio::time::sleep(Duration::from_millis(state.config.indexer_poll_interval_ms)).await;
        }
    });
}

pub async fn process_indexer_worker_tick(state: Arc<AppState>) -> Result<()> {
    let cursor = load_indexer_cursor(&state.db).await?;
    let latest_block = state.chain_client.get_latest_block_number().await?;
    // 只索引达到确认深度的区块，避免短分叉把 leaderboard/history 写入又回滚。
    let confirmed_latest = latest_block.saturating_sub(state.config.indexer_confirmations);

    if confirmed_latest < cursor.last_processed_block {
        update_indexer_status(
            &state.db,
            INDEXER_STATUS_RUNNING,
            cursor.last_processed_block,
            cursor.last_processed_log_index,
            None,
        )
        .await?;
        return Ok(());
    }

    let filter = alloy::rpc::types::Filter::new()
        .address(state.config.scoreboard_address)
        .from_block(cursor.last_processed_block)
        .to_block(confirmed_latest);
    let mut logs = state.chain_client.get_logs(filter).await?;
    logs.sort_by_key(|log| {
        (
            log.block_number.unwrap_or_default(),
            log.log_index.unwrap_or_default(),
        )
    });

    let mut last_block = cursor.last_processed_block;
    let mut last_log_index = cursor.last_processed_log_index;

    for log in logs {
        let block_number = log.block_number.unwrap_or_default();
        let log_index = log.log_index.unwrap_or_default() as i64;
        // 游标保证同一批日志即使重复拉取，也只会向前消费一次。
        if block_number == last_block && log_index <= last_log_index {
            continue;
        }
        process_indexer_log(state.clone(), &log).await?;
        last_block = block_number;
        last_log_index = log_index;
        update_indexer_status(
            &state.db,
            INDEXER_STATUS_RUNNING,
            last_block,
            last_log_index,
            None,
        )
        .await?;
    }

    update_indexer_status(
        &state.db,
        INDEXER_STATUS_RUNNING,
        last_block.max(confirmed_latest),
        last_log_index,
        None,
    )
    .await?;
    Ok(())
}

async fn process_indexer_log(state: Arc<AppState>, log: &alloy::rpc::types::Log) -> Result<()> {
    let topic0 = log
        .topics()
        .first()
        .copied()
        .ok_or_else(|| anyhow!("log missing topic0"))?;
    // indexer 只识别 scoreboard 的两个提交事件；其他事件统一忽略，保持 read model 输入面最小。
    if topic0 != event_signature_hash(RUN_SUBMITTED_SIGNATURE)
        && topic0 != event_signature_hash(CAMPAIGN_SUBMITTED_SIGNATURE)
    {
        return Ok(());
    }
    let submitted_at = resolve_log_timestamp(state.clone(), log).await?;
    let topics = log.topics();
    let data = log.data().data.as_ref();
    if topic0 == event_signature_hash(RUN_SUBMITTED_SIGNATURE) {
        if topics.len() < 4 {
            return Ok(());
        }
        insert_indexed_run(
            &state.db,
            log.transaction_hash
                .ok_or_else(|| anyhow!("missing transaction hash"))?,
            log.log_index.unwrap_or_default(),
            decode_address_topic(&topics[1]),
            bytes32_level_id(topics[2]),
            decode_u32_topic(&topics[3]),
            decode_u32_word(data, 0)?,
            decode_u32_word(data, 32)?,
            decode_b256_word(data, 64)?,
            submitted_at,
            log.block_number.unwrap_or_default(),
        )
        .await?;
        return Ok(());
    }

    if topics.len() < 3 {
        return Ok(());
    }
    insert_indexed_campaign(
        &state.db,
        log.transaction_hash
            .ok_or_else(|| anyhow!("missing transaction hash"))?,
        log.log_index.unwrap_or_default(),
        decode_address_topic(&topics[1]),
        topics[2],
        decode_u8_word(data, 0)?,
        decode_bool_word(data, 32)?,
        decode_u32_word(data, 64)?,
        decode_u32_word(data, 96)?,
        decode_u16_word(data, 128)?,
        decode_b256_word(data, 160)?,
        submitted_at,
        log.block_number.unwrap_or_default(),
    )
    .await?;

    Ok(())
}

async fn resolve_log_timestamp(state: Arc<AppState>, log: &alloy::rpc::types::Log) -> Result<u64> {
    if let Some(timestamp) = log.block_timestamp {
        return Ok(timestamp);
    }
    let block_number = log
        .block_number
        .ok_or_else(|| anyhow!("log missing block number"))?;
    state.chain_client.get_block_timestamp(block_number).await
}
