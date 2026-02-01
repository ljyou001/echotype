/**
 * Logger工具 - 同时输出到console和日志文件
 */

let isInitialized = false;

export function initLogger() {
  if (isInitialized) return;
  isInitialized = true;

  // Save original console methods
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  // Override console.log
  console.log = (...args: any[]) => {
    originalLog(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    window.echotype?.log?.('INFO', message);
  };

  // Override console.warn
  console.warn = (...args: any[]) => {
    originalWarn(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    window.echotype?.log?.('WARN', message);
  };

  // Override console.error
  console.error = (...args: any[]) => {
    originalError(...args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    window.echotype?.log?.('ERROR', message);
  };
}
