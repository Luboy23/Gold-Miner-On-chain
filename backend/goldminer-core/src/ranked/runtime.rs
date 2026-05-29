//! ranked/runtime.rs 定义 deterministic 的局内运行时与 replay 基元。
//!
//! 这里承载两套相互关联但职责不同的模型：
//! - `RankedChallengeRuntime`：只服务 authoritative ranked 钻石挑战
//! - `RankedRuntime`：服务通用 ranked/campaign replay，包含 loadout、buff、炸药等完整账本
//!
//! 关键约束：
//! - tick 推进必须是确定性的，不能依赖渲染帧率
//! - `fireHook` 合法性由 hook 当前状态决定
//! - snapshot 只反映 runtime 当前真值，不允许在前端再补做本地判定
use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

use crate::ranked::manifest::{
    RankedChallengeManifestEntry, RankedEntityFamily, RankedManifestLevel, RankedMoveDirection,
    RankedPoint, RankedSimulationConstants,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankedSimulationOutcome {
    pub score: u32,
    pub dynamite_used: u8,
    pub dynamite_count: u8,
    pub caught_count: u16,
    pub cleared: bool,
    pub finished_tick: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedDiamondRushOutcome {
    pub logic_tick: u32,
    pub diamonds_caught: u32,
    pub last_diamond_tick: u32,
    pub finished_tick: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RankedChallengeHookState {
    Swinging,
    Extending,
    ReturningEmpty,
    ReturningLoaded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeEntitySnapshot {
    pub active: bool,
    pub caught: bool,
    pub collision_x: f64,
    pub collision_y: f64,
    pub collision_radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeRuntimeSnapshot {
    pub logic_tick: u32,
    pub hook_state: RankedChallengeHookState,
    pub hook_angle_deg: f64,
    pub hook_length: f64,
    pub caught_entity_index: Option<usize>,
    pub diamonds_caught: u32,
    pub last_diamond_tick: u32,
    pub spawn_cursor: usize,
    pub entities: Vec<RankedChallengeEntitySnapshot>,
}

#[derive(Debug, Clone)]
pub struct RankedChallengeRuntime {
    spec: RankedChallengeManifestEntry,
    frame_sec: f64,
    hook: HookRuntime,
    entities: Vec<EntityRuntime>,
    logic_tick: u32,
    diamonds_caught: u32,
    last_diamond_tick: u32,
    spawn_cursor: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SimulationBuffs {
    pub strength_drink: bool,
    pub lucky_clover: bool,
    pub rock_collectors_book: bool,
    pub gem_polish: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RankedSimulationLoadout {
    pub dynamite_count: u8,
    pub buffs: SimulationBuffs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CatchRewardKind {
    Money,
    Dynamite,
    Strength,
}

#[derive(Debug, Clone)]
pub(crate) struct CatchOutcome {
    pub bonus: u32,
    pub reward_kind: CatchRewardKind,
    pub dynamite_delta: u8,
    pub grants_strength_boost: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HookState {
    Swinging,
    Extending,
    ReturningEmpty,
    ReturningLoaded,
}

#[derive(Debug, Clone)]
pub(crate) struct HookRuntime {
    pub state: HookState,
    pub angle_deg: f64,
    pub length: f64,
    rotate_right: bool,
    pub caught_entity: Option<usize>,
}

impl HookRuntime {
    pub(crate) fn new(constants: &RankedSimulationConstants) -> Self {
        Self {
            state: HookState::Swinging,
            angle_deg: constants.hook_max_angle,
            length: 0.0,
            rotate_right: true,
            caught_entity: None,
        }
    }

    pub(crate) fn fire(&mut self) {
        // 上层在调用前必须已经验证当前处于 Swinging。
        // runtime 这里保持最小状态转移，不重复持有额外的输入缓冲语义。
        self.state = HookState::Extending;
    }

    pub(crate) fn can_use_dynamite(&self) -> bool {
        self.caught_entity.is_some() && self.state == HookState::ReturningLoaded
    }

    pub(crate) fn use_dynamite(&mut self, entities: &mut [EntityRuntime]) {
        if let Some(index) = self.caught_entity.take() {
            entities[index].active = false;
            entities[index].caught = false;
        }
        self.state = HookState::ReturningEmpty;
    }

    pub(crate) fn update(
        &mut self,
        frame_sec: f64,
        constants: &RankedSimulationConstants,
        entities: &mut [EntityRuntime],
        strength_multiplier: f64,
    ) -> Option<CatchOutcome> {
        // HookRuntime 的状态机必须保持封闭：
        // Swinging -> Extending -> ReturningEmpty/ReturningLoaded -> Swinging
        // 任何额外的状态旁路都会直接破坏 replay 与 authoritative snapshot 的一致性。
        match self.state {
            HookState::Swinging => {
                if (self.angle_deg - constants.hook_max_angle).abs() < 1.0 {
                    self.rotate_right = true;
                }
                if (self.angle_deg - constants.hook_min_angle).abs() < 1.0 {
                    self.rotate_right = false;
                }

                if self.rotate_right {
                    self.angle_deg -= frame_sec * constants.hook_rotate_speed;
                } else {
                    self.angle_deg += frame_sec * constants.hook_rotate_speed;
                }
                None
            }
            HookState::Extending => {
                self.length = (self.length + frame_sec * constants.hook_grab_speed)
                    .min(constants.hook_max_length);
                let (_, collision_center) = hook_points(self.angle_deg, self.length, constants);

                let mut hit_index = None;
                for (index, entity) in entities.iter().enumerate() {
                    if !entity.active || entity.caught {
                        continue;
                    }

                    if are_circles_overlapping(
                        entity.collision_x,
                        entity.collision_y,
                        entity.collision_radius,
                        collision_center.x,
                        collision_center.y,
                        constants.hook_collision_radius,
                    ) {
                        hit_index = Some(index);
                        break;
                    }
                }

                if let Some(index) = hit_index {
                    if let Some((blast_x, blast_y, radius)) =
                        entities[index].mark_exploded_if_needed()
                    {
                        apply_explosion(index, entities, blast_x, blast_y, radius);
                    }
                    entities[index].caught = true;
                    self.caught_entity = Some(index);
                    self.state = HookState::ReturningLoaded;
                    return None;
                }

                if self.length >= constants.hook_max_length {
                    self.state = HookState::ReturningEmpty;
                }

                None
            }
            HookState::ReturningEmpty => {
                self.length = (self.length - frame_sec * constants.hook_empty_return_speed).max(0.0);
                if self.length == 0.0 {
                    self.state = HookState::Swinging;
                    self.caught_entity = None;
                }
                None
            }
            HookState::ReturningLoaded => {
                let Some(index) = self.caught_entity else {
                    self.state = HookState::Swinging;
                    self.length = 0.0;
                    return None;
                };

                self.length = (self.length
                    - (frame_sec * constants.hook_grab_speed * strength_multiplier)
                        / entities[index].mass)
                    .max(0.0);

                if self.length == 0.0 {
                    let catch = entities[index].catch_outcome();
                    entities[index].active = false;
                    entities[index].caught = false;
                    self.caught_entity = None;
                    self.state = HookState::Swinging;
                    return Some(catch);
                }

                None
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct EntityRuntime {
    pub active: bool,
    pub caught: bool,
    pub collision_x: f64,
    pub collision_y: f64,
    pub collision_radius: f64,
    pub mass: f64,
    pub bonus: u32,
    pub reward_kind: CatchRewardKind,
    pub dynamite_delta: u8,
    pub grants_strength_boost: bool,
    pub kind: EntityRuntimeKind,
}

#[derive(Debug, Clone)]
pub(crate) enum EntityRuntimeKind {
    Static,
    Moving {
        direction_sign: f64,
        destination_x: f64,
        idle_ticks_remaining: u32,
        idle_ticks_per_turn: u32,
        is_moving: bool,
        move_speed: f64,
        move_range: f64,
    },
    Explosive {
        explosion_radius: f64,
        has_exploded: bool,
    },
}

impl EntityRuntime {
    pub(crate) fn update(&mut self, frame_sec: f64, constants: &RankedSimulationConstants) {
        if !self.active || self.caught {
            return;
        }

        let EntityRuntimeKind::Moving {
            direction_sign,
            destination_x,
            idle_ticks_remaining,
            idle_ticks_per_turn,
            is_moving,
            move_speed,
            move_range,
        } = &mut self.kind
        else {
            return;
        };

        if !*is_moving {
            if *idle_ticks_remaining > 0 {
                *idle_ticks_remaining -= 1;
            }
            if *idle_ticks_remaining == 0 {
                *is_moving = true;
                *idle_ticks_remaining = *idle_ticks_per_turn;
            }
            return;
        }

        let velocity = *move_speed * constants.moving_entity_pixels_per_second * frame_sec;
        let next_x = self.collision_x + (*direction_sign * velocity);
        let reached_destination = (next_x - *destination_x).abs()
            <= constants.moving_entity_turn_threshold
            || (*direction_sign < 0.0 && next_x <= *destination_x)
            || (*direction_sign > 0.0 && next_x >= *destination_x);

        if reached_destination {
            self.collision_x = *destination_x;
            *is_moving = false;
            *direction_sign *= -1.0;
            *destination_x = self.collision_x + (*direction_sign * *move_range);
            *idle_ticks_remaining = *idle_ticks_per_turn;
            return;
        }

        self.collision_x = next_x;
    }

    pub(crate) fn mark_exploded_if_needed(&mut self) -> Option<(f64, f64, f64)> {
        let EntityRuntimeKind::Explosive {
            explosion_radius,
            has_exploded,
        } = &mut self.kind
        else {
            return None;
        };

        if !self.active || *has_exploded {
            return None;
        }

        *has_exploded = true;
        Some((self.collision_x, self.collision_y, *explosion_radius))
    }

    pub(crate) fn catch_outcome(&self) -> CatchOutcome {
        CatchOutcome {
            bonus: self.bonus,
            reward_kind: self.reward_kind,
            dynamite_delta: self.dynamite_delta,
            grants_strength_boost: self.grants_strength_boost,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RankedRuntime {
    pub hook: HookRuntime,
    pub entities: Vec<EntityRuntime>,
    pub score: u32,
    pub dynamite_count: u8,
    pub dynamite_used: u8,
    pub caught_count: u16,
    pub strength_multiplier: f64,
    pub logic_tick: u32,
}

impl RankedRuntime {
    pub(crate) fn new_with_loadout(
        spec: &RankedManifestLevel,
        loadout: RankedSimulationLoadout,
    ) -> Result<Self> {
        Ok(Self {
            hook: HookRuntime::new(&spec.canonical.constants),
            entities: materialize_entities(spec, loadout.buffs)?,
            score: 0,
            dynamite_count: loadout
                .dynamite_count
                .min(spec.canonical.constants.max_dynamite_count),
            dynamite_used: 0,
            caught_count: 0,
            strength_multiplier: spec.canonical.constants.default_strength_multiplier,
            logic_tick: 0,
        })
    }
}

impl From<HookState> for RankedChallengeHookState {
    fn from(value: HookState) -> Self {
        match value {
            HookState::Swinging => Self::Swinging,
            HookState::Extending => Self::Extending,
            HookState::ReturningEmpty => Self::ReturningEmpty,
            HookState::ReturningLoaded => Self::ReturningLoaded,
        }
    }
}

impl RankedChallengeRuntime {
    pub fn new(spec: &RankedChallengeManifestEntry) -> Result<Self> {
        if spec.canonical.spawn_policy.entity_type != "Diamond" {
            bail!("ranked challenge spawn policy must use Diamond");
        }
        if spec.canonical.spawn_policy.allow_items || spec.canonical.spawn_policy.allow_dynamite_action
        {
            bail!("ranked challenge spawn policy must disable items and dynamite");
        }

        let first_point = next_ranked_spawn_point(spec, 0)?;
        let first_entity = spawn_ranked_diamond(spec, first_point)?;

        Ok(Self {
            spec: spec.clone(),
            frame_sec: 1.0 / f64::from(spec.logic_fps.max(1)),
            hook: HookRuntime::new(&spec.canonical.constants),
            entities: vec![first_entity],
            logic_tick: 0,
            diamonds_caught: 0,
            last_diamond_tick: 0,
            spawn_cursor: 1,
        })
    }

    pub fn apply_fire_hook(&mut self, tick: u32) -> Result<bool> {
        // 约束：authoritative 输入必须显式携带当前 logicTick，
        // 防止前端把“上一 tick 的输入”或“未来 tick 的输入”插进 replay 窗口。
        if tick != self.logic_tick {
            bail!("fireHook tick does not match current logicTick");
        }
        if self.hook.state != HookState::Swinging {
            bail!("fireHook is only legal while the hook is swinging");
        }
        self.hook.fire();
        Ok(true)
    }

    pub fn step(&mut self) -> Result<()> {
        // step 是 authoritative ranked 的最小时间推进单位。
        // 一个逻辑 tick 内，先推进 hook，再推进实体，再结算 catch，最后递增 logicTick。
        if self.logic_tick >= self.spec.time_limit_ticks {
            bail!("ranked challenge runtime exceeded timeLimitTicks");
        }

        let catch = self.hook.update(
            self.frame_sec,
            &self.spec.canonical.constants,
            &mut self.entities,
            self.spec.canonical.constants.default_strength_multiplier,
        );

        for entity in self.entities.iter_mut() {
            entity.update(self.frame_sec, &self.spec.canonical.constants);
        }

        if catch.is_some() {
            self.diamonds_caught = self.diamonds_caught.saturating_add(1);
            self.last_diamond_tick = self.logic_tick.saturating_add(1);
            self.entities.retain(|entity| entity.active);
            if self.logic_tick.saturating_add(1) < self.spec.time_limit_ticks {
                self.entities.push(spawn_ranked_diamond(
                    &self.spec,
                    next_ranked_spawn_point(&self.spec, self.spawn_cursor)?,
                )?);
                self.spawn_cursor += 1;
            }
        }

        self.logic_tick += 1;
        Ok(())
    }

    pub fn advance_elapsed_ticks(&mut self, ticks: u32) -> Result<()> {
        // 背景 elapsed 不会“跳过中间状态”，而是循环复用 step。
        // 这样回焦后的最终快照与正常逐 tick 前进保持同一真值定义。
        for _ in 0..ticks {
          if self.logic_tick >= self.spec.time_limit_ticks {
              break;
          }
          self.step()?;
        }

        Ok(())
    }

    pub fn snapshot(&self) -> RankedChallengeRuntimeSnapshot {
        // snapshot 是前端镜像 authoritative 真值的唯一来源。
        // 调用方应当直接同步 hook / entities / caughtCount，而不是再本地二次推导。
        RankedChallengeRuntimeSnapshot {
            logic_tick: self.logic_tick,
            hook_state: self.hook.state.into(),
            hook_angle_deg: self.hook.angle_deg,
            hook_length: self.hook.length,
            caught_entity_index: self.hook.caught_entity,
            diamonds_caught: self.diamonds_caught,
            last_diamond_tick: self.last_diamond_tick,
            spawn_cursor: self.spawn_cursor,
            entities: self
                .entities
                .iter()
                .map(|entity| RankedChallengeEntitySnapshot {
                    active: entity.active,
                    caught: entity.caught,
                    collision_x: entity.collision_x,
                    collision_y: entity.collision_y,
                    collision_radius: entity.collision_radius,
                })
                .collect(),
        }
    }

    pub fn finalize(&self) -> RankedDiamondRushOutcome {
        RankedDiamondRushOutcome {
            logic_tick: self.logic_tick,
            diamonds_caught: self.diamonds_caught,
            last_diamond_tick: self.last_diamond_tick,
            finished_tick: self.logic_tick,
            duration_ms: duration_ms_from_ticks(self.logic_tick, self.spec.logic_fps),
        }
    }
}

pub fn duration_ms_from_ticks(finished_tick: u32, logic_fps: u16) -> u32 {
    ((u64::from(finished_tick) * 1_000) / u64::from(logic_fps.max(1))) as u32
}

pub(crate) fn materialize_entities(
    spec: &RankedManifestLevel,
    buffs: SimulationBuffs,
) -> Result<Vec<EntityRuntime>> {
    let mut bag_index = 0usize;
    let idle_ticks_per_turn = (spec.canonical.constants.moving_entity_idle_duration_sec
        * f64::from(spec.logic_fps))
    .round() as u32;

    spec.canonical
        .level_definition
        .entities
        .iter()
        .map(|spawn| {
            let config = spec
                .canonical
                .entity_configs
                .get(&spawn.entity_type)
                .ok_or_else(|| anyhow!("missing entity config for {}", spawn.entity_type))?;

            let mut mass = config.mass;
            let mut bonus = config.base_bonus;
            let mut reward_kind = CatchRewardKind::Money;
            let mut dynamite_delta = 0u8;
            let mut grants_strength_boost = false;

            if config.family == RankedEntityFamily::RandomBag {
                let random_bag = config
                    .random_bag
                    .as_ref()
                    .ok_or_else(|| anyhow!("missing randomBag config for {}", config.id))?;
                let mut rng = RankedRng::new(&format!(
                    "{:#x}:bag:{}:{}",
                    spec.challenge_seed, spec.level_id, bag_index
                ));
                bag_index += 1;

                let mass_base = rng.next_int(random_bag.mass_min, random_bag.mass_max) as f64;
                let bonus_base = rng
                    .next_int(random_bag.bonus_ratio_min, random_bag.bonus_ratio_max)
                    .saturating_mul(random_bag.bonus_base);
                let extra_effect_chance = random_bag.extra_effect_chance
                    * if buffs.lucky_clover { 2.0 } else { 1.0 };
                let has_extra_effect = rng.next() <= extra_effect_chance.min(1.0);

                mass = if buffs.strength_drink { mass_base / 1.5 } else { mass_base };
                bonus = bonus_base;

                if has_extra_effect {
                    bonus = 0;
                    if rng.next() <= spec.canonical.constants.question_bag_extra_dynamite_chance {
                        reward_kind = CatchRewardKind::Dynamite;
                        dynamite_delta = 1;
                    } else {
                        reward_kind = CatchRewardKind::Strength;
                        grants_strength_boost = true;
                    }
                }
            }

            if buffs.strength_drink && config.family != RankedEntityFamily::RandomBag {
                mass /= 1.5;
            }

            if buffs.rock_collectors_book
                && matches!(config.id.as_str(), "MiniRock" | "NormalRock" | "BigRock")
            {
                bonus = bonus.saturating_mul(3);
            }

            if buffs.gem_polish && config.id == "Diamond" {
                bonus = ((f64::from(bonus) * 1.5).round()) as u32;
            }

            if buffs.gem_polish && config.id == "MoleWithDiamond" {
                let mole_bonus = spec
                    .canonical
                    .entity_configs
                    .get("Mole")
                    .map(|mole| mole.base_bonus)
                    .unwrap_or(0);
                let diamond_part = bonus.saturating_sub(mole_bonus);
                bonus = ((f64::from(diamond_part) * 1.5).round()) as u32 + mole_bonus;
            }

            let (collision_x, collision_y) = match config.family {
                RankedEntityFamily::Moving => (spawn.x, spawn.y),
                RankedEntityFamily::Static
                | RankedEntityFamily::RandomBag
                | RankedEntityFamily::Explosive => (
                    spawn.x + config.display_size.width / 2.0,
                    spawn.y + config.display_size.height / 2.0,
                ),
            };

            let kind = match config.family {
                RankedEntityFamily::Static | RankedEntityFamily::RandomBag => {
                    EntityRuntimeKind::Static
                }
                RankedEntityFamily::Moving => {
                    let moving = config
                        .moving
                        .as_ref()
                        .ok_or_else(|| anyhow!("missing moving config for {}", config.id))?;
                    let direction_sign =
                        match spawn.dir.clone().unwrap_or(RankedMoveDirection::Left) {
                            RankedMoveDirection::Left => -1.0,
                            RankedMoveDirection::Right => 1.0,
                        };
                    EntityRuntimeKind::Moving {
                        direction_sign,
                        destination_x: spawn.x + direction_sign * moving.move_range,
                        idle_ticks_remaining: idle_ticks_per_turn,
                        idle_ticks_per_turn,
                        is_moving: true,
                        move_speed: moving.speed,
                        move_range: moving.move_range,
                    }
                }
                RankedEntityFamily::Explosive => {
                    let explosive = config
                        .explosive
                        .as_ref()
                        .ok_or_else(|| anyhow!("missing explosive config for {}", config.id))?;
                    EntityRuntimeKind::Explosive {
                        explosion_radius: explosive.explosion_radius,
                        has_exploded: false,
                    }
                }
            };

            Ok(EntityRuntime {
                active: true,
                caught: false,
                collision_x,
                collision_y,
                collision_radius: config.collision_radius,
                mass,
                bonus,
                reward_kind,
                dynamite_delta,
                grants_strength_boost,
                kind,
            })
        })
        .collect()
}

pub(crate) fn spawn_ranked_diamond(
    spec: &RankedChallengeManifestEntry,
    point: RankedPoint,
) -> Result<EntityRuntime> {
    let config = spec
        .canonical
        .entity_configs
        .get("Diamond")
        .ok_or_else(|| anyhow!("missing Diamond entity config for ranked challenge"))?;
    if config.family != RankedEntityFamily::Static {
        bail!("ranked Diamond config must be static");
    }

    Ok(EntityRuntime {
        active: true,
        caught: false,
        collision_x: point.x + config.display_size.width / 2.0,
        collision_y: point.y + config.display_size.height / 2.0,
        collision_radius: config.collision_radius,
        mass: config.mass,
        bonus: config.base_bonus,
        reward_kind: CatchRewardKind::Money,
        dynamite_delta: 0,
        grants_strength_boost: false,
        kind: EntityRuntimeKind::Static,
    })
}

pub(crate) fn next_ranked_spawn_point(
    spec: &RankedChallengeManifestEntry,
    cursor: usize,
) -> Result<RankedPoint> {
    let cycle_size = spec.canonical.spawn_points.len();
    if cycle_size == 0 {
        bail!("ranked challenge spawnPoints must not be empty");
    }
    let cycle_index = cursor / cycle_size;
    let index_in_cycle = cursor % cycle_size;
    let cycle = ranked_spawn_cycle(spec, cycle_index)?;
    Ok(cycle[index_in_cycle].clone())
}

pub(crate) fn ranked_spawn_cycle(
    spec: &RankedChallengeManifestEntry,
    cycle_index: usize,
) -> Result<Vec<RankedPoint>> {
    let mut cycle = spec.canonical.spawn_points.clone();
    let mut rng = RankedRng::new(&format!("{:#x}:cycle:{}", spec.challenge_seed, cycle_index));

    for index in (1..cycle.len()).rev() {
        let swap_index = rng.next_int(0, u32::try_from(index).unwrap_or(0)) as usize;
        cycle.swap(index, swap_index);
    }

    if cycle_index > 0 && cycle.len() > 1 {
        let previous_cycle = ranked_spawn_cycle(spec, cycle_index - 1)?;
        let previous_last = previous_cycle
            .last()
            .ok_or_else(|| anyhow!("ranked challenge previous cycle is empty"))?;
        if cycle[0] == *previous_last {
            cycle.swap(0, 1);
        }
    }

    Ok(cycle)
}

pub(crate) fn are_circles_overlapping(
    ax: f64,
    ay: f64,
    ar: f64,
    bx: f64,
    by: f64,
    br: f64,
) -> bool {
    let dx = ax - bx;
    let dy = ay - by;
    let radius = ar + br;
    dx * dx + dy * dy <= radius * radius
}

pub(crate) fn apply_explosion(
    index: usize,
    entities: &mut [EntityRuntime],
    blast_x: f64,
    blast_y: f64,
    radius: f64,
) {
    for (other_index, entity) in entities.iter_mut().enumerate() {
        if other_index == index || !entity.active {
            continue;
        }

        if are_circles_overlapping(
            blast_x,
            blast_y,
            radius,
            entity.collision_x,
            entity.collision_y,
            entity.collision_radius,
        ) {
            entity.active = false;
            entity.caught = false;
        }
    }
}

pub(crate) fn hook_points(
    angle_deg: f64,
    length: f64,
    constants: &RankedSimulationConstants,
) -> (RankedPoint, RankedPoint) {
    let angle_rad = angle_deg.to_radians();
    let direction_x = -angle_rad.sin();
    let direction_y = angle_rad.cos();

    (
        RankedPoint {
            x: constants.hook_origin.x + direction_x * length,
            y: constants.hook_origin.y + direction_y * length,
        },
        RankedPoint {
            x: constants.hook_origin.x + direction_x * (length + constants.hook_collision_offset),
            y: constants.hook_origin.y + direction_y * (length + constants.hook_collision_offset),
        },
    )
}

#[derive(Debug, Clone)]
pub(crate) struct RankedRng {
    state: u32,
}

impl RankedRng {
    pub(crate) fn new(seed: &str) -> Self {
        Self {
            state: xmur3_once(seed),
        }
    }

    pub(crate) fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut result = (self.state ^ (self.state >> 15)).wrapping_mul(self.state | 1);
        result ^= result.wrapping_add((result ^ (result >> 7)).wrapping_mul(result | 61));
        let value = result ^ (result >> 14);
        f64::from(value) / 4_294_967_296.0
    }

    pub(crate) fn next_int(&mut self, min_inclusive: u32, max_inclusive: u32) -> u32 {
        let range = max_inclusive - min_inclusive + 1;
        (self.next() * f64::from(range)).floor() as u32 + min_inclusive
    }
}

pub(crate) fn xmur3_once(seed: &str) -> u32 {
    let mut hash = 1_779_033_703u32 ^ u32::try_from(seed.len()).unwrap_or(0);

    for value in seed.bytes() {
        hash = (hash ^ u32::from(value)).wrapping_mul(3_432_918_353);
        hash = hash.rotate_left(13);
    }

    hash = (hash ^ (hash >> 16)).wrapping_mul(2_246_822_507);
    hash = (hash ^ (hash >> 13)).wrapping_mul(3_266_489_909);
    hash ^ (hash >> 16)
}
