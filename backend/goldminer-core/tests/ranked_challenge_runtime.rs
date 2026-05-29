use alloy::primitives::B256;
use goldminer_core::{
    RankedChallengeCanonical, RankedChallengeManifestEntry, RankedChallengeRuntime,
    RankedDisplaySize, RankedEntityConfig, RankedEntityFamily, RankedPoint, RankedRunAction,
    RankedRunEvidenceV3, RankedRunSummaryV3, RankedSimulationConstants, RankedSpawnPolicy,
    simulate_diamond_rush_run,
};
use std::collections::BTreeMap;

fn sample_spec() -> RankedChallengeManifestEntry {
    let mut entity_configs = BTreeMap::new();
    entity_configs.insert(
        "Diamond".to_string(),
        RankedEntityConfig {
            id: "Diamond".to_string(),
            family: RankedEntityFamily::Static,
            mass: 1.5,
            base_bonus: 600,
            bonus_tier: "high".to_string(),
            collision_radius: 6.0,
            catch_anchor: goldminer_core::RankedCatchAnchor {
                x_ratio: 0.5,
                y_ratio: 1.0 / 3.0,
            },
            display_size: RankedDisplaySize {
                width: 10.0,
                height: 8.0,
            },
            random_bag: None,
            moving: None,
            explosive: None,
        },
    );

    RankedChallengeManifestEntry {
        challenge_id: "diamond_rush_60".to_string(),
        version: 1,
        order: 1,
        content_hash: B256::from_slice(&[7u8; 32]),
        challenge_seed: B256::from_slice(&[8u8; 32]),
        simulation_version: 1,
        logic_fps: 60,
        time_limit_ticks: 120,
        enabled: true,
        is_current: true,
        canonical: RankedChallengeCanonical {
            challenge_id: "diamond_rush_60".to_string(),
            challenge_version: 1,
            simulation_version: 1,
            logic_fps: 60,
            time_limit_ticks: 120,
            board_kind: "ranked".to_string(),
            theme: "LevelD".to_string(),
            constants: RankedSimulationConstants {
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
            },
            entity_configs,
            spawn_points: vec![
                RankedPoint { x: 56.0, y: 72.0 },
                RankedPoint { x: 106.0, y: 86.0 },
                RankedPoint { x: 214.0, y: 78.0 },
            ],
            spawn_policy: RankedSpawnPolicy {
                cycle_size: 3,
                shuffle_algorithm: "seeded-cycle-no-repeat".to_string(),
                entity_type: "Diamond".to_string(),
                allow_items: false,
                allow_dynamite_action: false,
            },
        },
    }
}

#[test]
fn ranked_challenge_runtime_tracks_ticks_and_snapshots() {
    let spec = sample_spec();
    let mut runtime = RankedChallengeRuntime::new(&spec).expect("runtime should initialize");

    let initial = runtime.snapshot();
    assert_eq!(initial.logic_tick, 0);
    assert_eq!(initial.diamonds_caught, 0);
    assert_eq!(initial.entities.len(), 1);

    runtime.step().expect("step should succeed");
    let next = runtime.snapshot();
    assert_eq!(next.logic_tick, 1);
}

#[test]
fn ranked_challenge_runtime_finalize_matches_replay_with_no_actions() {
    let spec = sample_spec();
    let mut runtime = RankedChallengeRuntime::new(&spec).expect("runtime should initialize");

    while runtime.snapshot().logic_tick < spec.time_limit_ticks {
        runtime.step().expect("step should succeed");
    }

    let finalized = runtime.finalize();
    let replay = simulate_diamond_rush_run(
        &RankedRunEvidenceV3 {
            protocol_version: 2,
            simulation_version: spec.simulation_version,
            session_id: B256::from_slice(&[5u8; 32]),
            challenge_id: spec.challenge_id.clone(),
            challenge_version: spec.version,
            challenge_content_hash: spec.content_hash,
            challenge_seed: spec.challenge_seed,
            client_build_hash: B256::from_slice(&[6u8; 32]),
            logic_fps: spec.logic_fps,
            finished_tick: spec.time_limit_ticks,
            actions: Vec::<RankedRunAction>::new(),
            summary: RankedRunSummaryV3 {
                diamonds_caught: finalized.diamonds_caught,
                last_diamond_tick: finalized.last_diamond_tick,
            },
        },
        &spec,
    )
    .expect("replay should succeed");

    assert_eq!(finalized.diamonds_caught, replay.diamonds_caught);
    assert_eq!(finalized.last_diamond_tick, replay.last_diamond_tick);
    assert_eq!(finalized.finished_tick, replay.finished_tick);
}
