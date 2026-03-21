// globals.d.ts – Type declarations for Tampermonkey/Greasemonkey GM_* APIs

declare function GM_getValue(key: string, defaultValue?: unknown): unknown;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_addStyle(css: string): void;
declare function GM_registerMenuCommand(name: string, fn: () => void): void;
