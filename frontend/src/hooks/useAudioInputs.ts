/**
 * [INPUT]: 依赖 react 的 useState/useEffect/useCallback；依赖 bridge().audio.listInputs
 * [OUTPUT]: 导出 useAudioInputs()：引擎侧输入设备列表、当前选中设备、刷新函数
 * [POS]: 设备列表的拉取型查询。设备 id 来自引擎，选中即是真正录音的设备。
 *        契约没有设备热插拔事件，所以窗口重新获得焦点时刷新一次。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useState } from "react";
import type { AudioInput } from "../../electron/ipc-contract";
import { bridge } from "../bridge";

export function useAudioInputs(selectedId: string | null) {
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInputs(await bridge().audio.listInputs());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // null 表示跟随系统默认设备
  const current = selectedId ? inputs.find((i) => i.id === selectedId) : inputs.find((i) => i.isDefault);
  return { inputs, current, loaded, refresh };
}
