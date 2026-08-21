# Watchboard｜稍后再看工作台

一个 Chrome Manifest V3 扩展，在新标签页统一展示和整理 B站、YouTube 的稍后再看视频。

## 功能

- 新标签页视频工作台：跨平台搜索、筛选、排序和统计。
- B站、YouTube 已登录页面采集；只有完整同步才会软归档缺失条目。
- 一个主分类 + 多个标签，支持本地规则、手动覆盖和分类兴趣权重。
- 1–5 星“想看程度”和可解释的 0–100 智能优先级。
- 可选 OpenAI 兼容语义分类，默认关闭且仅手动触发。
- IndexedDB 本地资料库、旧版快照迁移，以及 JSON/CSV 导出。

## 安装或升级

1. 打开 `chrome://extensions/` 并开启“开发者模式”。
2. 新安装：点击“加载已解压的扩展程序”，选择稳定仓库 `C:\Users\Zplea\ChromeExtensions\watchlater-workbench`。
3. 从 v0.3 迁移到固定 ID 的 v0.4：先禁用旧扩展，再加载稳定仓库；本地资料库从空状态重新同步。
4. v0.4 之后升级：在稳定仓库执行 `git pull`，然后在扩展卡片点击“重新加载”。
5. 新建标签页即可进入工作台。

## 同步

1. 在新标签页点击 B站或 YouTube 的“去同步”。
2. 扩展会打开或复用相应的稍后再看页面，并在右下角显示采集进度。
3. 页面滚动至末尾后完成快照；不再存在的条目进入归档，评分和分类仍保留。
4. 平时手动访问稍后再看页面也会增量更新，但不会归档任何条目。

YouTube Data API 不允许读取真正的 Watch Later，因此 YouTube 使用已登录页面采集，不使用 OAuth。

## AI 分类

在设置中填写 OpenAI 兼容的 Base URL、模型和 API Key，并授予该接口来源权限。工作台只会在你手动确认后发送标题、作者、平台、原始分区和时长；Key 保存在 `chrome.storage.local`，不会进入导出文件。

## 开发与测试

```bash
npm test
npm run dev
npm run extension:id
```

扩展不需要构建步骤。先在设置页开启“开发模式”，工作台顶部和扩展弹窗会出现“开发重载”：

- 只修改 `newtab.html`、`newtab.css` 或当前页面脚本时，刷新页面通常就能看到结果。
- 修改后台 Service Worker、`manifest.json` 或采集脚本后，点击“开发重载”，扩展会调用 `chrome.runtime.reload()` 重新读取本地文件；随后刷新对应的工作台或平台页面。
- Chrome 直接加载本 Git 仓库时，`npm run dev` 自动进入直接加载模式，不复制文件。
- 如果 Git 仓库与 Chrome 加载目录不同，在仓库根目录创建不提交的 `.watchboard-dev.json`：`{"targetDir":"Chrome 当前加载的绝对目录"}`。`npm run sync:chrome` 单次同步，`npm run dev` 则持续监视并同步；后台或 Manifest 变化后仍需点击“开发重载”。

### Chrome 从哪里读取代码

“加载已解压的扩展程序”不会把代码复制进 Chrome。Chrome 只记录当时选择的目录，并在刷新或重载扩展时从该目录重新读取文件。扩展 API 不会暴露这个本地路径。推荐让 Chrome 直接加载稳定 Git 仓库，这样源码与运行目录只有一份。

Manifest 已提交固定公钥；运行 `npm run extension:id` 可显示确定的扩展 ID，因此从 GitHub 重新克隆到其他路径时仍保持相同身份。浏览器本地数据不会进入 GitHub，移动、重装或卸载前仍应先导出 JSON 备份。

### 扩展身份密钥

- 公钥以 Manifest `key` 提交，用于固定开发扩展 ID，不是秘密。
- 私钥位于 `C:\Users\Zplea\.watchboard\keys\watchlater-workbench.pem`，不进入仓库、日志或安装包。
- 本机使用 Git for Windows 自带的 `C:\Program Files\Git\usr\bin\openssl.exe` 生成 2048 位 RSA 密钥并导出 DER 公钥。
- 私钥仅在未来需要用同一身份打包时使用；普通已解压开发不读取私钥。

恢复代码时从 GitHub 克隆仓库，确认 `npm run extension:id` 的输出与 Chrome 中现有 ID 一致，再点击“加载已解压”或“重新加载”。GitHub 只保存代码，不保存浏览器中的评分、分类和稍后再看快照。

## 权限

- `storage`：保存设置、同步状态和旧版迁移标记。
- `tabs`：根据明确的同步操作打开或复用平台页面。
- B站、YouTube Host 权限：采集稍后再看页面和读取 B站公开视频元数据。
- 可选 Host 权限：仅在启用自定义 AI 接口时按来源请求。

首版只读平台数据，不会删除、移动或修改任何平台播放列表条目。
