import { useEffect, useState } from "react";
import { api } from "./api";
import type { AppSettingsView, FeatureId, ComfyFeatureConfig } from "./types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((r) => setSettings(r.settings as unknown as AppSettingsView))
      .catch(() => undefined);
  }, []);
  return settings;
}

export function useFeature(id: FeatureId): ComfyFeatureConfig | undefined {
  return useSettings()?.features?.[id];
}
