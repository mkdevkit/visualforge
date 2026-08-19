import { join } from "node:path";
import { loadSettings } from "../config.js";
import { loadJson, saveJson } from "./json.js";

export interface DesignedVoice {
  id: string;
  name: string;
  prompt: string;
  targetModel: string;
  designModel: string;
  createdAt: string;
  previewAssetId?: string;
}

function voicesFile() {
  return join(loadSettings().dataDir, "voices.json");
}

export function loadVoices(): DesignedVoice[] {
  return loadJson<DesignedVoice[]>(voicesFile(), []);
}

export function saveVoices(list: DesignedVoice[]) {
  saveJson(voicesFile(), list);
}

export function upsertVoice(voice: DesignedVoice) {
  const list = loadVoices().filter((v) => v.id !== voice.id);
  list.unshift(voice);
  saveVoices(list);
  return voice;
}

export function removeVoice(id: string) {
  const next = loadVoices().filter((v) => v.id !== id);
  saveVoices(next);
  return next;
}
