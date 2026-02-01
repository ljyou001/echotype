# OpenClaw 集成指南

## 🔌 重要发现：OpenClaw 使用 WebSocket

OpenClaw 使用 WebSocket 连接，格式为：
```
ws://host:port/token/session
```

例如：
```
ws://localhost:18789/bddb3bed8dcc619a49ce9ed36f976ad0028122aad56aeebb/agent:main:main
```

## 📋 配置步骤

### 1. 在 EchoType 中添加 OpenClaw 集成

1. 打开 EchoType 应用
2. 进入"集成"页面（Integrations）
3. 点击"添加集成"按钮
4. 选择 🦾 OpenClaw / Clawbot
5. 填写配置：

   - **Host**: `localhost`
   - **Port**: `18789`
   - **Token**: `bddb3bed8dcc619a49ce9ed36f976ad0028122aad56aeebb`
   - **Session ID**: `agent:main:main` (默认值)
   - **Output Mode**: 选择 `direct` 或 `both`
   - **Open web interface after sending**: ✅ 勾选（推荐）
   - **Connection Timeout**: `10000` (可选，默认 10 秒)

6. 保存配置

### 2. 测试连接

打开测试页面：`test/test_openclaw_api.html`

1. 确认配置信息已填写：
   - Host: `localhost`
   - Port: `18789`
   - Token: 你的 token
   - Session: `agent:main:main`

2. 点击"🔍 测试连接"按钮
   - 如果显示"✅ WebSocket 连接成功!"，说明连接正常

3. 点击"📤 发送消息"测试实际消息发送
   - 应该显示"✅ 消息发送成功！"

4. 点击"🌐 打开 Web 界面"确认可以访问 Web UI

### 3. 使用快捷操作

1. 在 EchoType 中录制一段语音
2. 按下快捷键（默认：Ctrl+Shift+Space）打开快捷操作窗口
3. 点击 🦾 OpenClaw 图标
4. 应该会：
   - 通过 WebSocket 发送消息到 OpenClaw
   - 显示成功通知
   - 自动打开 OpenClaw Web 界面（如果勾选）

## 🔍 调试方法

### 查看控制台日志

1. 打开浏览器开发者工具（F12）
2. 切换到 Console 标签
3. 触发快捷操作
4. 查找以下日志：
   - `[ClawbotPlugin] Connecting to WebSocket:` - WebSocket URL
   - `[ClawbotPlugin] WebSocket connected` - 连接成功
   - `[ClawbotPlugin] Sending:` - 发送的消息
   - `[ClawbotPlugin] Received:` - 收到的响应

### 常见问题

#### 问题 1: "WebSocket connection timeout"

**原因**：
- OpenClaw 服务未运行
- Host/Port 不正确
- Token 不正确

**解决方案**：
1. 确认 OpenClaw 正在运行
2. 在浏览器中访问：`http://localhost:18789/chat?session=agent:main:main&token=YOUR_TOKEN`
3. 使用测试页面验证 WebSocket 连接
4. 检查控制台日志中的 WebSocket URL 是否正确

#### 问题 2: "WebSocket connection failed"

**原因**：WebSocket 连接被拒绝

**解决方案**：
1. 确认 OpenClaw 服务正在运行
2. 检查防火墙设置
3. 确认 Token 正确
4. 尝试在测试页面中测试连接

#### 问题 3: 连接成功但没有响应

**原因**：消息格式可能不正确

**当前尝试的格式**：
```json
{ "message": "your text here" }
```

**如果不工作，可以尝试**：
- `{ "text": "..." }`
- `{ "content": "..." }`
- `{ "query": "..." }`
- 纯文本

代码会在连接成功后发送消息，然后等待响应或自动关闭。

#### 问题 4: 自动回退到 Web 界面

如果 WebSocket 连接失败，代码会自动：
1. 打开 OpenClaw Web 界面
2. 将消息复制到剪贴板
3. 显示提示让用户手动粘贴

这确保了即使 WebSocket 不可用，你仍然可以使用 OpenClaw。

## 🔧 技术细节

### OpenClaw WebSocket 协议

OpenClaw 使用基于事件的 WebSocket 协议，需要先完成握手：

#### 1. 连接
```
ws://host:port/token/session
```

#### 2. 握手流程

**步骤 1：服务器发送 challenge**
```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "10ca3578-e70a-4333-aa87-0e85bc55b0aa",
    "ts": 1769908032101
  }
}
```

**步骤 2：客户端响应 challenge**
```json
{
  "type": "event",
  "event": "connect.challenge.response",
  "payload": {
    "nonce": "10ca3578-e70a-4333-aa87-0e85bc55b0aa"
  }
}
```

**步骤 3：发送实际消息**
```json
{
  "type": "message",
  "payload": {
    "text": "你的消息内容",
    "content": "你的消息内容"
  }
}
```

**步骤 4：接收响应**
OpenClaw 会发送响应消息，然后可能关闭连接。

### 消息发送流程

1. 建立 WebSocket 连接
2. 等待服务器发送 `connect.challenge` 事件
3. 提取 `nonce` 并发送 `connect.challenge.response`
4. 等待 100-200ms（让服务器处理响应）
5. 发送实际消息（`type: "message"`）
6. 等待响应或确认
7. 连接可能会自动关闭（这是正常的）

### 为什么消息不显示在 Web 界面？

OpenClaw 的 WebSocket 连接是**独立的会话**。通过 WebSocket 发送的消息：
- ✅ 会被 OpenClaw 接收和处理
- ✅ OpenClaw 会执行相应的操作
- ❌ 但不会显示在 Web 界面的聊天历史中

这是因为：
1. WebSocket 连接使用的是独立的 session
2. Web 界面有自己的 session 和消息历史
3. 它们是两个不同的通信通道

### 解决方案

如果你想在 Web 界面中看到消息，有两个选择：

**选项 1：使用相同的 session**
- 在 Web 界面中查看当前的 session ID
- 在 EchoType 配置中使用相同的 session ID
- 这样消息可能会出现在同一个会话中

**选项 2：使用混合模式**
- Output Mode 设置为 `both`
- 消息会通过 WebSocket 发送（OpenClaw 处理）
- 同时打开 Web 界面（你可以看到历史和响应）
- 这是推荐的方式！

### 超时处理

- 默认超时：10 秒
- 可在配置中自定义
- 超时后自动关闭连接并回退到 Web 界面

### 代码位置

- 插件实现：`frontend/src/services/integrations/plugins/ai.ts` (ClawbotPlugin)
- 快捷窗口：`frontend/src/components/QuickActionWindow.tsx`
- 测试页面：`test/test_openclaw_api.html`

## 📝 下一步

1. **重新构建前端**：
   ```bash
   cd frontend
   npm run build
   ```

2. **重启 EchoType 应用**

3. **更新配置**：
   - 删除旧的 OpenClaw 配置（如果有）
   - 添加新的配置，使用 Host/Port 而不是 Endpoint

4. **测试连接**：
   - 打开 `test/test_openclaw_api.html`
   - 点击"测试连接"
   - 点击"发送消息"

5. **使用快捷操作**：
   - 录制语音
   - 按快捷键
   - 点击 🦾 图标
   - 查看控制台日志

## 💡 配置示例

在 EchoType 集成配置中：

```
Name: OpenClaw
Icon: 🦾
Host: localhost
Port: 18789
Token: bddb3bed8dcc619a49ce9ed36f976ad0028122aad56aeebb
Session ID: agent:main:main
Output Mode: direct (或 both)
Open web interface: ✅
Connection Timeout: 10000
```

这样配置后，WebSocket URL 将是：
```
ws://localhost:18789/bddb3bed8dcc619a49ce9ed36f976ad0028122aad56aeebb/agent:main:main
```
