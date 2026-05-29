use std::collections::BTreeMap;

use alloy::primitives::B256;
use serde::Deserialize;

use crate::{build_run_id, RankedActionKind, RankedRunAction, RankedRunEvidenceV2, RankedRunSummary};

use super::manifest::{
    RankedCatchAnchor, RankedChallengeCanonical, RankedChallengeManifestEntry, RankedDisplaySize,
    RankedEntityConfig, RankedEntityFamily, RankedLevelCanonical, RankedLevelDefinition,
    RankedLevelEntitySpawn, RankedManifestLevel, RankedPoint, RankedSimulationConstants,
    RankedSpawnPolicy,
};
use super::replay::simulate_ranked_run;
use super::runtime::{
    apply_explosion, duration_ms_from_ticks, EntityRuntime, EntityRuntimeKind, HookRuntime,
    HookState, RankedRng,
};
use super::{DEFAULT_LOGIC_FPS, DEFAULT_SIMULATION_VERSION, RANKED_PROTOCOL_VERSION};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    spec: RankedManifestLevel,
    evidence: RankedRunEvidenceV2,
    expected: GoldenExpected,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenExpected {
    score: u32,
    dynamite_used: u8,
    caught_count: u16,
    cleared: bool,
    finished_tick: u32,
    duration_ms: u32,
}

fn base_constants() -> RankedSimulationConstants {
    RankedSimulationConstants {
        hook_origin: RankedPoint { x: 158.0, y: 30.0 },
        hook_collision_offset: 13.0,
        hook_min_angle: -75.0,
        hook_max_angle: 75.0,
        hook_rotate_speed: 65.0,
        hook_max_length: 230.0,
        hook_grab_speed: 100.0,
        hook_empty_return_speed: 180.0,
        hook_collision_radius: 6.0,
        hook_resolve_duration_sec: 1.0,
        question_bag_extra_dynamite_chance: 0.2,
        max_dynamite_count: 12,
        default_strength_multiplier: 1.0,
        max_strength_multiplier: 6.0,
        moving_entity_idle_duration_sec: 1.0,
        moving_entity_pixels_per_second: 60.0,
        moving_entity_turn_threshold: 1.0,
    }
}

fn entity_config(id: &str, family: RankedEntityFamily) -> RankedEntityConfig {
    RankedEntityConfig {
        id: id.to_string(),
        family,
        mass: 2.0,
        base_bonus: 100,
        bonus_tier: "normal".to_string(),
        collision_radius: 8.0,
        catch_anchor: RankedCatchAnchor {
            x_ratio: 0.5,
            y_ratio: 0.5,
        },
        display_size: RankedDisplaySize {
            width: 20.0,
            height: 20.0,
        },
        random_bag: None,
        moving: None,
        explosive: None,
    }
}

fn base_level(entity_type: &str, x: f64, y: f64) -> RankedManifestLevel {
    let mut entity_configs = BTreeMap::new();
    entity_configs.insert(
        entity_type.to_string(),
        entity_config(entity_type, RankedEntityFamily::Static),
    );
    RankedManifestLevel {
        level_id: "L1".to_string(),
        version: 1,
        order: 1,
        content_hash: B256::from_slice(&[1u8; 32]),
        challenge_seed: B256::from_slice(&[2u8; 32]),
        simulation_version: 1,
        logic_fps: 60,
        time_limit_ticks: 240,
        goal: 100,
        canonical: RankedLevelCanonical {
            simulation_version: 1,
            logic_fps: 60,
            time_limit_ticks: 240,
            goal: 100,
            constants: base_constants(),
            entity_configs,
            level_definition: RankedLevelDefinition {
                id: "L1".to_string(),
                group: 1,
                theme: "LevelA".to_string(),
                entities: vec![RankedLevelEntitySpawn {
                    entity_type: entity_type.to_string(),
                    x,
                    y,
                    dir: None,
                }],
            },
        },
    }
}

fn evidence_for(
    spec: &RankedManifestLevel,
    actions: Vec<(RankedActionKind, u32)>,
    finished_tick: u32,
) -> RankedRunEvidenceV2 {
    RankedRunEvidenceV2 {
        protocol_version: RANKED_PROTOCOL_VERSION,
        simulation_version: spec.simulation_version,
        session_id: B256::from_slice(&[3u8; 32]),
        season_id: 1,
        level_id: spec.level_id.clone(),
        level_version: spec.version,
        level_content_hash: spec.content_hash,
        challenge_seed: spec.challenge_seed,
        client_build_hash: B256::from_slice(&[4u8; 32]),
        logic_fps: spec.logic_fps,
        finished_tick,
        actions: actions
            .into_iter()
            .map(|(kind, tick)| RankedRunAction { kind, tick })
            .collect(),
        summary: RankedRunSummary {
            score: 0,
            dynamite_used: 0,
            caught_count: 0,
            cleared: false,
        },
    }
}

fn fire_tick_for_hit(spec: &RankedManifestLevel) -> u32 {
    for tick in 0..spec.time_limit_ticks {
        let mut evidence = evidence_for(
            spec,
            vec![(RankedActionKind::FireHook, tick)],
            spec.time_limit_ticks,
        );
        let outcome = simulate_ranked_run(&evidence, spec).expect("simulate");
        if outcome.score > 0 {
            evidence.summary.score = outcome.score;
            evidence.summary.dynamite_used = outcome.dynamite_used;
            evidence.summary.caught_count = outcome.caught_count;
            evidence.summary.cleared = outcome.cleared;
            return tick;
        }
    }
    panic!("failed to find a hitting fire tick");
}

fn load_question_bag_golden_fixture() -> GoldenFixture {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../frontend/src/test-fixtures/ranked-golden-question-bag.json");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read golden fixture {}: {error}", path.display()));
    serde_json::from_str(&source)
        .unwrap_or_else(|error| panic!("parse golden fixture {}: {error}", path.display()))
}

#[test]
fn rng_is_deterministic_for_question_bag() {
    let mut first = RankedRng::new("0x1234:bag:L1:0");
    let mut second = RankedRng::new("0x1234:bag:L1:0");

    assert_eq!(first.next_int(1, 9), second.next_int(1, 9));
    assert_eq!(first.next_int(1, 16), second.next_int(1, 16));
    assert!((first.next() - second.next()).abs() < f64::EPSILON);
}

#[test]
fn rng_matches_frontend_question_bag_seed() {
    let mut rng = RankedRng::new(
        "0x0202020202020202020202020202020202020202020202020202020202020202:bag:L1:0",
    );

    assert_eq!(rng.next_int(1, 9), 9);
    assert_eq!(rng.next_int(1, 16), 6);
    assert!((rng.next() - 0.464_691_563_975_065_95).abs() < f64::EPSILON);
}

#[test]
fn shared_question_bag_golden_fixture_replays() {
    let fixture = load_question_bag_golden_fixture();
    assert_eq!(
        fire_tick_for_hit(&fixture.spec),
        fixture.evidence.actions[0].tick
    );
    let outcome = simulate_ranked_run(&fixture.evidence, &fixture.spec).expect("simulate fixture");

    assert_eq!(outcome.score, fixture.expected.score);
    assert_eq!(outcome.dynamite_used, fixture.expected.dynamite_used);
    assert_eq!(outcome.caught_count, fixture.expected.caught_count);
    assert_eq!(outcome.cleared, fixture.expected.cleared);
    assert_eq!(outcome.finished_tick, fixture.expected.finished_tick);
    assert_eq!(outcome.duration_ms, fixture.expected.duration_ms);
}

#[test]
fn advance_elapsed_ticks_matches_repeated_step_without_inputs() {
    let challenge = RankedChallengeManifestEntry {
        challenge_id: "ranked/diamond-rush".to_string(),
        version: 1,
        order: 1,
        content_hash: B256::from_slice(&[7u8; 32]),
        challenge_seed: B256::from_slice(&[8u8; 32]),
        simulation_version: DEFAULT_SIMULATION_VERSION,
        logic_fps: DEFAULT_LOGIC_FPS,
        time_limit_ticks: 120,
        enabled: true,
        is_current: true,
        canonical: RankedChallengeCanonical {
            challenge_id: "ranked/diamond-rush".to_string(),
            challenge_version: 1,
            simulation_version: DEFAULT_SIMULATION_VERSION,
            logic_fps: DEFAULT_LOGIC_FPS,
            time_limit_ticks: 120,
            board_kind: "ranked".to_string(),
            theme: "LevelD".to_string(),
            constants: base_constants(),
            entity_configs: {
                let mut entity_configs = BTreeMap::new();
                entity_configs.insert(
                    "Diamond".to_string(),
                    entity_config("Diamond", RankedEntityFamily::Static),
                );
                entity_configs
            },
            spawn_points: vec![
                RankedPoint { x: 200.0, y: 70.0 },
                RankedPoint { x: 210.0, y: 70.0 },
            ],
            spawn_policy: RankedSpawnPolicy {
                cycle_size: 2,
                shuffle_algorithm: "xmur3-mulberry32".to_string(),
                entity_type: "Diamond".to_string(),
                allow_items: false,
                allow_dynamite_action: false,
            },
        },
    };
    let mut stepped = super::runtime::RankedChallengeRuntime::new(&challenge)
    .expect("runtime");
    let mut elapsed = stepped.clone();

    for _ in 0..120 {
        stepped.step().expect("step");
    }

    elapsed
        .advance_elapsed_ticks(120)
        .expect("advance elapsed ticks");

    assert_eq!(elapsed.snapshot(), stepped.snapshot());
    assert_eq!(elapsed.finalize(), stepped.finalize());
}

#[test]
fn moving_entity_turns_after_reaching_destination() {
    let mut entity = EntityRuntime {
        active: true,
        caught: false,
        collision_x: 10.0,
        collision_y: 100.0,
        collision_radius: 8.0,
        mass: 1.5,
        bonus: 2,
        reward_kind: super::runtime::CatchRewardKind::Money,
        dynamite_delta: 0,
        grants_strength_boost: false,
        kind: EntityRuntimeKind::Moving {
            direction_sign: 1.0,
            destination_x: 11.0,
            idle_ticks_remaining: 60,
            idle_ticks_per_turn: 60,
            is_moving: true,
            move_speed: 1.0,
            move_range: 135.0,
        },
    };

    entity.update(1.0 / 60.0, &base_constants());

    match entity.kind {
        EntityRuntimeKind::Moving {
            direction_sign,
            destination_x,
            is_moving,
            ..
        } => {
            assert_eq!(entity.collision_x, 11.0);
            assert!(!is_moving);
            assert_eq!(direction_sign, -1.0);
            assert_eq!(destination_x, -124.0);
        }
        _ => panic!("expected moving entity"),
    }
}

#[test]
fn explosive_entity_destroys_nearby_entities() {
    let explosive = EntityRuntime {
        active: true,
        caught: false,
        collision_x: 100.0,
        collision_y: 100.0,
        collision_radius: 10.0,
        mass: 1.0,
        bonus: 2,
        reward_kind: super::runtime::CatchRewardKind::Money,
        dynamite_delta: 0,
        grants_strength_boost: false,
        kind: EntityRuntimeKind::Explosive {
            explosion_radius: 50.0,
            has_exploded: false,
        },
    };
    let nearby = EntityRuntime {
        active: true,
        caught: false,
        collision_x: 120.0,
        collision_y: 100.0,
        collision_radius: 10.0,
        mass: 2.0,
        bonus: 10,
        reward_kind: super::runtime::CatchRewardKind::Money,
        dynamite_delta: 0,
        grants_strength_boost: false,
        kind: EntityRuntimeKind::Static,
    };
    let distant = EntityRuntime {
        collision_x: 300.0,
        ..nearby.clone()
    };
    let mut entities = vec![explosive.clone(), nearby, distant];

    let (blast_x, blast_y, radius) = entities[0]
        .mark_exploded_if_needed()
        .expect("expected explosive blast");
    apply_explosion(0, &mut entities, blast_x, blast_y, radius);

    assert!(!entities[1].active);
    assert!(entities[2].active);
    assert!(entities[0].mark_exploded_if_needed().is_none());
}

#[test]
fn validate_fire_tick_produces_deterministic_score() {
    let spec = base_level("MiniGold", 150.0, 120.0);
    let fire_tick = fire_tick_for_hit(&spec);
    let mut evidence = evidence_for(
        &spec,
        vec![(RankedActionKind::FireHook, fire_tick)],
        spec.time_limit_ticks,
    );
    let outcome = simulate_ranked_run(&evidence, &spec).expect("simulate outcome");

    evidence.summary.score = outcome.score;
    evidence.summary.dynamite_used = outcome.dynamite_used;
    evidence.summary.caught_count = outcome.caught_count;
    evidence.summary.cleared = outcome.cleared;

    let evidence_hash =
        alloy::primitives::keccak256(serde_json::to_vec(&evidence).expect("serialize evidence"));
    let level_id = crate::parse_level_id(&evidence.level_id).expect("parse level id");
    let run_id = build_run_id(
        evidence.session_id,
        level_id,
        evidence.level_version,
        evidence_hash,
    );

    assert_eq!(outcome.score, 100);
    assert_eq!(outcome.caught_count, 1);
    assert!(outcome.cleared);
    assert_ne!(run_id, B256::ZERO);
}

#[test]
fn use_dynamite_enters_empty_return_without_resetting_hook_length() {
    let mut hook = HookRuntime::new(&base_constants());
    let mut entities = vec![EntityRuntime {
        active: true,
        caught: true,
        collision_x: 150.0,
        collision_y: 120.0,
        collision_radius: 8.0,
        mass: 2.0,
        bonus: 100,
        reward_kind: super::runtime::CatchRewardKind::Money,
        dynamite_delta: 0,
        grants_strength_boost: false,
        kind: EntityRuntimeKind::Static,
    }];

    hook.state = HookState::ReturningLoaded;
    hook.angle_deg = 22.0;
    hook.length = 96.0;
    hook.caught_entity = Some(0);

    hook.use_dynamite(&mut entities);

    assert_eq!(hook.state, HookState::ReturningEmpty);
    assert_eq!(hook.angle_deg, 22.0);
    assert_eq!(hook.length, 96.0);
    assert!(hook.caught_entity.is_none());
    assert!(!entities[0].active);
    assert!(!entities[0].caught);
}

#[test]
fn simulate_rejects_unsorted_action_ticks() {
    let spec = base_level("MiniGold", 150.0, 120.0);
    let evidence = evidence_for(
        &spec,
        vec![
            (RankedActionKind::FireHook, 10),
            (RankedActionKind::UseDynamite, 10),
        ],
        spec.time_limit_ticks,
    );

    let error = simulate_ranked_run(&evidence, &spec).expect_err("expected unsorted tick error");
    assert!(error.to_string().contains("strictly increasing"));
}

#[test]
fn simulate_rejects_illegal_dynamite_use() {
    let spec = base_level("MiniGold", 150.0, 120.0);
    let evidence = evidence_for(
        &spec,
        vec![(RankedActionKind::UseDynamite, 5)],
        spec.time_limit_ticks,
    );

    let error = simulate_ranked_run(&evidence, &spec).expect_err("expected illegal dynamite error");
    assert!(error.to_string().contains("available dynamite"));
}

#[test]
fn challenge_runtime_finalize_duration_matches_logic_ticks() {
    let challenge = RankedChallengeManifestEntry {
        challenge_id: "ranked/diamond-rush".to_string(),
        version: 1,
        order: 1,
        content_hash: B256::from_slice(&[7u8; 32]),
        challenge_seed: B256::from_slice(&[8u8; 32]),
        simulation_version: DEFAULT_SIMULATION_VERSION,
        logic_fps: DEFAULT_LOGIC_FPS,
        time_limit_ticks: 120,
        enabled: true,
        is_current: true,
        canonical: RankedChallengeCanonical {
            challenge_id: "ranked/diamond-rush".to_string(),
            challenge_version: 1,
            simulation_version: DEFAULT_SIMULATION_VERSION,
            logic_fps: DEFAULT_LOGIC_FPS,
            time_limit_ticks: 120,
            board_kind: "ranked".to_string(),
            theme: "LevelD".to_string(),
            constants: base_constants(),
            entity_configs: {
                let mut entity_configs = BTreeMap::new();
                entity_configs.insert(
                    "Diamond".to_string(),
                    entity_config("Diamond", RankedEntityFamily::Static),
                );
                entity_configs
            },
            spawn_points: vec![
                RankedPoint { x: 144.0, y: 120.0 },
                RankedPoint { x: 176.0, y: 120.0 },
            ],
            spawn_policy: RankedSpawnPolicy {
                cycle_size: 2,
                shuffle_algorithm: "xmur3-mulberry32".to_string(),
                entity_type: "Diamond".to_string(),
                allow_items: false,
                allow_dynamite_action: false,
            },
        },
    };

    let runtime = super::runtime::RankedChallengeRuntime::new(&challenge).expect("runtime");
    let finalized = runtime.finalize();
    assert_eq!(finalized.logic_tick, 0);
    assert_eq!(finalized.duration_ms, duration_ms_from_ticks(0, DEFAULT_LOGIC_FPS));
}
