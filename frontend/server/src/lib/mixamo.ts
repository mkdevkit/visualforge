import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { loadSettings } from "../config.js";
import { absPath } from "./storage.js";
import { runCommand } from "./proc.js";

const CLIP_EXT = new Set([".glb", ".gltf", ".fbx", ".dae"]);

export function mixamoBoneName(short: string) {
  return `mixamorig:${short}`;
}

export function boneKey(name: string) {
  return name
    .replace(/^mixamorig[:_\s-]*/i, "")
    .replace(/^armature[|:._\s-]*/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function hasMixamoSkin(doc: Document) {
  return doc.getRoot().listSkins().some((skin) =>
    skin.listJoints().some((node) => /^mixamorig[:_]/i.test(node.getName() || "")),
  );
}

export function mixamoDir() {
  return join(loadSettings().dataDir, "motions", "mixamo");
}

export function listMixamoClipRelPaths() {
  const dir = mixamoDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => CLIP_EXT.has(extname(name).toLowerCase()) && !name.startsWith("."))
    .map((name) => `motions/mixamo/${name}`);
}

export function blenderBin() {
  const fromEnv = process.env.BLENDER_BIN?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const foundation = join(pf, "Blender Foundation");
    if (existsSync(foundation)) {
      const versions = readdirSync(foundation).sort().reverse();
      for (const v of versions) {
        const exe = join(foundation, v, "blender.exe");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return "blender";
}

export function blenderAvailable() {
  const bin = blenderBin();
  if (bin !== "blender" && existsSync(bin)) return true;
  return Boolean(process.env.BLENDER_BIN?.trim());
}

async function convertWithBlender(src: string): Promise<string> {
  const dest = join(tmpdir(), `${basename(src, extname(src))}-${Date.now()}.glb`);
  const script = join(tmpdir(), `vf-mixamo-convert-${Date.now()}.py`);
  writeFileSync(
    script,
    [
      "import bpy, sys",
      "args = sys.argv[sys.argv.index('--') + 1:]",
      "src, dst = args[0], args[1]",
      "bpy.ops.wm.read_homefile(use_empty=True)",
      "ext = src.lower()",
      "if ext.endswith('.fbx'):",
      "    bpy.ops.import_scene.fbx(filepath=src)",
      "elif ext.endswith('.dae'):",
      "    bpy.ops.wm.collada_import(filepath=src)",
      "else:",
      "    raise SystemExit('unsupported Mixamo source')",
      "bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=True)",
    ].join("\n"),
    "utf8",
  );
  const r = await runCommand(blenderBin(), ["-b", "-P", script, "--", src, dest], { timeoutMs: 120000 });
  if (r.code !== 0 || !existsSync(dest)) {
    throw new Error(
      `Mixamo FBX/DAE 需要 Blender 转成 GLB。请安装 Blender 或设置 BLENDER_BIN。\n${r.log.slice(-1200)}`,
    );
  }
  return dest;
}

async function clipToGlb(abs: string): Promise<string> {
  const ext = extname(abs).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") return abs;
  if (ext === ".fbx" || ext === ".dae") return convertWithBlender(abs);
  throw new Error(`不支持的 Mixamo 动作格式：${ext}`);
}

export async function resolveMixamoClipPaths(extraRel: string[] = []) {
  const rels = [...new Set([...listMixamoClipRelPaths(), ...extraRel.filter(Boolean)])];
  const out: string[] = [];
  for (const rel of rels) {
    const full = absPath(rel);
    if (!existsSync(full)) throw new Error(`找不到 Mixamo 动作：${rel}`);
    out.push(await clipToGlb(full));
  }
  return out;
}

export async function mergeMixamoClips(target: Document, clipPaths: string[]) {
  if (!clipPaths.length) return [] as string[];
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const nodes = new Map<string, ReturnType<Document["createNode"]>>();
  for (const node of target.getRoot().listNodes()) {
    const key = boneKey(node.getName() || "");
    if (key && !nodes.has(key)) nodes.set(key, node);
  }
  const added: string[] = [];
  const buffer = target.getRoot().listBuffers()[0] || target.createBuffer();
  for (const clipPath of clipPaths) {
    const clipDoc = await io.read(clipPath);
    const clipName = basename(clipPath, extname(clipPath)).replace(/-\d+$/, "");
    let index = 0;
    for (const anim of clipDoc.getRoot().listAnimations()) {
      const name = anim.getName() && anim.getName() !== "mixamo.com" ? anim.getName() : clipName;
      const unique = target.getRoot().listAnimations().some((a) => a.getName() === name)
        ? `${name}_${++index}`
        : name;
      const next = target.createAnimation(unique);
      let channels = 0;
      for (const ch of anim.listChannels()) {
        const srcNode = ch.getTargetNode();
        const path = ch.getTargetPath();
        const sampler = ch.getSampler();
        if (!srcNode || !path || !sampler || path === "weights") continue;
        const destNode = nodes.get(boneKey(srcNode.getName() || ""));
        if (!destNode) continue;
        const inputAcc = sampler.getInput();
        const outputAcc = sampler.getOutput();
        if (!inputAcc || !outputAcc) continue;
        const inArr = inputAcc.getArray();
        const outArr = outputAcc.getArray();
        if (!inArr || !outArr) continue;
        const input = target
          .createAccessor(`${unique}_t`)
          .setType("SCALAR")
          .setArray(new Float32Array(inArr as Float32Array))
          .setBuffer(buffer);
        const output = target
          .createAccessor(`${unique}_${destNode.getName()}_${path}`)
          .setType(outputAcc.getType())
          .setArray(new Float32Array(outArr as Float32Array))
          .setBuffer(buffer);
        const nextSampler = target
          .createAnimationSampler()
          .setInput(input)
          .setOutput(output)
          .setInterpolation(sampler.getInterpolation());
        next.addSampler(nextSampler).addChannel(
          target
            .createAnimationChannel()
            .setTargetNode(destNode)
            .setTargetPath(path as "translation" | "rotation" | "scale")
            .setSampler(nextSampler),
        );
        channels += 1;
      }
      if (channels) added.push(unique);
      else next.dispose();
    }
  }
  return added;
}
