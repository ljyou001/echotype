/**
 * [INPUT]: 无依赖（键码取自 libuiohook 的 VC_* 常量，与 uiohook-napi 的 UiohookKey 一致）
 * [OUTPUT]: 导出 parseAccelerator、validateAccelerator、defaultAccelerator、ParsedAccelerator、MODIFIER_KEYCODES
 * [POS]: 热键字符串（如 "RCtrl"、"RAlt+L"）的唯一解释者。hotkey-service 用它匹配按键，
 *        settings 用它校验输入。纯函数，不加载原生模块，可在测试中直接运行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// 键名 → 键码集合。泛指修饰键（"Ctrl"）左右两侧皆可满足，带侧修饰键（"RCtrl"）只认一侧。
// ============================================================
const VC = {
  Ctrl: 29, CtrlRight: 3613, Alt: 56, AltRight: 3640, Shift: 42, ShiftRight: 54, Meta: 3675, MetaRight: 3676,
} as const;

const MODIFIER_SLOTS: Record<string, number[]> = {
  Ctrl: [VC.Ctrl, VC.CtrlRight], Control: [VC.Ctrl, VC.CtrlRight], LCtrl: [VC.Ctrl], RCtrl: [VC.CtrlRight],
  Alt: [VC.Alt, VC.AltRight], Option: [VC.Alt, VC.AltRight], LAlt: [VC.Alt], RAlt: [VC.AltRight],
  Shift: [VC.Shift, VC.ShiftRight], LShift: [VC.Shift], RShift: [VC.ShiftRight],
  Cmd: [VC.Meta, VC.MetaRight], Command: [VC.Meta, VC.MetaRight], Meta: [VC.Meta, VC.MetaRight],
  LCmd: [VC.Meta], RCmd: [VC.MetaRight],
};

const PLAIN_KEYS: Record<string, number> = {
  Space: 57, Enter: 28, Tab: 15, Escape: 1, Backspace: 14, CapsLock: 58,
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50,
  N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
  "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  F13: 91, F14: 92, F15: 93, F16: 99, F17: 100, F18: 101, F19: 102, F20: 103, F21: 104, F22: 105, F23: 106, F24: 107,
};

export const MODIFIER_KEYCODES: ReadonlySet<number> = new Set(Object.values(VC));

/** 一个 slot 是一组可互换的键码：其中任一被按下，该 slot 即满足。 */
export interface ParsedAccelerator {
  slots: number[][];
  keycodes: ReadonlySet<number>;
}

function slotFor(name: string): number[] | null {
  if (MODIFIER_SLOTS[name]) return MODIFIER_SLOTS[name];
  const key = PLAIN_KEYS[name] ?? PLAIN_KEYS[name.toUpperCase()];
  return key === undefined ? null : [key];
}

export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const slots: number[][] = [];
  for (const part of parts) {
    const slot = slotFor(part);
    if (!slot) return null;
    slots.push(slot);
  }
  return { slots, keycodes: new Set(slots.flat()) };
}

export function validateAccelerator(accelerator: string): { valid: boolean; error?: string } {
  if (typeof accelerator !== "string" || accelerator.trim() === "") return { valid: false, error: "Enter a shortcut." };
  const parts = accelerator.split("+").map((p) => p.trim());
  const unknown = parts.find((p) => !slotFor(p));
  if (unknown !== undefined) return { valid: false, error: `Unknown key “${unknown}”.` };
  const parsed = parseAccelerator(accelerator)!;
  const keys = parsed.slots.map((s) => s.join(","));
  if (new Set(keys).size !== keys.length) return { valid: false, error: "Each key can appear only once." };
  const isModifier = (p: string) => Boolean(MODIFIER_SLOTS[p]);
  if (parts.length === 1) {
    const ok = isModifier(parts[0]) || parts[0] === "CapsLock" || /^F([1-9]|1\d|2[0-4])$/.test(parts[0]);
    return ok ? { valid: true } : { valid: false, error: "On its own, use a modifier, CapsLock, or a function key (F1–F24)." };
  }
  if (!parts.some(isModifier)) return { valid: false, error: "Shortcuts need at least one modifier (Ctrl, Alt, Shift, or Cmd)." };
  return { valid: true };
}

export function defaultAccelerator(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "RAlt" : "RCtrl";
}
