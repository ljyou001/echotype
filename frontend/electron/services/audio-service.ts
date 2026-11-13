/**
 * [INPUT]: 依赖 engine/engine-supervisor 的 EngineGateway、engine/protocol 的错误码；依赖 core/logger；
 *          依赖 ipc-contract 的 Settings、AudioInput
 * [OUTPUT]: 导出 AudioService（apply / listInputs / setMicTest）
 * [POS]: 麦克风配置的唯一出口。设备列表来自引擎，所以 UI 选中的 id 就是真正录音的 id（修复 v2 的"双脑"）。
 *        引擎每次（重新）连接都重放 mic.configure 与麦克风测试状态：引擎不持久化任何东西。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AudioInput, Settings } from "../ipc-contract.js";
import type { Logger } from "../core/logger.js";
import type { EngineGateway } from "../engine/engine-supervisor.js";
import { EngineErrorCode, toAppError } from "../engine/protocol.js";

export class AudioService {
  private micTest = false;
  private readonly log: Logger;

  constructor(
    private readonly engine: EngineGateway,
    private readonly settings: () => Settings,
    logger: Logger,
  ) {
    this.log = logger.scope("audio");
    engine.onConnected(() => {
      void this.apply();
      if (this.micTest) void this.setMicTest(true);
    });
  }

  /** 把 settings.audio 下发给引擎。所选设备已拔出时回落到系统默认，不改写用户设置。 */
  async apply(): Promise<void> {
    if (!this.engine.isConnected()) return;
    const { inputDeviceId, keepMicWarm } = this.settings().audio;
    try {
      const r = await this.engine.request("mic.configure", { device_id: inputDeviceId, keep_warm: keepMicWarm });
      this.log.info("mic configured", r);
    } catch (err) {
      const error = toAppError(err);
      if (error.code === EngineErrorCode.DEVICE_UNAVAILABLE && inputDeviceId !== null) {
        this.log.warn("selected input unavailable; using the system default", { inputDeviceId });
        await this.engine.request("mic.configure", { device_id: null, keep_warm: keepMicWarm }).catch((e) => this.log.error("mic.configure failed", e));
      } else {
        this.log.error("mic.configure failed", error);
      }
    }
  }

  async listInputs(): Promise<AudioInput[]> {
    const { inputs } = await this.engine.request("devices.list", {});
    return inputs.map((d) => ({ id: d.id, name: d.name, isDefault: d.is_default }));
  }

  async setMicTest(enabled: boolean): Promise<void> {
    this.micTest = enabled;
    if (!this.engine.isConnected()) return;
    await this.engine.request("mic.test", { enabled });
  }
}
