/**
 * [INPUT]: 依赖 ipc-contract 的 LicensesView 类型
 * [OUTPUT]: 导出 MOCK_LICENSES（应用版本与开源组件列表；模型许可证由 mockBridge 从清单补上）
 * [POS]: mockBridge 的许可证假数据。真实数据由 Core 在打包时生成 resources/licenses/third-party.json。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { LicensesView } from "../../electron/ipc-contract";

export const MOCK_LICENSES: Omit<LicensesView, "models"> = {
  appVersion: "4.0.0-mock",
  components: [
    { name: "Electron", version: "31.7.7", license: "MIT", url: "https://github.com/electron/electron/blob/main/LICENSE" },
    { name: "React", version: "18.3.1", license: "MIT", url: "https://github.com/facebook/react/blob/main/LICENSE" },
    { name: "sherpa-onnx", version: "2.0.1", license: "Apache-2.0", url: "https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE" },
    { name: "ONNX Runtime", version: "1.22.0", license: "MIT", url: "https://github.com/microsoft/onnxruntime/blob/main/LICENSE" },
    { name: "llama.cpp", version: "b6000", license: "MIT", url: "https://github.com/ggml-org/llama.cpp/blob/master/LICENSE" },
    { name: "Silero VAD", version: "5.1", license: "MIT", url: "https://github.com/snakers4/silero-vad/blob/master/LICENSE" },
    { name: "Zustand", version: "5.0.10", license: "MIT", url: "https://github.com/pmndrs/zustand/blob/main/LICENSE" },
    { name: "i18next", version: "25.8.0", license: "MIT", url: "https://github.com/i18next/i18next/blob/master/LICENSE" },
    { name: "dnd kit", version: "6.3.1", license: "MIT", url: "https://github.com/clauderic/dnd-kit/blob/master/LICENSE" },
    { name: "React Icons", version: "5.5.0", license: "MIT", url: "https://github.com/react-icons/react-icons/blob/master/LICENSE" },
  ],
};
