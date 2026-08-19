export const MOTION_DEMO = {
  id: "robot-expressive",
  label: "Robot Expressive",
  src: "/motions/RobotExpressive.glb",
  author: "Tomás Laulhé",
  license: "CC0",
  defaultClip: "Walking",
};

export const MOTION_LIBRARIES = [
  {
    name: "Adobe Mixamo",
    url: "https://www.mixamo.com",
    license: "免费可商用",
    note: "需免费 Adobe 账号。视铸用 mixamorig 骨骼名，并把你放到 frontend/data/motions/mixamo/ 或工位上传的 GLB/FBX 合并进去。禁止把原始 Mixamo FBX 当素材包再分发。",
  },
  {
    name: "Kenney Animated Characters",
    url: "https://kenney.nl/assets/animated-characters-3",
    license: "CC0",
    note: "Idle / Run / Jump，可商用、无需署名。",
  },
  {
    name: "Robot Expressive",
    url: "https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive",
    license: "CC0",
    note: "本仓库预览角色（Walking / Running / Dance 等）。",
  },
  {
    name: "UniRig",
    url: "https://github.com/VAST-AI-Research/UniRig",
    license: "MIT",
    note: "本机自动骨骼 + 蒙皮。ComfyManager 克隆仓库并起 Python 子进程；视铸只调管理端接口。",
  },
];
