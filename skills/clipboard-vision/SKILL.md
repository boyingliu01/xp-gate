---
name: clipboard-vision
description: 读取剪贴板图片并通过多模态模型生成文字描述。跨平台支持 Windows (PowerShell) 和 WSL/Linux (bash+xclip)。
triggers:
  - "/clipboard"
  - "clipboard"
  - "剪贴板"
  - "描述剪贴板"
  - "读剪贴板"
  - "看图"
  - "描述图片"
triggers_negative_examples:
  - "分享到剪贴板" (不是读剪贴板)
---

读取系统剪贴板中的图片，调用多模态视觉模型（LOCAL/Qwen3.5-122B-A10B）生成详细的文字描述。

## 使用场景

- 用户粘贴了截图但当前模型不支持图片输入
- 快速获取截图中的代码、错误信息、UI 界面等文字内容
- 需要在 WSL 环境中读取 Windows 剪贴板中的图片

## 跨平台支持

### Windows (PowerShell)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\think\.config\opencode\skills\clipboard-vision\describe-clipboard.ps1"
```

使用 .NET `System.Windows.Forms.Clipboard` API 直接读取剪贴板图片，速度最快。

### WSL / Linux (bash)

```bash
bash /mnt/c/Users/think/.config/opencode/skills/clipboard-vision/describe-clipboard.sh
```

使用 `xclip` 读取剪贴板。脚本自动检测平台并选择对应工具（Linux: xclip/wl-paste, macOS: osascript）。

## 依赖

| 平台 | 依赖 |
|------|------|
| Windows | PowerShell 5.1+ (.NET Framework) |
| WSL/Linux | `xclip` 或 `wl-clipboard`, `curl` |
| macOS | `osascript` (系统内置) |

## 工作流

1. 用户 `Ctrl+C` 复制截图到剪贴板
2. 用户输入 `/clipboard`（可同时粘贴图片，不影响）
3. skill 检测当前平台，选择对应脚本
4. 脚本从剪贴板读取图片（PNG base64）
5. 调用 vision API 生成文字描述
6. 返回描述内容给用户

## 限制

- 非零摩擦方案（需要多输入 `/clipboard`）
- 需要剪贴板中有有效图片数据
- vision API 调用需要网络连接

## API 配置

- Model: `LOCAL/Qwen3.5-122B-A10B`
- Endpoint: `https://lab.iwhalecloud.com/gpt-proxy/chat/completions`
- Max tokens: 1024
- Temperature: 0.1
