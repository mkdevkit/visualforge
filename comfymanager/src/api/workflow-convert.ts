type NodeSpec = { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } };

const LINK_TYPES = new Set([
  "MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "IMAGE", "MASK", "CONTROL_NET",
  "STYLE_MODEL", "CLIP_VISION", "CLIP_VISION_OUTPUT", "GLIGEN", "UPSCALE_MODEL",
  "SAMPLER", "SIGMAS", "NOISE", "GUIDER", "AUDIO", "LATENT_OPERATION", "STRING",
]);

const EXTRA_WIDGET = new Set(["fixed", "randomize", "increment", "decrement", "randomize control_after_generate"]);

export function isApiWorkflow(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const graph = rec.prompt && typeof rec.prompt === "object" && !Array.isArray(rec.prompt) ? rec.prompt : rec;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return false;
  return Object.values(graph as Record<string, unknown>).some(
    (n) => n && typeof n === "object" && "class_type" in (n as object),
  );
}

export function isUiWorkflow(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.nodes);
}

export function unwrapApiGraph(value: unknown): Record<string, unknown> {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (rec.prompt && typeof rec.prompt === "object" && !Array.isArray(rec.prompt) && isApiWorkflow(rec.prompt)) {
    return rec.prompt as Record<string, unknown>;
  }
  return rec;
}

function isWidgetSpec(spec: unknown): boolean {
  const t = Array.isArray(spec) ? spec[0] : spec;
  const extra = Array.isArray(spec) ? spec[1] : undefined;
  if (extra && typeof extra === "object") return true;
  if (typeof t !== "string") return true;
  if (["INT", "FLOAT", "BOOLEAN", "COMBO"].includes(t)) return true;
  if (t === "STRING") return true;
  if (LINK_TYPES.has(t) && extra == null) return false;
  return !/^[A-Z][A-Z0-9_]+$/.test(t);
}

function inputEntries(info: NodeSpec | undefined) {
  const req = info?.input?.required || {};
  const opt = info?.input?.optional || {};
  return [...Object.entries(req), ...Object.entries(opt)];
}

export function uiToApiPrompt(ui: unknown, objectInfo: Record<string, NodeSpec> = {}): Record<string, unknown> {
  const rec = ui as {
    nodes?: Array<Record<string, unknown>>;
    links?: Array<unknown>;
  };
  const nodes = rec.nodes || [];
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const linkMap = new Map<number, { origin: string; slot: number }>();
  for (const raw of rec.links || []) {
    if (!Array.isArray(raw) || raw.length < 5) continue;
    const id = Number(raw[0]);
    linkMap.set(id, { origin: String(raw[1]), slot: Number(raw[2]) });
  }

  const follow = (origin: string, slot: number, depth = 0): { origin: string; slot: number } => {
    if (depth > 20) return { origin, slot };
    const node = byId.get(origin);
    if (!node || String(node.type) !== "Reroute") return { origin, slot };
    const ins = Array.isArray(node.inputs) ? (node.inputs as Array<Record<string, unknown>>) : [];
    const link = ins[0]?.link;
    if (link == null) return { origin, slot };
    const src = linkMap.get(Number(link));
    if (!src) return { origin, slot };
    return follow(src.origin, src.slot, depth + 1);
  };

  const prompt: Record<string, unknown> = {};
  for (const node of nodes) {
    const mode = Number(node.mode || 0);
    if (mode === 2 || mode === 4) continue;
    const id = String(node.id);
    const classType = resolveNodeClass(String(node.type || ""), objectInfo);
    if (!classType || classType === "Note" || classType === "Reroute") continue;
    const info = objectInfo[classType] || objectInfo[String(node.type || "")];
    const inputs: Record<string, unknown> = {};
    const nodeInputs = Array.isArray(node.inputs) ? (node.inputs as Array<Record<string, unknown>>) : [];
    for (const inp of nodeInputs) {
      const name = String(inp.name || "");
      const link = inp.link;
      if (!name || link == null) continue;
      const src = linkMap.get(Number(link));
      if (src) {
        const resolved = follow(src.origin, src.slot);
        inputs[name] = [resolved.origin, resolved.slot];
      }
    }
    const widgets = Array.isArray(node.widgets_values) ? [...(node.widgets_values as unknown[])] : [];
    let w = 0;
    for (const [name, spec] of inputEntries(info)) {
      if (name in inputs) continue;
      if (!isWidgetSpec(spec)) continue;
      while (w < widgets.length && typeof widgets[w] === "string" && EXTRA_WIDGET.has(String(widgets[w]).toLowerCase())) w += 1;
      if (w < widgets.length) inputs[name] = widgets[w++];
    }
    if (!info) {
      for (const inp of nodeInputs) {
        const name = String(inp.name || "");
        if (name && !(name in inputs) && w < widgets.length) inputs[name] = widgets[w++];
      }
      if (w < widgets.length && !("ckpt_name" in inputs) && classType.includes("Checkpoint")) {
        inputs.ckpt_name = widgets[0];
      }
    }
    prompt[id] = { class_type: classType, inputs };
  }
  return prompt;
}

/** 界面显示名 / 旧类名 ↔ ComfyUI 实际 class_type。Load Diffusion Model 的真正类型是 UNETLoader。 */
const NODE_CLASS_ALIASES: Record<string, string[]> = {
  LoadDiffusionModel: ["UNETLoader"],
  UNETLoader: ["LoadDiffusionModel"],
};

export function resolveNodeClass(classType: string, objectInfo: Record<string, unknown> = {}) {
  if (!classType) return classType;
  const known = Object.keys(objectInfo);
  if (known.includes(classType)) return classType;
  for (const alt of NODE_CLASS_ALIASES[classType] || []) {
    if (!known.length || known.includes(alt)) return alt;
  }
  if (classType === "LoadDiffusionModel") return "UNETLoader";
  return classType;
}

export function remapMissingNodeClasses(graph: Record<string, unknown>, objectInfo: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      out[id] = node;
      continue;
    }
    const rec = node as { class_type?: string };
    const next = resolveNodeClass(rec.class_type || "", objectInfo);
    out[id] = next === rec.class_type ? node : { ...rec, class_type: next };
  }
  return out;
}

export function injectPlaceholders(graph: Record<string, unknown>): { graph: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  let promptSet = false;
  let negativeSet = false;
  let imageSet = false;
  let image2Set = false;
  let modelSet = false;
  const out: Record<string, unknown> = {};

  const setIfEmpty = (inputs: Record<string, unknown>, key: string, placeholder: string) => {
    const cur = inputs[key];
    if (typeof cur === "string" && cur.includes("{{")) return;
    inputs[key] = `{{${placeholder}}}`;
  };

  for (const [id, node] of Object.entries(graph)) {
    if (!node || typeof node !== "object") {
      out[id] = node;
      continue;
    }
    const rec = node as { class_type?: string; inputs?: Record<string, unknown> };
    const inputs = { ...(rec.inputs || {}) };
    const cls = rec.class_type || "";

    for (const key of Object.keys(inputs)) {
      if (modelSet) break;
      if (/ckpt_name|unet_name|model_name|checkpoint|ckpt/i.test(key) && typeof inputs[key] === "string") {
        setIfEmpty(inputs, key, "model");
        modelSet = true;
        notes.push(`${cls}.${key} → {{model}}`);
      }
    }
    if (cls === "CLIPTextEncode" && typeof inputs.text === "string") {
      if (!promptSet) {
        setIfEmpty(inputs, "text", "prompt");
        promptSet = true;
        notes.push(`${cls} → {{prompt}}`);
      } else if (!negativeSet) {
        setIfEmpty(inputs, "text", "negative");
        negativeSet = true;
        notes.push(`${cls} → {{negative}}`);
      }
    }
    if (/LoadImage/i.test(cls) && "image" in inputs) {
      if (!imageSet) {
        setIfEmpty(inputs, "image", "image");
        imageSet = true;
        notes.push(`${cls} → {{image}}`);
      } else if (!image2Set) {
        setIfEmpty(inputs, "image", "image2");
        image2Set = true;
        notes.push(`${cls} → {{image2}}`);
      }
    }
    const named: Array<[string, string]> = [
      ["width", "width"],
      ["height", "height"],
      ["seed", "seed"],
      ["duration", "duration"],
      ["lyrics", "lyrics"],
      ["voice", "voice"],
      ["text", "text"],
    ];
    if (cls !== "CLIPTextEncode") {
      for (const [key, ph] of named) {
        if (key in inputs && (typeof inputs[key] === "number" || typeof inputs[key] === "string")) {
          if (key === "text" && cls === "CLIPTextEncode") continue;
          if (typeof inputs[key] === "string" && String(inputs[key]).includes("{{")) continue;
          if (key === "text" && /TTS|TextEncode|Whisper/i.test(cls)) {
            setIfEmpty(inputs, key, ph);
            notes.push(`${cls}.${key} → {{${ph}}}`);
          } else if (key !== "text") {
            setIfEmpty(inputs, key, ph);
            notes.push(`${cls}.${key} → {{${ph}}}`);
          }
        }
      }
    }
    out[id] = { ...rec, inputs };
  }
  return { graph: out, notes };
}

export function workflowFormat(value: unknown): "api" | "ui" | "unknown" {
  if (isApiWorkflow(value)) return "api";
  if (isUiWorkflow(value)) return "ui";
  return "unknown";
}
