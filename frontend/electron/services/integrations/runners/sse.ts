/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 导出 readSse：把 fetch 响应体按 SSE 拆成 data 事件
 * [POS]: openai 与 anthropic 两个 Runner 共用的流解析。只认 "data:" 与 "event:" 行，按空行分事件，
 *        兼容 \r\n；"[DONE]" 结束。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
function parseBlock(block: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        const ev = parseBlock(block);
        if (ev) {
          if (ev.data === "[DONE]") return;
          yield ev;
        }
      }
    }
    const tail = parseBlock(buffer);
    if (tail && tail.data !== "[DONE]") yield tail;
  } finally {
    reader.releaseLock();
  }
}
