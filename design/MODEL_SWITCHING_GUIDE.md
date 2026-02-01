# Model Switching Implementation Guide

## Overview

This document describes the model switching functionality and model filtering mechanism in Echotype.

## Model Filtering

### Problem
The backend returns all models in the catalog, including auxiliary models like punctuation models. These models should be displayed but clearly marked as auxiliary models that work automatically with ASR models.

### Solution
Display all models but distinguish between ASR and auxiliary models:

```typescript
const isASR = entry.kind === "asr";
const isAuxiliary = !isASR; // punctuation, etc.

// ASR models are clickable and switchable
// Auxiliary models are shown but not clickable
<div
  className={`model-card ${isAuxiliary ? "auxiliary" : ""}`}
  onClick={() => isInstalled && isASR && handleModelClick(entry.id)}
  style={{ cursor: isInstalled && isASR ? "pointer" : "default" }}
>
```

### Model Types
- `asr` - Automatic Speech Recognition models (clickable, switchable)
- `punctuation` - Punctuation models (shown with "Auxiliary Model" badge)

### Visual Indicators

**ASR Models:**
- Normal appearance
- Clickable
- Can show "Running" badge when active
- Have settings button

**Auxiliary Models:**
- Slightly faded appearance (opacity: 0.85)
- Gray "Auxiliary Model" badge
- Not clickable
- Show note: "Used automatically with ASR models"
- No settings button

### Catalog Structure
Models are defined in `backend/models_catalog.json`:

```json
[
  {
    "id": "paraformer-offline",
    "family": "sherpa_onnx",
    "kind": "asr",
    "source": "builtin",
    "description": "Quick and high performance, requires low resources. Best for real-time dictation with good accuracy.",
    "languages": ["Chinese", "English"],
    "devices": ["CPU"],
    "performance": "fast",
    "accuracy": "good"
  },
  {
    "id": "punc_ct-transformer_cn-en",
    "family": "sherpa_onnx",
    "kind": "punctuation",
    "source": "builtin",
    "description": "Punctuation model used with Paraformer.",
    "languages": ["Chinese", "English"],
    "devices": ["CPU"]
  }
]
```

### Model Card Display

**ASR Models show:**
- Model ID (title)
- Settings icon (right side of title row)
- "Running" badge (if active)
- Description (user-friendly explanation)
- Languages (from catalog)
- Devices (from catalog)

**Auxiliary Models show:**
- Model ID (title)
- "Auxiliary Model" badge
- Description
- Languages (from catalog)
- Devices (from catalog)
- Note: "Used automatically with ASR models"

**Removed fields:**
- Family (internal detail)
- Type (redundant with badge)
- Current Device (shown in home page status)
- Notes (replaced by description)

## Model Switching Flow

### 1. User Clicks Model Card
```typescript
const handleModelClick = (modelId: string) => {
  if (modelId === activeModelId) {
    return; // Already active
  }
  setSelectedModelId(modelId);
  onModelSwitch(modelId, selectedDevice);
};
```

### 2. Send Model Switch Message
```typescript
const handleModelSwitch = useCallback(
  (modelId: string, device?: string, options?: Record<string, unknown>) => {
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      console.error("Model not found:", modelId);
      return;
    }

    const payload: Record<string, unknown> = {
      type: "model_switch",
      backend: model.family,  // sherpa_onnx or qwen3
      model_id: modelId
    };

    if (device && device !== "auto") {
      payload.device = device;
    }

    if (options) {
      Object.assign(payload, options);
    }

    sendMessage(payload);
    setBackendStatus("loading");
  },
  [models, sendMessage, setBackendStatus]
);
```

### 3. Backend Processes Switch
Backend receives `model_switch` message and:
1. Unloads current model
2. Loads new model
3. Sends `capabilities` message with new model info
4. Sends `status` message with `state: "ready"`

### 4. UI Updates
- `activeModelId` updates from `capabilities` message
- Status changes from "loading" to "ready"
- Model card shows green "Running" badge

## Model-Specific Settings

### Settings Panel
Each model card has a settings button that expands a panel with:

1. **Device Selection** (all models)
   - Auto
   - CPU
   - GPU (if available)

2. **Language Selection** (Qwen3 only)
   - Auto Detect
   - Chinese
   - English
   - Japanese
   - Korean

3. **Qwen3 Backend** (Qwen3 only)
   - transformers (recommended)
   - vllm (high performance)

### Apply Settings
```typescript
const handleApplySettings = (modelId: string) => {
  const isQwen = isQwen3Model(modelId);
  const options: Record<string, unknown> = {};

  if (isQwen) {
    options.qwen_backend = qwenBackend;
  }

  if (capabilities.supports_language_selection && selectedLanguage !== "auto") {
    options.language = selectedLanguage;
  }

  onModelSwitch(modelId, selectedDevice, options);
  setExpandedSettings(null);
};
```

## Backend Startup Progress

### Problem
Users see "Loading..." without knowing what's happening during backend startup.

### Solution
Display detailed progress messages from backend logs:

```typescript
const [loadingMessage, setLoadingMessage] = React.useState("Starting backend...");

React.useEffect(() => {
  const handleBackendLog = (payload: { level: string; message: string }) => {
    if (payload.message.includes("Loading backend modules")) {
      setLoadingMessage("Loading backend modules...");
    } else if (payload.message.includes("Loading speech model")) {
      setLoadingMessage("Loading speech model...");
    } else if (payload.message.includes("Loading punctuation model")) {
      setLoadingMessage("Loading punctuation model...");
    } else if (payload.message.includes("Progress: loaded")) {
      setLoadingMessage("Backend ready!");
    }
  };

  window.echotype?.onBackendLog?.(handleBackendLog);
}, []);
```

### Progress Stages
1. "Starting backend..."
2. "Loading backend modules..."
3. "Loading speech model..."
4. "Loading punctuation model..."
5. "Backend ready!"

## WebSocket Protocol

### Model Switch Request
```json
{
  "type": "model_switch",
  "backend": "qwen3",
  "model_id": "Qwen3-ASR-0.6B",
  "device": "cuda",
  "qwen_backend": "transformers",
  "language": "zh"
}
```

### Backend Response
```json
{
  "type": "status",
  "state": "starting",
  "detail": "switching backend"
}
```

```json
{
  "type": "capabilities",
  "backend": "qwen3",
  "model_id": "Qwen3-ASR-0.6B",
  "supports_language_selection": true,
  "supported_languages": ["zh", "en", "ja", "ko"],
  "devices": ["cpu", "cuda"],
  "default_device": "cuda"
}
```

```json
{
  "type": "status",
  "state": "ready"
}
```

## UI States

### Model Card States
1. **Active** - Green border, "Running" badge
2. **Selected** - Blue border (when clicked but not yet active)
3. **Installed** - Normal appearance, clickable
4. **Not Installed** - Grayed out, "Coming soon" button

### Loading States
1. **Backend Starting** - Orb animation, progress message
2. **Model Switching** - Status changes to "Loading"
3. **Ready** - Orb moves up, cards appear

## Error Handling

### Model Not Found
```typescript
const model = models.find((m) => m.id === modelId);
if (!model) {
  console.error("Model not found:", modelId);
  return;
}
```

### Backend Error
Backend sends error message:
```json
{
  "type": "error",
  "code": "MODEL_LOAD_FAILED",
  "message": "Failed to load model: ..."
}
```

UI displays error and provides "Restart Backend" button.

## Testing

### Test Model Switching
1. Open Models page
2. Click on a different model card
3. Verify:
   - Status changes to "Loading"
   - Progress messages appear
   - New model becomes active (green badge)
   - Capabilities update

### Test Model Filtering
1. Check that all models appear in list
2. Verify ASR models are clickable
3. Verify auxiliary models have "Auxiliary Model" badge
4. Verify auxiliary models are not clickable
5. Verify auxiliary models show explanatory note

### Test Settings
1. Click settings button on a model
2. Change device/language/backend
3. Click "Apply Settings"
4. Verify model switches with new settings

## Future Enhancements

1. **Model Installation**
   - Download models from HuggingFace
   - Show download progress
   - Verify model integrity

2. **Model Information**
   - Show model size
   - Show performance metrics
   - Show accuracy ratings

3. **Model Comparison**
   - Compare multiple models side-by-side
   - Show benchmark results

4. **Custom Models**
   - Allow users to add custom models
   - Validate model format
   - Test model before adding to catalog

## Security Considerations

1. **Model Validation**
   - Only models in `models_catalog.json` can be loaded
   - Model files must exist in `models_dir`
   - Backend validates model format before loading

2. **Path Traversal Prevention**
   - Model paths are resolved relative to `models_dir`
   - No absolute paths allowed
   - No `..` in paths

3. **Code Execution Prevention**
   - Models are data files only (ONNX, safetensors)
   - No arbitrary code execution
   - Sandboxed model loading

## Troubleshooting

### Models Not Appearing
- Check backend logs for errors
- Verify `models_catalog.json` exists
- Verify models have `kind: "asr"`

### Model Switch Fails
- Check backend logs for error details
- Verify model files exist
- Check device availability (GPU)

### Settings Not Applied
- Verify WebSocket connection
- Check browser console for errors
- Verify backend supports the setting
