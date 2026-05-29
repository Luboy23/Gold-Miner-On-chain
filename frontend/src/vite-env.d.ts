/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SEASON_REGISTRY_31337?: string;
  readonly VITE_REWARD_VAULT_31337?: string;
  readonly VITE_SEASON_REGISTRY_84532?: string;
  readonly VITE_REWARD_VAULT_84532?: string;
  readonly VITE_SEASON_REGISTRY_11155111?: string;
  readonly VITE_REWARD_VAULT_11155111?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
