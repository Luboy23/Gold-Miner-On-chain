#![cfg(feature = "wasm")]

use anyhow::Context;
use wasm_bindgen::prelude::*;

use crate::{
    ranked::{
        RankedChallengeRuntime, RankedChallengeRuntimeSnapshot, RankedDiamondRushOutcome,
    },
    RankedChallengeManifestEntry,
};

fn serialize<T: serde::Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value)
        .map_err(|error| JsValue::from_str(&format!("serialization failed: {error}")))
}

#[wasm_bindgen]
pub struct WasmRankedRuntime {
    inner: RankedChallengeRuntime,
}

#[wasm_bindgen]
impl WasmRankedRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(spec_json: &str) -> Result<WasmRankedRuntime, JsValue> {
        let spec: RankedChallengeManifestEntry = serde_json::from_str(spec_json)
            .context("invalid ranked challenge manifest entry")
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let inner = RankedChallengeRuntime::new(&spec)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;

        Ok(Self { inner })
    }

    pub fn apply_fire_hook(&mut self, tick: u32) -> Result<bool, JsValue> {
        self.inner
            .apply_fire_hook(tick)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn step(&mut self) -> Result<(), JsValue> {
        self.inner
            .step()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn advance_elapsed_ticks(&mut self, ticks: u32) -> Result<(), JsValue> {
        self.inner
            .advance_elapsed_ticks(ticks)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        serialize::<RankedChallengeRuntimeSnapshot>(&self.inner.snapshot())
    }

    pub fn finalize_json(&self) -> Result<String, JsValue> {
        serialize::<RankedDiamondRushOutcome>(&self.inner.finalize())
    }
}
