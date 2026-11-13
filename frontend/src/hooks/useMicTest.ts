/**
 * [INPUT]: 依赖 react 的 useState/useEffect/useCallback；依赖 bridge().audio.setMicTest
 * [OUTPUT]: 导出 useMicTest()：[enabled, setEnabled]
 * [POS]: 麦克风测试开关。打开后 Core 让引擎推电平，LevelMeter 订阅显示。
 *        组件卸载（离开页面）时自动关闭，避免麦克风在后台一直开着。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useState } from "react";
import { bridge } from "../bridge";

export function useMicTest(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(false);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    void bridge().audio.setMicTest(next);
  }, []);

  useEffect(() => {
    return () => void bridge().audio.setMicTest(false);
  }, []);

  return [enabled, setEnabled];
}
