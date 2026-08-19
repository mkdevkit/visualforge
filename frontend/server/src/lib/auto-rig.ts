import { Document, NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readFileSync } from "node:fs";
import { absPath, getAsset, saveBuffer } from "./storage.js";
import type { AssetRecord } from "../types.js";
import { mixamoBoneName, hasMixamoSkin, mergeMixamoClips, resolveMixamoClipPaths, blenderAvailable, listMixamoClipRelPaths } from "./mixamo.js";
import { fetchManagerUniRig, runManagerUniRig } from "./manager-client.js";

export type RigEngine = "auto" | "unirig" | "mixamo" | "bbox";

export interface RigOptions {
  engine?: RigEngine;
  animationRelPaths?: string[];
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const BONE_TREE: Array<{ name: string; parent: string | null }> = [
  { name: "Hips", parent: null },
  { name: "Spine", parent: "Hips" },
  { name: "Spine1", parent: "Spine" },
  { name: "Spine2", parent: "Spine1" },
  { name: "Neck", parent: "Spine2" },
  { name: "Head", parent: "Neck" },
  { name: "LeftShoulder", parent: "Spine2" },
  { name: "LeftArm", parent: "LeftShoulder" },
  { name: "LeftForeArm", parent: "LeftArm" },
  { name: "LeftHand", parent: "LeftForeArm" },
  { name: "RightShoulder", parent: "Spine2" },
  { name: "RightArm", parent: "RightShoulder" },
  { name: "RightForeArm", parent: "RightArm" },
  { name: "RightHand", parent: "RightForeArm" },
  { name: "LeftUpLeg", parent: "Hips" },
  { name: "LeftLeg", parent: "LeftUpLeg" },
  { name: "LeftFoot", parent: "LeftLeg" },
  { name: "RightUpLeg", parent: "Hips" },
  { name: "RightLeg", parent: "RightUpLeg" },
  { name: "RightFoot", parent: "RightLeg" },
];

function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function identQuat(): Quat {
  return [0, 0, 0, 1];
}

function distToSegment(p: Vec3, a: Vec3, b: Vec3) {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-8;
  let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2;
  t = Math.min(1, Math.max(0, t));
  const x = a[0] + ab[0] * t - p[0];
  const y = a[1] + ab[1] * t - p[1];
  const z = a[2] + ab[2] * t - p[2];
  return Math.sqrt(x * x + y * y + z * z);
}

function bboxOf(pos: Float32Array) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    min[0] = Math.min(min[0], pos[i]);
    min[1] = Math.min(min[1], pos[i + 1]);
    min[2] = Math.min(min[2], pos[i + 2]);
    max[0] = Math.max(max[0], pos[i]);
    max[1] = Math.max(max[1], pos[i + 1]);
    max[2] = Math.max(max[2], pos[i + 2]);
  }
  return { min, max };
}

function humanoidWorld(min: Vec3, max: Vec3): Record<string, Vec3> {
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const h = Math.max(0.001, max[1] - min[1]);
  const w = Math.max(0.001, max[0] - min[0]);
  const d = Math.max(0.001, max[2] - min[2]);
  const y = (t: number) => min[1] + h * t;
  const arm = Math.max(w * 0.42, h * 0.16);
  return {
    Hips: [cx, y(0.48), cz],
    Spine: [cx, y(0.55), cz],
    Spine1: [cx, y(0.63), cz],
    Spine2: [cx, y(0.71), cz],
    Neck: [cx, y(0.8), cz],
    Head: [cx, y(0.93), cz],
    LeftShoulder: [cx - arm * 0.28, y(0.76), cz],
    LeftArm: [cx - arm * 0.52, y(0.76), cz],
    LeftForeArm: [cx - arm * 0.78, y(0.76), cz],
    LeftHand: [cx - arm * 1.02, y(0.76), cz],
    RightShoulder: [cx + arm * 0.28, y(0.76), cz],
    RightArm: [cx + arm * 0.52, y(0.76), cz],
    RightForeArm: [cx + arm * 0.78, y(0.76), cz],
    RightHand: [cx + arm * 1.02, y(0.76), cz],
    LeftUpLeg: [cx - w * 0.12, y(0.48), cz],
    LeftLeg: [cx - w * 0.12, y(0.25), cz],
    LeftFoot: [cx - w * 0.12, y(0.03), cz + d * 0.08],
    RightUpLeg: [cx + w * 0.12, y(0.48), cz],
    RightLeg: [cx + w * 0.12, y(0.25), cz],
    RightFoot: [cx + w * 0.12, y(0.03), cz + d * 0.08],
  };
}

function translationIbm(world: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -world[0], -world[1], -world[2], 1];
}

function collectPositions(doc: Document) {
  const chunks: Float32Array[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute("POSITION");
      if (!acc) continue;
      const arr = acc.getArray();
      if (arr instanceof Float32Array) chunks.push(arr);
    }
  }
  if (!chunks.length) throw new Error("GLB 里没有网格顶点");
  const total = chunks.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of chunks) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function skinPrimitive(doc: Document, prim: ReturnType<Document["createPrimitive"]>, world: Record<string, Vec3>, jointNames: string[]) {
  const posAcc = prim.getAttribute("POSITION");
  if (!posAcc) return;
  const pos = posAcc.getArray();
  if (!(pos instanceof Float32Array)) return;
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const parentOf = Object.fromEntries(BONE_TREE.map((b) => [b.name, b.parent]));
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const scored = jointNames.map((name, idx) => {
      const w = world[name];
      const parent = parentOf[name];
      const a = parent ? world[parent] : w;
      return { idx, d: distToSegment(p, a, w) };
    });
    scored.sort((a, b) => a.d - b.d);
    const top = scored.slice(0, 4);
    let sum = 0;
    const raw = top.map((s) => {
      const w = 1 / (s.d * s.d + 1e-5);
      sum += w;
      return { ...s, w };
    });
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = raw[k]?.idx ?? 0;
      weights[i * 4 + k] = (raw[k]?.w ?? 0) / (sum || 1);
    }
  }
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  prim.setAttribute("JOINTS_0", doc.createAccessor("JOINTS_0").setType("VEC4").setArray(joints).setBuffer(buffer));
  prim.setAttribute("WEIGHTS_0", doc.createAccessor("WEIGHTS_0").setType("VEC4").setArray(weights).setBuffer(buffer));
}

function addClip(
  doc: Document,
  name: string,
  times: number[],
  channels: Array<{ node: GltfNode; path: "rotation" | "translation"; keys: number[][] }>,
) {
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor(`${name}_time`).setType("SCALAR").setArray(new Float32Array(times)).setBuffer(buffer);
  for (const ch of channels) {
    const type = ch.path === "rotation" ? "VEC4" : "VEC3";
    const output = doc
      .createAccessor(`${name}_${ch.node.getName()}_${ch.path}`)
      .setType(type)
      .setArray(new Float32Array(ch.keys.flat()))
      .setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR");
    const channel = doc.createAnimationChannel().setTargetNode(ch.node).setTargetPath(ch.path).setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
  }
}

function applyMixamoBboxRig(doc: Document) {
  const positions = collectPositions(doc);
  const { min, max } = bboxOf(positions);
  const height = Math.max(0.001, max[1] - min[1]);
  const world = humanoidWorld(min, max);
  const scene = doc.getRoot().listScenes()[0] || doc.createScene("Scene");
  const armature = doc.createNode("Armature");
  scene.addChild(armature);

  const nodes = new Map<string, GltfNode>();
  for (const bone of BONE_TREE) {
    const node = doc.createNode(mixamoBoneName(bone.name));
    const w = world[bone.name];
    const p = bone.parent ? world[bone.parent] : ([0, 0, 0] as Vec3);
    node.setTranslation(bone.parent ? [w[0] - p[0], w[1] - p[1], w[2] - p[2]] : w);
    nodes.set(bone.name, node);
    if (bone.parent) nodes.get(bone.parent)!.addChild(node);
    else armature.addChild(node);
  }

  const jointNames = BONE_TREE.map((b) => b.name);
  const ibm = new Float32Array(jointNames.length * 16);
  jointNames.forEach((name, i) => ibm.set(translationIbm(world[name]), i * 16));
  const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const ibmAcc = doc.createAccessor("IBM").setType("MAT4").setArray(ibm).setBuffer(buffer);
  const skin = doc.createSkin("MixamoRig").setSkeleton(armature).setInverseBindMatrices(ibmAcc);
  for (const name of jointNames) skin.addJoint(nodes.get(name)!);

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) skinPrimitive(doc, prim, world, jointNames);
  }
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()) node.setSkin(skin);
  }

  const hips = nodes.get("Hips")!;
  const spine = nodes.get("Spine")!;
  const leftUp = nodes.get("LeftUpLeg")!;
  const rightUp = nodes.get("RightUpLeg")!;
  const leftLeg = nodes.get("LeftLeg")!;
  const rightLeg = nodes.get("RightLeg")!;
  const leftArm = nodes.get("LeftArm")!;
  const rightArm = nodes.get("RightArm")!;
  const rightFore = nodes.get("RightForeArm")!;
  const q0 = identQuat();
  const walkT = [0, 0.25, 0.5, 0.75, 1];
  const swing = (deg: number) => quatFromEuler((deg * Math.PI) / 180, 0, 0);
  addClip(doc, "Idle", [0, 1, 2], [
    { node: hips, path: "translation", keys: [world.Hips, [world.Hips[0], world.Hips[1] + height * 0.012, world.Hips[2]], world.Hips] },
    { node: spine, path: "rotation", keys: [q0, quatFromEuler(0, 0, 0.06), q0] },
  ]);
  addClip(doc, "Walk", walkT, [
    { node: leftUp, path: "rotation", keys: [swing(28), q0, swing(-28), q0, swing(28)] },
    { node: rightUp, path: "rotation", keys: [swing(-28), q0, swing(28), q0, swing(-28)] },
    { node: leftLeg, path: "rotation", keys: [swing(-12), q0, swing(8), q0, swing(-12)] },
    { node: rightLeg, path: "rotation", keys: [swing(8), q0, swing(-12), q0, swing(8)] },
    { node: leftArm, path: "rotation", keys: [swing(-22), q0, swing(22), q0, swing(-22)] },
    { node: rightArm, path: "rotation", keys: [swing(22), q0, swing(-22), q0, swing(22)] },
    {
      node: hips,
      path: "translation",
      keys: walkT.map((t, i) => [world.Hips[0], world.Hips[1] + height * 0.01 * (i % 2), world.Hips[2] + height * 0.04 * Math.sin(t * Math.PI * 2)]),
    },
  ]);
  addClip(doc, "Wave", [0, 0.35, 0.7, 1], [
    { node: rightArm, path: "rotation", keys: [q0, quatFromEuler(0, 0, -1.1), quatFromEuler(0, 0, -0.4), q0] },
    { node: rightFore, path: "rotation", keys: [q0, quatFromEuler(0, 0, -0.9), quatFromEuler(0, 0, 0.2), q0] },
  ]);
  return ["Idle", "Walk", "Wave"];
}

function clipNames(doc: Document) {
  return doc.getRoot().listAnimations().map((a) => a.getName() || "clip").filter(Boolean);
}

async function saveRigged(asset: AssetRecord, glb: Uint8Array | Buffer, engine: string, clips: string[], note: string) {
  return saveBuffer({
    type: "model3d",
    buffer: Buffer.from(glb),
    ext: "glb",
    mime: "model/gltf-binary",
    prompt: asset.prompt,
    model: `${asset.model} · ${engine}`,
    title: `${asset.title} · 绑骨动画`,
    tags: [...new Set([...(asset.tags || []), "rigged", "animated", engine])],
    kind: asset.kind,
    params: {
      ...asset.params,
      rigged: true,
      engine,
      sourceAssetId: asset.id,
      clips,
      note,
    },
  });
}

async function mergeClipsInto(doc: Document, extraRel: string[] = []) {
  const paths = await resolveMixamoClipPaths(extraRel);
  return mergeMixamoClips(doc, paths);
}

async function rigWithUniRig(asset: AssetRecord, extraRel: string[] = []) {
  const buf = await runManagerUniRig(readFileSync(absPath(asset.relPath)));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  try {
    const doc = await io.readBinary(new Uint8Array(buf));
    const mixamo = await mergeClipsInto(doc, extraRel);
    const glb = await io.writeBinary(doc);
    return saveRigged(
      asset,
      glb,
      "unirig",
      [...clipNames(doc)],
      mixamo.length
        ? "UniRig（ComfyManager 子进程）自动骨骼 + 蒙皮；已尝试合并 Mixamo 动作。"
        : "UniRig（ComfyManager 子进程）自动骨骼 + 蒙皮（MIT）。首次运行会下载 Hugging Face 权重。",
    );
  } catch {
    return saveRigged(
      asset,
      buf,
      "unirig",
      [],
      "UniRig（ComfyManager 子进程）自动骨骼 + 蒙皮（MIT）。首次运行会下载 Hugging Face 权重。",
    );
  }
}

async function rigWithMixamo(asset: AssetRecord, extraRel: string[] = [], forceBbox: boolean) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(absPath(asset.relPath));
  const already = hasMixamoSkin(doc);
  let procedural: string[] = [];
  if (!already) {
    if (doc.getRoot().listSkins().length && forceBbox) {
      throw new Error("该网格已有非 Mixamo 骨骼，无法再套 Mixamo 命名。可改用 UniRig，或先用未绑骨的静网格。");
    }
    if (!doc.getRoot().listSkins().length) procedural = applyMixamoBboxRig(doc);
  }
  const mixamo = await mergeClipsInto(doc, extraRel);
  if (already && !mixamo.length) {
    throw new Error("已有 Mixamo 骨骼，但没有可合并的动作。请上传 Mixamo GLB/FBX，或把文件放到 frontend/data/motions/mixamo/。");
  }
  const glb = await io.writeBinary(doc);
  return saveRigged(
    asset,
    glb,
    already ? "mixamo-retarget" : "mixamo",
    [...procedural, ...mixamo],
    already
      ? "已把 Mixamo 动作合并到现有 mixamorig 骨骼。"
      : "T-pose Mixamo 命名骨骼（mixamorig:*）+ 热力蒙皮。可上传 mixamo.com 动作；禁止把原始 Mixamo FBX 当素材包再分发。",
  );
}

export async function rigEngineStatus() {
  let unirig: { installed: boolean; dir: string; python: string; busy?: boolean; error?: string } = {
    installed: false,
    dir: "",
    python: "",
  };
  try {
    unirig = await fetchManagerUniRig();
  } catch (err) {
    unirig.error = err instanceof Error ? err.message : String(err);
  }
  return {
    engines: ["auto", "unirig", "mixamo", "bbox"] as RigEngine[],
    unirig,
    mixamo: {
      clips: listMixamoClipRelPaths(),
      blender: blenderAvailable(),
    },
  };
}

export async function rigAndAnimateAsset(assetId: string, opts: RigOptions = {}): Promise<AssetRecord> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error("资源不存在");
  if (asset.type !== "model3d") throw new Error("只能对 3D 资源绑骨");
  const engine: RigEngine = opts.engine || "auto";
  const extra = opts.animationRelPaths || [];

  if (engine === "unirig") return rigWithUniRig(asset, extra);

  if (engine === "mixamo") return rigWithMixamo(asset, extra, true);

  if (engine === "bbox") {
    if (asset.params?.rigged) throw new Error("该文件已经绑过骨");
    return rigWithMixamo(asset, extra, true);
  }

  try {
    const st = await fetchManagerUniRig();
    if (st.installed) {
      try {
        return await rigWithUniRig(asset, extra);
      } catch (err) {
        console.warn("[rig] UniRig 失败，回退 Mixamo 估骨", err);
      }
    }
  } catch (err) {
    console.warn("[rig] ComfyManager UniRig 不可用，回退 Mixamo 估骨", err);
  }
  if (asset.params?.rigged) throw new Error("该文件已经绑过骨");
  return rigWithMixamo(asset, extra, true);
}
