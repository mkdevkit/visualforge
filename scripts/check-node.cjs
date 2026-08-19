var major = parseInt(String(process.versions.node).split(".")[0], 10);
if (major >= 20) process.exit(0);

console.error("视铸 / ComfyManager 需要 Node.js 20 或更高版本，当前是 v" + process.versions.node + "。");
console.error("Ubuntu 自带的 apt nodejs 通常太旧，请不要用它跑本项目。");
console.error("");
if (process.platform === "linux") {
  console.error("推荐安装 Node 22（先建源目录，否则脚本会 tee 失败却仍显示成功）：");
  console.error("  sudo mkdir -p /etc/apt/sources.list.d");
  console.error("  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -");
  console.error("  ls /etc/apt/sources.list.d/nodesource.sources");
  console.error("  sudo apt-get install -y nodejs");
  console.error("  hash -r && node -v");
} else if (process.platform === "win32") {
  console.error("请从 https://nodejs.org 安装 LTS（20 或 22），装完重开终端后执行 node -v。");
} else {
  console.error("请安装 Node.js 20+ 后再运行。");
}
console.error("");
console.error("确认 node -v 为 v20+ 后，再执行 npm run manager。");
process.exit(1);
