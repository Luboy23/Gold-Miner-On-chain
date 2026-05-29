use std::collections::BTreeMap;

use alloy::primitives::B256;
use serde::{Deserialize, Serialize};

pub const RANKED_PROTOCOL_VERSION: u8 = 2;
pub const DEFAULT_SIMULATION_VERSION: u16 = 1;
pub const DEFAULT_LOGIC_FPS: u16 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeLevelSummary {
    pub level_id: String,
    pub version: u32,
    pub order: u32,
    pub content_hash: B256,
    pub challenge_seed: B256,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeSummary {
    pub challenge_id: String,
    pub version: u32,
    pub content_hash: B256,
    pub challenge_seed: B256,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeManifest {
    pub version: u16,
    pub generated_at: String,
    pub board_id: String,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub challenges: Vec<RankedChallengeManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeManifestEntry {
    #[serde(rename = "levelId")]
    pub challenge_id: String,
    pub version: u32,
    pub order: u32,
    pub content_hash: B256,
    pub challenge_seed: B256,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub is_current: bool,
    pub canonical: RankedChallengeCanonical,
}

impl RankedChallengeManifestEntry {
    pub fn summary(&self) -> RankedChallengeSummary {
        RankedChallengeSummary {
            challenge_id: self.challenge_id.clone(),
            version: self.version,
            content_hash: self.content_hash,
            challenge_seed: self.challenge_seed,
            simulation_version: self.simulation_version,
            logic_fps: self.logic_fps,
            time_limit_ticks: self.time_limit_ticks,
            is_current: self.is_current,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedManifest {
    pub version: u16,
    pub generated_at: String,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub levels: Vec<RankedManifestLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedManifestLevel {
    pub level_id: String,
    pub version: u32,
    pub order: u32,
    pub content_hash: B256,
    pub challenge_seed: B256,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
    pub goal: u32,
    pub canonical: RankedLevelCanonical,
}

impl RankedManifestLevel {
    pub fn summary(&self) -> ChallengeLevelSummary {
        ChallengeLevelSummary {
            level_id: self.level_id.clone(),
            version: self.version,
            order: self.order,
            content_hash: self.content_hash,
            challenge_seed: self.challenge_seed,
            simulation_version: self.simulation_version,
            logic_fps: self.logic_fps,
            time_limit_ticks: self.time_limit_ticks,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedLevelCanonical {
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
    pub goal: u32,
    pub constants: RankedSimulationConstants,
    pub entity_configs: BTreeMap<String, RankedEntityConfig>,
    pub level_definition: RankedLevelDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedChallengeCanonical {
    pub challenge_id: String,
    pub challenge_version: u32,
    pub simulation_version: u16,
    pub logic_fps: u16,
    pub time_limit_ticks: u32,
    pub board_kind: String,
    pub theme: String,
    pub constants: RankedSimulationConstants,
    pub entity_configs: BTreeMap<String, RankedEntityConfig>,
    pub spawn_points: Vec<RankedPoint>,
    pub spawn_policy: RankedSpawnPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RankedSpawnPolicy {
    pub cycle_size: u32,
    pub shuffle_algorithm: String,
    pub entity_type: String,
    pub allow_items: bool,
    pub allow_dynamite_action: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedSimulationConstants {
    pub hook_origin: RankedPoint,
    pub hook_collision_offset: f64,
    pub hook_min_angle: f64,
    pub hook_max_angle: f64,
    pub hook_rotate_speed: f64,
    pub hook_max_length: f64,
    pub hook_grab_speed: f64,
    pub hook_empty_return_speed: f64,
    pub hook_collision_radius: f64,
    pub hook_resolve_duration_sec: f64,
    pub question_bag_extra_dynamite_chance: f64,
    pub max_dynamite_count: u8,
    pub default_strength_multiplier: f64,
    pub max_strength_multiplier: f64,
    pub moving_entity_idle_duration_sec: f64,
    pub moving_entity_pixels_per_second: f64,
    pub moving_entity_turn_threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedEntityConfig {
    pub id: String,
    pub family: RankedEntityFamily,
    pub mass: f64,
    pub base_bonus: u32,
    pub bonus_tier: String,
    pub collision_radius: f64,
    pub catch_anchor: RankedCatchAnchor,
    pub display_size: RankedDisplaySize,
    pub random_bag: Option<RankedRandomBagConfig>,
    pub moving: Option<RankedMovingEntityConfig>,
    pub explosive: Option<RankedExplosiveEntityConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RankedEntityFamily {
    Static,
    RandomBag,
    Moving,
    Explosive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedCatchAnchor {
    pub x_ratio: f64,
    pub y_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedDisplaySize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedRandomBagConfig {
    pub mass_min: u32,
    pub mass_max: u32,
    pub bonus_base: u32,
    pub bonus_ratio_min: u32,
    pub bonus_ratio_max: u32,
    pub extra_effect_chance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedMovingEntityConfig {
    pub speed: f64,
    pub move_range: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedExplosiveEntityConfig {
    pub explosion_radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedLevelDefinition {
    pub id: String,
    pub group: u8,
    pub theme: String,
    pub entities: Vec<RankedLevelEntitySpawn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RankedLevelEntitySpawn {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub x: f64,
    pub y: f64,
    pub dir: Option<RankedMoveDirection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RankedMoveDirection {
    Left,
    Right,
}

pub fn find_manifest_level<'a>(
    manifest: &'a RankedManifest,
    level_id: &str,
    version: u32,
) -> Option<&'a RankedManifestLevel> {
    manifest
        .levels
        .iter()
        .find(|level| level.level_id == level_id && level.version == version)
}

pub fn find_ranked_challenge<'a>(
    manifest: &'a RankedChallengeManifest,
    challenge_id: &str,
    version: u32,
) -> Option<&'a RankedChallengeManifestEntry> {
    manifest
        .challenges
        .iter()
        .find(|challenge| challenge.challenge_id == challenge_id && challenge.version == version)
}
