# OpenClaw Integration Guide

## Overview

EchoType integrates with OpenClaw AI agent, allowing users to send voice-transcribed text directly to OpenClaw for processing. The integration supports both WebSocket (with streaming) and HTTP API modes.

## Quick Start

### Configuration

1. Open EchoType → Integrations page
2. Add OpenClaw integration with these settings:
   - **Host**: `localhost`
   - **Port**: `18789`
   - **Token**: Your OpenClaw access token
   - **Session ID**: `agent:main:main` (default)
   - **Use HTTP API**: ✅ Recommended for simplicity
   - **Output Mode**: `direct` or `both`
   - **Open web interface**: ✅ Optional

### Usage

1. Record voice input in EchoType
2. Press quick action hotkey (default: Ctrl+Shift+Space)
3. Click OpenClaw icon (🦾)
4. Reply appears in quick action window
5. Window stays open to display the response

## Connection Methods

### HTTP API (Recommended)

**Endpoint**: `http://localhost:18789/v1/chat/completions`

**Advantages**:
- ✅ Simple and reliable
- ✅ Single request-response pattern
- ✅ OpenAI-compatible format
- ✅ Easy to debug

**Configuration**:
- Check "Use HTTP API" ✅
- That's it!

**Example Request**:
```bash
curl http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "agent",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### WebSocket (Advanced)

**Endpoint**: `ws://localhost:18789`

**Advantages**:
- ✅ Real-time streaming responses
- ✅ See thinking process
- ✅ Monitor tool calls

**Protocol**: OpenClaw Gateway Protocol v3

**Connection Flow**:
1. Connect to WebSocket
2. Receive `connect.challenge` event
3. Send `connect` request with authentication
4. Receive `hello-ok` response
5. Send `agent` request with message
6. Receive streaming responses

**Important**: `client.id` must be constant `"cli"` (not customizable)

## Session Management

### Auto-routing (Default)
When `sessionKey` is not specified, OpenClaw automatically routes messages based on:
- Agent ID (default: `main`)
- Channel (e.g., `api`)
- Sender (`to` parameter)

Result: Each sender gets isolated conversation history

### Explicit Routing
Set Session ID to specific session key (e.g., `agent:main:main`) to:
- Continue existing conversations
- Share context with web interface
- Handle multi-user scenarios

## Quick Action Window Features

### Reply Display
- Loading spinner while waiting for response
- Green reply box showing OpenClaw's response
- Red error box if request fails
- Automatic window resizing to fit content

### Window Behavior
- Stays open when reply is received (doesn't auto-close)
- Resizes automatically based on content height
- Repositions if it would go off-screen
- Maximum height: 80% of screen height
- Reply content scrollable for long responses

### Window Positioning
- Appears near cursor by default
- Intelligently positions above/below based on available space
- Stays within screen bounds
- Prevents going off-screen when resizing

## Troubleshooting

### HTTP Request Fails
1. Verify OpenClaw HTTP API is enabled in config
2. Check token is correct
3. Test with curl command
4. Check OpenClaw server logs

### WebSocket Connection Fails

**Error: "INVALID_REQUEST: at /client/id: must be equal to constant"**
- Solution: Client ID must be `"cli"` (fixed in latest version)

**Error: "Connect handshake failed"**
- Check token is correct
- Verify OpenClaw supports protocol v3
- Check role and scopes are correct

### Window Closes Immediately
- Fixed in latest version
- Window now stays open when reply is displayed
- Check logs at `~/.echotype/logs/frontend_*.log`

### Reply Not Displayed
- Check console logs for `[ClawbotPlugin]` messages
- Verify HTTP response contains `choices[0].message.content`
- Check OpenClaw server logs

## Testing

### Test Page
Open `test/test_openclaw_api.html` to test:
- WebSocket connection
- Message sending
- Protocol handshake

### Debug Logs
Check `~/.echotype/logs/frontend_*.log` for detailed logs:
- `[ClawbotPlugin] ===== EXECUTE START =====`
- `[ClawbotPlugin] Using WebSocket mode` or `Using HTTP mode`
- `[ClawbotPlugin] WebSocket connected`
- `[ClawbotPlugin] Connect handshake successful`
- `[ClawbotPlugin] Agent request acknowledged`
- `[ClawbotPlugin] Received assistant text`
- `[QuickActionWindow] Reply received`
- `[QuickActionWindow] Notifying main process: has reply`

## Technical Details

### Files Modified
- `frontend/src/services/integrations/plugins/ai.ts` - ClawbotPlugin implementation
- `frontend/src/components/QuickActionWindow.tsx` - Reply display and window management
- `frontend/electron/quick-action-window.ts` - Window creation and resizing
- `frontend/electron/main.ts` - IPC handlers
- `frontend/src/styles.css` - UI styles

### WebSocket Protocol v3

**Connect Request**:
```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "1.0.0",
      "platform": "web",
      "mode": "cli"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": {"token": "YOUR_TOKEN"}
  }
}
```

**Agent Request**:
```json
{
  "type": "req",
  "id": "2",
  "method": "agent",
  "params": {
    "message": "Your message",
    "to": "echotype-user",
    "sessionKey": "agent:main:main"
  }
}
```

**Streaming Events**:
- `lifecycle` stream: `start` and `end` phases
- `assistant` stream: AI response text
- `chat` events: Final message with `state: "final"`

## Best Practices

1. **Use HTTP API** for simplicity and reliability
2. **Set Output Mode to `direct`** for full automation
3. **Enable "Open web interface"** to view history
4. **Use default Session ID** unless you need specific routing
5. **Check console logs** for debugging

## Future Enhancements

- Session persistence across requests
- Reply action buttons (copy, follow-up, etc.)
- System notifications for replies
- Improved error handling and retry logic

## References

- OpenClaw HTTP API: `http://localhost:18789/v1/chat/completions`
- OpenClaw WebSocket: `ws://localhost:18789`
- OpenClaw Web UI: `http://localhost:18789/chat?session=<SESSION>&token=<TOKEN>`
- Test page: `test/test_openclaw_api.html`
