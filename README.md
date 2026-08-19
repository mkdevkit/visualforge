# 视铸 VisualForge

本地多模态工坊。生成只走本机 **ComfyUI**，不接云端大模型 API。

两个独立工具：

| 目录 | 作用 | 端口 |
|---|---|---|
| **comfymanager/** | ComfyUI 管理端：安装/启停、下载模型、各工位工作流与模型选项。视铸只调它的 API。 | `18788` |
| **frontend/** | 视铸生成端：Web + 生成本地 API + Tauri。设置里只配 ComfyManager 地址。也提供 MCP 给 Cursor。 | Web `5173`，生成 API `18787`（`/mcp`） |

## 目录

```
frontend/                 视铸：Vite React + 生成本地 API（server/）+ Tauri（src-tauri/）
frontend/data/            生成成品、上传、本机音色（gitignore）
comfymanager/             ComfyUI 管理：单目录全栈
comfymanager/config/models.json   开源模型目录（可商用清单）
comfymanager/comfy/       本机克隆的 ComfyUI（gitignore）
comfymanager/models/      下载的开源权重（gitignore）
comfymanager/data/        管理端设置、下载任务、日志（gitignore）
comfymanager/tools/       可选工具：UniRig 官方仓库（gitignore）
```

默认路径：

- ComfyUI 安装目录：优先用本机已有安装；没有才克隆到 `comfymanager/comfy/`（旧设置里的 `data/ComfyUI` 会自动迁到这里）
- 模型权重目录：始终是配置的 `comfymanager/models/<folder>/`（旧设置里的 `data/models` 会自动迁到这里），与 ComfyUI 是否复用无关
- 界面上的路径按操作系统显示（Windows 反斜杠，macOS / Linux 正斜杠）
- 管理端数据：`comfymanager/data/`（`settings.json`、下载任务等）
- 视铸成品：`frontend/data/`（图 / 视频 / 音乐 / 音频 / 3D）
- UniRig 仓库：`comfymanager/tools/UniRig/`（ComfyManager 概览页克隆）
- Mixamo 动作：`frontend/data/motions/mixamo/`（gitignore，需自己放入）

相对路径会按各包根目录解析。可用环境变量覆盖，见 `.env.example`。

## 环境要求

- Node.js 20+
- **自行安装** Git 与 Python 3.10+，并加入 PATH（ComfyManager 不代装）
  - Windows： [Git](https://git-scm.com)（勾选 PATH）、[Python](https://www.python.org)（勾选 Add python.exe to PATH）
  - Ubuntu：`sudo apt install git python3 python3-venv python3-pip`
- NVIDIA 驱动（安装 ComfyUI 时会按 `nvidia-smi` 选择 CUDA 版 PyTorch：20 系及以上默认 cu130，10 系用 cu126）
- 显卡与显存按所选模型而定（例如 Wan 2.2 TI2V 5B 大约 8GB 显存可跑）

复制环境变量示例：

```bash
copy .env.example .env
```

常用变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `COMFYMANAGER_PORT` | `18788` | 管理端端口 |
| `COMFYMANAGER_DATA_DIR` | `./comfymanager/data` | 管理端数据 |
| `COMFYUI_INSTALL_DIR` | `./comfymanager/comfy` | ComfyUI 安装目录（本机已有则可复用） |
| `COMFYUI_CUDA` | 自动 | PyTorch CUDA 轮子：`cu130` / `cu126` / `cpu`。空则按 nvidia-smi 选择 |
| `COMFYUI_MODELS_DIR` | `./comfymanager/models` | 权重目录 |
| `COMFYUI_BASE_URL` | `http://127.0.0.1:8188` | ComfyUI 接口 |
| `HF_TOKEN` | 空 | Hugging Face Token（门禁模型） |
| `VISUALFORGE_PORT` | `18787` | 视铸生成 API |
| `VISUALFORGE_DATA_DIR` | `./frontend/data` | 视铸成品目录 |
| `COMFYMANAGER_URL` | `http://127.0.0.1:18788` | 生成端访问管理端的地址 |
| `UNIRIG_DIR` | `./comfymanager/tools/UniRig` | UniRig 仓库目录（ComfyManager 使用） |
| `UNIRIG_PYTHON` | 空 | UniRig 用的 Python（ComfyManager 拉起子进程时使用） |
| `BLENDER_BIN` | 空 | Mixamo FBX→GLB 用的 Blender 可执行文件 |

## 启动

先开管理端，再开生成端：

```bash
npm install
npm run manager    # ComfyManager  http://127.0.0.1:18788
npm run dev        # 视铸 Web      http://127.0.0.1:5173
                   # 生成 API      http://127.0.0.1:18787  （MCP：/mcp）
```

或一次全开：

```bash
npm run dev:all
```

推荐流程：

1. 自行装好 Git、Python 3.10+。打开 ComfyManager。若本机已有 ComfyUI，点「使用已有安装」；没有则「安装 ComfyUI（含 CUDA）」（Windows / Ubuntu 都会在安装目录建 `.venv`，再装 CUDA 版 PyTorch）。然后启动。模型仍下载到配置的模型目录。
2. 在「模型」页下载权重，指定各工位「当前生效模型」。
3. 在「工作流」页把一份或多份图加入工位并勾选「生效」（也可粘贴 API JSON）。该页支持 zip / json 批量导入导出。
4. 打开视铸，设置里只填写 ComfyManager 地址（可选改成品目录）。
5. 回工位生成：指定工作流和模型。默认值、下拉选项、Comfy 地址都从管理端读取。

## 工位与工作流

视铸工位：生图、生视频、生音乐、音频（配音 / 音色设计 / 音效）、生 3D。角色动画走生视频工位（Wan Animate 2）。生 3D / 资源库可预览 GLB，并对静网格绑骨导出新 GLB，见下节。内置预览角色 Robot Expressive 为 CC0。

**用 ComfyUI 做生成必须给工位配至少一份生效工作流**（安装、启动、下模型不用配）。图在 ComfyUI 里可视化编辑；ComfyManager 列出本机工作流并**追加**到工位，不会覆盖已有的份。点「生成」时视铸按你指定的那份 API JSON 填占位符，POST 到 `/prompt`。没配的工位会报错。

**模型和份数互不绑定。** 同一份工作流可以换主模型：视铸把所选模型的文件名填进 `{{model}}`。若图里把 Checkpoint 写死、没有 `{{model}}`，换模型不会生效。一份工作流也可以只服务一种架构（例如只适 SDXL），换到不兼容的权重会在 Comfy 里报错。

需要工作流：生图、生视频、生音乐、配音、音效、音色设计、生 3D、3D 动画。

不经过 ComfyUI、也不要工作流：UniRig / Mixamo / 几何估骨、资源库预览下载。

### 如何配置

工作流在 **ComfyManager → 工作流**，不在视铸设置里粘贴。图本身在 **ComfyUI 里可视化编辑**，管理端负责库管理和配到工位。

推荐：

1. 在 ComfyUI 里搭好图并保存（会落到 `comfymanager/comfy/user/default/workflows/` 等目录）。图里要有 Save Image / Save Video / 导出 GLB 一类节点。
2. 打开 ComfyManager「工作流」页，上方 **ComfyUI 工作流库** 会列出本机所有 `.json`（画布格式或 API Format 都可以）。
3. 选工位后点「加入」，或在下方工位卡片里从库选择后加入。同一工位可加入多份。不必粘贴 JSON。
4. 勾选「生效」，需要时「设为默认」。视铸刷新后指定工作流和模型即可生成。生成时会重新读取库文件；画布 JSON 会转成 `/prompt` 并尽量套上 `{{prompt}}` / `{{model}}`（ComfyUI 在跑时转换更准）。

粘贴 API JSON 只在「高级」里，给没有库文件的情况。

批量：

- **上传 JSON / ZIP**：导入到 `user/default/workflows/`（zip 可带目录）。
- **下载 ZIP**：勾选若干个，或一个不选则打包全部。

扫描目录：`user/default/workflows`、`user/workflows`、`workflows`（均相对 ComfyUI 安装目录）。

`{{image}}` 填在 LoadImage 的 `image` 字段，不要填成本机路径；视铸会先 `/upload/image`。

### 页面字段

| 字段 | 意思 |
|---|---|
| **本工位模型** | 只读清单，来自 `models.json`。主模型是权重，配套是 VAE / 编码器等。需先在「模型」页下载。 |
| **默认模型** | 视铸该工位模型下拉的默认值。生成时仍可另选；会替换工作流里的 `{{model}}`（一般变成文件名，如 `xxx.safetensors`）。 |
| **本工位工作流** | 可多份，优先从库里的 json 加入。勾选「生效」会出现在视铸下拉里；「默认」是未指定时用的那份。 |
| **调用方式** | `官方 /prompt`：把库文件转成 ComfyUI 图，POST 到 `/prompt`（默认）。`自定义 HTTP`：请求体 JSON，打到下面的 URL。 |
| **地址覆盖 / 接口 URL** | `/prompt` 模式下可空，默认用本机 Comfy（`http://127.0.0.1:8188`）。`http` 模式必填完整接口地址。 |
| **手动粘贴（高级）** | 没有库文件时才用。`/prompt`：粘贴 API Format。`http`：请求体 JSON。 |

数据里还有 `timeoutMs`（默认 5 分钟）和 `extraHeaders`，页面上没暴露，一般不用改。

### 占位符

生成时视铸会整份 JSON 做替换。单独写成 `"{{width}}"` 时会变成数字，不是字符串。

| 占位符 | 来源 | 常用工位 |
|---|---|---|
| `{{prompt}}` | 描述 / 音色描述 | 几乎全部 |
| `{{model}}` | 工位所选模型（或管理端「默认模型」）的文件名。与工作流独立，同一份图可换兼容权重 | 几乎全部 |
| `{{negative}}` | 负向提示 | 生图 |
| `{{image}}` | 第一张参考图在 Comfy 里的文件名 | 图生图、图生视频、生 3D |
| `{{image2}}` | 第二张 / 尾帧 | 视频、3D 动画 |
| `{{width}}` `{{height}}` | 分辨率 | 生图 |
| `{{n}}` `{{seed}}` | 张数、种子（未填则随机） | 生图 |
| `{{duration}}` | 时长，默认 5 | 视频、音效 |
| `{{resolution}}` `{{ratio}}` | 默认 `720P`、`16:9` | 视频 |
| `{{lyrics}}` `{{instrumental}}` | 歌词、是否伴奏 | 音乐 |
| `{{text}}` `{{voice}}` `{{instructions}}` | 台词、音色、指示 | 配音 |
| `{{name}}` | 音色名 | 音色设计 |

生图 `/prompt` 最小改法：在导出的 JSON 里找到 CLIP 文本和 Checkpoint：

```json
"3": { "class_type": "CLIPTextEncode", "inputs": { "text": "{{prompt}}", "clip": ["4", 1] } },
"4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "{{model}}" } }
```

## 3D 绑骨（UniRig / Mixamo）

生 3D 绑骨可走 **UniRig** 或 **Mixamo**，不再只靠包围盒估骨。

**Mixamo** 没有官方绑骨 API，也不会去爬 mixamo.com。做法是：写出 T-pose 的 `mixamorig:*` 骨骼，再把你自己从 [mixamo.com](https://www.mixamo.com) 下载的动作合并进去。Adobe 允许商用，但禁止把原始 Mixamo FBX 当素材包再分发，所以仓库不内置这些文件。Mixamo 估骨在视铸生成 API 内完成。

**UniRig** 走官方 [MIT 仓库](https://github.com/VAST-AI-Research/UniRig)。**推理在 ComfyManager 里跑**（拉起 Python 子进程，不经过 ComfyUI）；视铸只调管理端接口，自己不 spawn UniRig。不要把 GPL 的 ComfyUI-UniRig 封装绑进核心。

调用链：

```
视铸工位 / MCP  →  POST 127.0.0.1:18787/api/3d/rig
                 →  ComfyManager POST /api/tools/unirig/run（上传 GLB）
                 →  python 子进程：extract → skeleton → skin → merge
                 →  返回 rigged.glb，视铸写入资源库（可选再合并 Mixamo 动作）
```

### 怎么用

1. **ComfyManager 必须在跑。** 概览页点「安装 UniRig」（只克隆仓库到 `comfymanager/tools/UniRig`）。再按 [UniRig README](https://github.com/VAST-AI-Research/UniRig) 用 Python 3.11 + PyTorch 安装依赖，可用 `UNIRIG_PYTHON` 指向该解释器（或在仓库里建 `.venv`）。
2. **生 3D 工位**选引擎后点「绑骨并导出动画 GLB」：
   - **自动**（`auto`）：管理端已克隆 UniRig 则调用其接口，失败则回退 Mixamo 估骨
   - **UniRig**（`unirig`）：调用 `POST /api/tools/unirig/run`；适合人 / 动物 / 道具；首次会下载 Hugging Face 权重，可能要数分钟
   - **Mixamo**（`mixamo`）：T-pose `mixamorig:*` 估骨 + 合并动作（工位上传 GLB/FBX，或放到 `frontend/data/motions/mixamo/`）
   - **快速几何估骨**（`bbox`）：包围盒人形骨骼 + 距离蒙皮，写入 Idle / Walk / Wave；适合站立类人，四足 / 道具较差
3. Mixamo 原生下载是 FBX：工位可直接上传 FBX（需本机 **Blender**，或设置 `BLENDER_BIN`），也可先自行转成 GLB。已有 `mixamorig` 骨骼的网格会只合并动作、不再重绑。
4. 资源库「绑骨导出」走自动引擎。MCP 工具 `rig_3d` 参数相同。

只开视铸、不开 ComfyManager 时，UniRig 不可用（`auto` 会回退估骨）。改了管理端或生成 API 后，需分别重启 `npm run manager` 和 `npm run dev`。

视铸接口：

```json
POST /api/3d/rig
{ "assetId": "…", "engine": "auto", "animationRelPaths": ["uploads/xxx.glb"] }
```

`GET /api/3d/rig-status` 会向 ComfyManager 询问 UniRig 是否已克隆，并返回 Mixamo 动作列表、是否检测到 Blender。`engine` 取值：`auto` | `unirig` | `mixamo` | `bbox`。

管理端接口：`GET /api/tools/unirig`、`POST /api/tools/unirig/run`（multipart 字段 `file`，返回 `model/gltf-binary`）。

## 模型目录

清单文件：`comfymanager/config/models.json`。可复制到 `comfymanager/data/models.json` 覆盖（本地覆盖优先）。

只收录 **Apache-2.0 / MIT** 等允许商用部署的开源权重，不含 OpenRAIL、Stability Community License 等带使用限制或收入上限的模型。

权重下载到 `comfymanager/models/<folder>/`。主模型与配套文件要一起下。部分 Hugging Face 文件需在 ComfyManager 设置里填写 HF Token。

| 工位 | 模型 | 许可 | 配套 |
|---|---|---|---|
| 生图 | Qwen-Image 2512 FP8、Qwen-Image-Edit 2509 FP8 | Apache-2.0 | Qwen2.5-VL 编码器、Qwen Image VAE；可选 Lightning 8-step LoRA |
| 生视频 | Wan 2.2 TI2V 5B（文生/图生视频） | Apache-2.0 | UMT5 编码器、Wan 2.2 VAE |
| 3D 动画 | Wan Animate 2 INT8（参考图 + 驱动视频 → **视频**，不是骨骼 mesh 动画） | Apache-2.0 | UMT5、CLIP Vision H、Wan 2.1 VAE |
| 音乐 / 音效 | ACE-Step 1.5 Turbo AIO（歌词生歌；音效类 tags 也可出 Foley） | Apache-2.0 | 单文件 All-in-One |
| 配音 | Qwen3-TTS CustomVoice 1.7B | Apache-2.0 | Qwen3-TTS Tokenizer |
| 音色设计 | Qwen3-TTS VoiceDesign 1.7B | Apache-2.0 | 同上 Tokenizer |
| 生 3D | TripoSR 单图生网格 | MIT | — |

当前开源生态里几乎没有「骨骼级 3D 网格动画」且许可干净、又有 ComfyUI 单文件的权重，因此 3D 动画工位用 Wan Animate 2。独立商用 Foley 也缺少合适的单文件，音效与音乐共用 ACE-Step。

## 生成资产能否商用

**就模型授权这一层：可以。** 目录里的权重允许商用部署；厂商一般也不主张对生成物的版权。Wan 还写明不对你生成的内容主张权利。本地跑这些开源模型，厂商不会因为「用了这个模型」来收生成物授权费。

这和「每一份成品都能随便拿去卖」不是一回事。模型许可只管权重，管不了提示词和结果是否撞上别人的权利。仍要注意：

- **提示词 / 参考图 / 歌词 / 音色**：写品牌吉祥物、明星脸、贴别人的图、填受版权保护的歌词、克隆真人声音，生成物仍可能侵权。责任在使用者。
- **音乐**：ACE-Step 允许商用，但官方提醒风格相似可能带来版权风险，重要项目建议核对原创性。
- **配音**：预设音色、自己描述的音色通常没问题；用真人参考音频做克隆，要有授权。
- **Mixamo 动作**：可商用，但不得把 Adobe 原始 FBX 当素材包再分发；视铸只合并你自己下载的文件。
- **合法使用**：各模型都要求不用于违法、伤害他人等内容。

高风险商用（广告、上架、融资）请自行核对当时的许可全文并咨询法务。以上不是法律意见。

## ComfyManager API

管理端 `http://127.0.0.1:18788`。视铸只配这个地址，其余都从这里拉。

给视铸用的聚合接口是 **`GET /api/runtime`**，一次返回：

- `comfy`：baseUrl、apiKey、是否连通
- `activeModels`：各工位当前生效模型 id
- `features`：各工位工作流列表（`workflows` / `activeWorkflowId` / mode / url）
- `catalog`：按工位列出的**主模型**下拉项，以及 `related` 配套文件（VAE、编码器等）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（含 UniRig 状态） |
| GET/PUT | `/api/settings` | 安装路径、监听、HF Token 等 |
| GET | `/api/comfy/status` | 安装与进程状态 |
| POST | `/api/comfy/install` | 复用或克隆 ComfyUI，并安装 CUDA 版 PyTorch + requirements |
| POST | `/api/comfy/start` | 启动 ComfyUI |
| POST | `/api/comfy/stop` | 停止 ComfyUI |
| GET | `/api/comfy/workflows` | 列出本机 ComfyUI 工作流 |
| GET | `/api/comfy/workflows/file` | 读取一份工作流 JSON |
| POST | `/api/comfy/workflows/assign` | 把库里的 json 配到工位（画布会转 API）；生成时再读文件 |
| POST | `/api/comfy/workflows/zip` | 打包选中或全部为 zip |
| POST | `/api/comfy/workflows/import` | 上传 json / zip |
| POST | `/api/tools/unirig/install` | 克隆官方 UniRig 仓库（不装 Python 依赖） |
| GET | `/api/tools/unirig` | UniRig 是否已克隆、解释器路径、是否在跑 |
| POST | `/api/tools/unirig/run` | 上传 GLB，本进程拉起 Python 子进程绑骨，返回 rigged.glb |
| GET | `/api/comfy/ping` | 探测 Comfy 接口 |
| GET | `/api/endpoint` | 当前 Comfy 地址 |
| GET | `/api/models` | 模型目录、是否已下载、按工位选项 |
| POST | `/api/models/:id/download` | 下载权重 |
| DELETE | `/api/models/:id` | 删除本地权重 |
| GET | `/api/models/downloads` | 下载任务 |
| GET/PUT | `/api/active-models` | 各工位当前生效模型 |
| GET/PUT | `/api/features` | 各工位工作流 |
| GET | `/api/runtime` | 视铸专用聚合：接口 + 模型 + 工作流 + UniRig 状态 |

## 视铸生成 API

生成接口在 `http://127.0.0.1:18787`（开发时 Vite 在 `5173`，页面再调本地 API）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（含 ComfyManager 状态） |
| GET | `/api/models` | 代理 ComfyManager：工位模型选项与工作流 |
| GET/PUT | `/api/settings` | 仅 ComfyManager 地址与成品目录 |
| POST | `/api/upload` | 上传参考文件 |
| POST | `/api/images/generate` | 生图 / 图生图 |
| POST | `/api/videos/generate` | 生视频（异步 task） |
| POST | `/api/music/generate` | 生音乐 |
| POST | `/api/audio/tts` | 配音 |
| POST | `/api/audio/sfx` | 音效 |
| POST | `/api/audio/voices` | 音色设计 |
| GET | `/api/audio/voices` | 本机设计角色 |
| DELETE | `/api/audio/voices/:voice` | 删除设计角色 |
| POST | `/api/3d/generate` | 生 3D（异步 task） |
| GET | `/api/3d/rig-status` | UniRig / Mixamo 绑骨引擎状态 |
| POST | `/api/3d/rig` | 绑骨导出 GLB（`engine`: auto / unirig / mixamo / bbox） |
| GET | `/api/tasks/:id` | 查询异步任务 |
| GET | `/api/assets` | 资源库 |
| PATCH/DELETE | `/api/assets/:id` | 更新 / 删除资源 |
| GET | `/api/files/{relPath}` | 读取成品文件 |
| POST | `/mcp` | MCP Streamable HTTP（Cursor 等） |

## MCP（Cursor 等）

视铸生成 API 提供 MCP，给 Cursor 等工具调用生图/视频/音乐/配音/音效/3D。模型和工位工作流仍由 ComfyManager 提供，MCP 只调视铸生成。可用 `list_models`、`list_workflows`，生成时同时传 `model` 与 `workflowId`。

先启动：

```bash
npm run manager    # ComfyManager 必须在跑，生成才有模型与工作流
npm run dev        # 视铸 API  http://127.0.0.1:18787/mcp
```

### Cursor 配置

项目里已有 `.cursor/mcp.json`。也可写到用户级 `~/.cursor/mcp.json`。写好后在 Cursor **Settings → Tools & MCP** 启用 **visualforge**。

推荐（Streamable HTTP，连正在跑的生成 API）：

```json
{
  "mcpServers": {
    "visualforge": {
      "url": "http://127.0.0.1:18787/mcp"
    }
  }
}
```

备选（stdio，Cursor 自己拉起进程；在仓库根目录生效）：

```json
{
  "mcpServers": {
    "visualforge": {
      "command": "npm",
      "args": ["run", "mcp", "-w", "@visualforge/frontend"]
    }
  }
}
```

根目录也可 `npm run mcp`。

| | HTTP `/mcp` | stdio |
|---|---|---|
| 前提 | `npm run dev` 已启动生成 API | 本机有 Node，Cursor 会起子进程 |
| 地址 / 命令 | `http://127.0.0.1:18787/mcp` | `npm run mcp -w @visualforge/frontend` |
| 适用 | 日常开发（推荐） | 不想起 HTTP 服务时 |

### 工具

| 工具 | 说明 |
|---|---|
| `get_status` | 视铸、ComfyManager、ComfyUI 是否可用 |
| `list_models` | 各工位主模型（来自 ComfyManager） |
| `generate_image` | 文生图 / 图生图 |
| `generate_video` | 生视频（异步，用 `get_task` 轮询） |
| `generate_music` | 生音乐 |
| `generate_tts` | 配音 |
| `generate_sfx` | 音效 |
| `design_voice` | 音色设计 |
| `generate_3d` | 生 3D（异步） |
| `rig_3d` | 绑骨导出新 GLB：`auto` / `unirig` / `mixamo` / `bbox` |
| `get_task` / `list_tasks` | 异步任务 |
| `list_assets` / `get_asset` / `update_asset` / `delete_asset` | 资源库 |
| `list_voices` / `delete_voice` | 本机设计角色 |

资源：`visualforge://status`、`visualforge://models`。参考图可传本机绝对路径或已上传的 `relPath`。成品 URL 形如 `http://127.0.0.1:18787/api/files/...`。

## Tauri 桌面端

```bash
npm run tauri:dev
npm run tauri:build
```

配置在 `frontend/src-tauri/`。桌面包会带上生成 API sidecar。ComfyUI 仍由本机 ComfyManager 管理，不打进安装包。

## 约定

- 生成**只走 ComfyUI**。不要再接入千问 DashScope 或其他云端生成 API。
- 视铸设置只配 ComfyManager 地址；工作流和模型选项都在管理端。
- `comfymanager` 是单包全栈，不要拆成管理端 frontend / server 两个工程。
- `frontend` 是一个 npm 包（Web + `server/` + Tauri），不要再拆成 `frontend/web` + `frontend/server` 两个 workspace。
- 根目录 workspaces：`frontend`、`comfymanager`。
