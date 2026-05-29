//! ranked/replay.rs 负责把前端上传的 ranked/campaign evidence 重放成可校验结果。
//!
//! 这层的职责是“严格 replay”：
//! - 校验 manifest/canonical 常量是否匹配
//! - 校验 action tick 是否合法
//! - 用 deterministic runtime 重放整局或整关
//! - 产出与前端 summary 对比的最终结果
//!
//! 一旦这里拒绝 evidence，问题通常不是 transport，而是前端记录的终局真值不成立。

use anyhow::{bail, Result};

use crate::{
    ranked::manifest::{
        RankedChallengeManifestEntry, RankedManifestLevel, RANKED_PROTOCOL_VERSION,
    },
    ranked::runtime::{
        duration_ms_from_ticks, next_ranked_spawn_point, spawn_ranked_diamond, HookRuntime,
        HookState, RankedDiamondRushOutcome, RankedRuntime, RankedSimulationLoadout,
        RankedSimulationOutcome,
    },
    RankedActionKind, RankedRunEvidenceV2, RankedRunEvidenceV3,
};

pub fn simulate_ranked_run(
    evidence: &RankedRunEvidenceV2,
    spec: &RankedManifestLevel,
) -> Result<RankedSimulationOutcome> {
    simulate_ranked_run_with_loadout(evidence, spec, RankedSimulationLoadout::default())
}

pub fn simulate_ranked_run_with_loadout(
    evidence: &RankedRunEvidenceV2,
    spec: &RankedManifestLevel,
    loadout: RankedSimulationLoadout,
) -> Result<RankedSimulationOutcome> {
    // 进入重放前，先把所有“静态真相源”对齐：协议版本、simulationVersion、logicFps、
    // level identity、content hash、challenge seed 和 finishedTick 窗口。
    if evidence.protocol_version != RANKED_PROTOCOL_VERSION {
        bail!("protocolVersion is not supported");
    }
    if evidence.simulation_version != spec.simulation_version
        || evidence.simulation_version != spec.canonical.simulation_version
    {
        bail!("simulationVersion does not match ranked manifest");
    }
    if evidence.logic_fps != spec.logic_fps || evidence.logic_fps != spec.canonical.logic_fps {
        bail!("logicFps does not match ranked manifest");
    }
    if evidence.level_id != spec.level_id || evidence.level_version != spec.version {
        bail!("level identity does not match ranked manifest");
    }
    if evidence.level_content_hash != spec.content_hash {
        bail!("levelContentHash does not match ranked manifest");
    }
    if evidence.challenge_seed != spec.challenge_seed {
        bail!("challengeSeed does not match ranked manifest");
    }
    if evidence.finished_tick > spec.time_limit_ticks {
        bail!("finishedTick exceeds timeLimitTicks");
    }

    let mut runtime = RankedRuntime::new_with_loadout(spec, loadout)?;
    let frame_sec = 1.0 / f64::from(spec.logic_fps.max(1));
    let mut action_index = 0usize;
    let mut previous_tick = None;

    for action in &evidence.actions {
        if let Some(last_tick) = previous_tick {
            if action.tick <= last_tick {
                bail!("action ticks must be strictly increasing");
            }
        }
        if action.tick >= evidence.finished_tick {
            bail!("action tick must be inside the run window");
        }
        previous_tick = Some(action.tick);
    }

    // replay 逐 tick 推进，并在精确 tick 上消费 action；这也是 hook 合法性校验的唯一依据。
    while runtime.logic_tick < evidence.finished_tick {
        if action_index < evidence.actions.len() {
            let action = &evidence.actions[action_index];
            if action.tick == runtime.logic_tick {
                match action.kind {
                    RankedActionKind::FireHook => {
                        // fireHook 只能发生在 swinging 状态；这类错误通常说明前端 action/tick 封存错了。
                        if runtime.hook.state != HookState::Swinging {
                            bail!("fireHook is only legal while the hook is swinging");
                        }
                        runtime.hook.fire();
                    }
                    RankedActionKind::UseDynamite => {
                        if runtime.dynamite_count == 0 {
                            bail!("useDynamite requires available dynamite");
                        }
                        if !runtime.hook.can_use_dynamite() {
                            bail!("useDynamite requires a caught entity");
                        }
                        runtime.dynamite_count = runtime.dynamite_count.saturating_sub(1);
                        runtime.dynamite_used = runtime.dynamite_used.saturating_add(1);
                        runtime.hook.use_dynamite(&mut runtime.entities);
                    }
                }
                action_index += 1;
            }
        }

        let catch = runtime.hook.update(
            frame_sec,
            &spec.canonical.constants,
            &mut runtime.entities,
            runtime.strength_multiplier,
        );

        for entity in runtime.entities.iter_mut() {
            entity.update(frame_sec, &spec.canonical.constants);
        }

        if let Some(catch) = catch {
            runtime.score = runtime.score.saturating_add(catch.bonus);
            runtime.caught_count = runtime.caught_count.saturating_add(1);
            if catch.dynamite_delta > 0 {
                runtime.dynamite_count = runtime
                    .dynamite_count
                    .saturating_add(catch.dynamite_delta)
                    .min(spec.canonical.constants.max_dynamite_count);
            }
            if catch.grants_strength_boost {
                runtime.strength_multiplier = (runtime.strength_multiplier * 1.5 + 1.0)
                    .min(spec.canonical.constants.max_strength_multiplier);
            }
            let _ = catch.reward_kind;
        }

        runtime.logic_tick += 1;
    }

    let cleared = runtime.logic_tick == spec.time_limit_ticks && runtime.score >= spec.goal;

    Ok(RankedSimulationOutcome {
        score: runtime.score,
        dynamite_used: runtime.dynamite_used,
        dynamite_count: runtime.dynamite_count,
        caught_count: runtime.caught_count,
        cleared,
        finished_tick: evidence.finished_tick,
        duration_ms: duration_ms_from_ticks(evidence.finished_tick, spec.logic_fps),
    })
}

pub fn simulate_diamond_rush_run(
    evidence: &RankedRunEvidenceV3,
    spec: &RankedChallengeManifestEntry,
) -> Result<RankedDiamondRushOutcome> {
    // 钻石排位的 replay 比通用 ranked 更严格：必须完整跑满 timeLimitTicks，且只允许 fireHook。
    if evidence.protocol_version != RANKED_PROTOCOL_VERSION {
        bail!("protocolVersion is not supported");
    }
    if evidence.simulation_version != spec.simulation_version
        || evidence.simulation_version != spec.canonical.simulation_version
    {
        bail!("simulationVersion does not match ranked manifest");
    }
    if evidence.logic_fps != spec.logic_fps || evidence.logic_fps != spec.canonical.logic_fps {
        bail!("logicFps does not match ranked manifest");
    }
    if evidence.challenge_id != spec.challenge_id || evidence.challenge_version != spec.version {
        bail!("challenge identity does not match ranked manifest");
    }
    if evidence.challenge_content_hash != spec.content_hash {
        bail!("challengeContentHash does not match ranked manifest");
    }
    if evidence.challenge_seed != spec.challenge_seed {
        bail!("challengeSeed does not match ranked manifest");
    }
    if evidence.finished_tick != spec.time_limit_ticks {
        bail!("finishedTick must match timeLimitTicks exactly");
    }
    if spec.canonical.spawn_policy.entity_type != "Diamond" {
        bail!("ranked challenge spawn policy must use Diamond");
    }
    if spec.canonical.spawn_policy.allow_items || spec.canonical.spawn_policy.allow_dynamite_action {
        bail!("ranked challenge spawn policy must disable items and dynamite");
    }

    let mut previous_tick = None;
    for action in &evidence.actions {
        if let Some(last_tick) = previous_tick {
            if action.tick <= last_tick {
                bail!("action ticks must be strictly increasing");
            }
        }
        if action.tick >= evidence.finished_tick {
            bail!("action tick must be inside the run window");
        }
        if action.kind != RankedActionKind::FireHook {
            bail!("ranked challenge only allows fireHook actions");
        }
        previous_tick = Some(action.tick);
    }

    let frame_sec = 1.0 / f64::from(spec.logic_fps.max(1));
    let mut hook = HookRuntime::new(&spec.canonical.constants);
    let mut entities = vec![spawn_ranked_diamond(spec, next_ranked_spawn_point(spec, 0)?)?];
    let mut action_index = 0usize;
    let mut logic_tick = 0u32;
    let mut diamonds_caught = 0u32;
    let mut last_diamond_tick = 0u32;
    let mut spawn_cursor = 1usize;

    while logic_tick < evidence.finished_tick {
        if action_index < evidence.actions.len() && evidence.actions[action_index].tick == logic_tick {
            if hook.state != HookState::Swinging {
                bail!("fireHook is only legal while the hook is swinging");
            }
            hook.fire();
            action_index += 1;
        }

        let catch = hook.update(
            frame_sec,
            &spec.canonical.constants,
            &mut entities,
            spec.canonical.constants.default_strength_multiplier,
        );

        for entity in entities.iter_mut() {
            entity.update(frame_sec, &spec.canonical.constants);
        }

        if catch.is_some() {
            diamonds_caught = diamonds_caught.saturating_add(1);
            last_diamond_tick = logic_tick.saturating_add(1);
            entities.retain(|entity| entity.active);
            if logic_tick.saturating_add(1) < spec.time_limit_ticks {
                entities.push(spawn_ranked_diamond(
                    spec,
                    next_ranked_spawn_point(spec, spawn_cursor)?,
                )?);
                spawn_cursor += 1;
            }
        }

        logic_tick += 1;
    }

    Ok(RankedDiamondRushOutcome {
        logic_tick,
        diamonds_caught,
        last_diamond_tick,
        finished_tick: evidence.finished_tick,
        duration_ms: duration_ms_from_ticks(evidence.finished_tick, spec.logic_fps),
    })
}
