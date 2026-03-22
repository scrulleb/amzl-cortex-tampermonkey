// globals.d.ts – Type declarations for Tampermonkey/Greasemonkey GM_* APIs

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_addStyle(css: string): void;
declare function GM_registerMenuCommand(name: string, fn: () => void): void;

declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string, mode?: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
    createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string;
    createDataURL(cellSize?: number, margin?: number): string;
    createImgTag(cellSize?: number, margin?: number, alt?: string): string;
  }
  function qrcode(typeNumber: number, errorCorrectionLevel: string): QRCode;
  export = qrcode;
}
