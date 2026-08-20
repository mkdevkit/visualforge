import { PageHead } from "../components/PageHead";
import { useSettings } from "../lib/settings";

const endpoints = [
  ["GET", "/api/health", "健康检查（含 ComfyManager 与千问配置状态）"],
  ["GET", "/api/models", "从 ComfyManager 读取 ComfyUI 工位模型与工作流（千问不用这个）"],
  ["GET", "/api/qwen/models", "千问云静态目录（视铸生成服务自带，不经过 ComfyManager）"],
  ["GET/PUT", "/api/settings", "ComfyManager 地址、千问 Key、工位工具、成品目录"],
  ["POST", "/api/upload", "上传参考文件"],
  ["POST", "/api/images/generate", "生图 / 图生图"],
  ["POST", "/api/videos/generate", "生视频（返回 task）"],
  ["POST", "/api/music/generate", "生音乐"],
  ["POST", "/api/audio/tts", "配音"],
  ["POST", "/api/audio/sfx", "音效"],
  ["POST", "/api/audio/voices", "音色设计"],
  ["GET", "/api/audio/voices", "本机设计角色"],
  ["DELETE", "/api/audio/voices/:voice", "删除设计角色"],
  ["POST", "/api/3d/generate", "生 3D（返回 task）"],
  ["GET", "/api/3d/rig-status", "UniRig / Mixamo 绑骨引擎状态"],
  ["POST", "/api/3d/rig", "绑骨导出 GLB（UniRig / Mixamo / 几何估骨）"],
  ["GET", "/api/tasks/:id", "查询异步任务"],
  ["GET", "/api/assets", "资源库"],
  ["PATCH/DELETE", "/api/assets/:id", "更新 / 删除资源"],
  ["GET", "/api/files/{relPath}", "读取成品文件"],
  ["POST", "/mcp", "MCP Streamable HTTP（Cursor 等）"],
];

export function ApiDocs() {
  const settings = useSettings();
  const mgr = settings?.managerUrl || "http://127.0.0.1:18788";
  return (
    <section className="mx-auto max-w-4xl px-8 py-10">
      <PageHead kicker="Open API" title="本地调用" desc={`生成接口和 MCP 在 18787。请求体可带 engine=comfyui 或 qwen。ComfyUI 部署在 ComfyManager ${mgr}；千问走 qianwenai.com / DashScope。`} />
      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <tbody>
            {endpoints.map(([m, p, d]) => (
              <tr key={p} className="border-t border-line first:border-0">
                <td className="px-4 py-3 font-mono text-xs text-brass">{m}</td>
                <td className="px-4 py-3 font-mono text-xs">{p}</td>
                <td className="px-4 py-3 text-mute">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
