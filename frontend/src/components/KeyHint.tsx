/**
 * [INPUT]: 依赖 react 的 Fragment；依赖 utils/format 的 splitKeyToken
 * [OUTPUT]: 导出 KeyHint 组件
 * [POS]: 把含 KEY_TOKEN 占位符的译文渲染成"文字 + <kbd>按键</kbd> + 文字"。
 *        让各语言自由安排按键在句中的位置，不再拆成 prefix/suffix 两段。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Fragment } from "react";
import { splitKeyToken } from "../utils/format";

export function KeyHint({ text, keyLabel }: { text: string; keyLabel: string }) {
  const parts = splitKeyToken(text);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <kbd>{keyLabel}</kbd>}
        </Fragment>
      ))}
    </>
  );
}
