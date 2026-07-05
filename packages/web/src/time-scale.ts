// M15.7: 「1日」の実時間を web 側の派生量として切り出す。sim は「1 tick」
// しか知らない (アーキテクチャ方針)。ここでは「×1 speed で 1日 = 何 ms か」
// だけを決め、sim-worker.ts が TICKS_PER_DAY (day-loop.ts) で割って
// 1 tick あたりの実時間ペースを導く。
//
// 既定は 144,000ms (2.4分)。開発/e2e では日を一瞬で終わらせたいことが多いので、
// URL パラメータ `?dayms=` か localStorage `morpho.dayMs.v1` で上書きできる
// (どちらも純粋関数 resolveDayMs に集約し、ブラウザ globals に触るのは
// readDayMsOverride() だけに閉じる → vitest でロジックだけ固定できる)。

export const DEFAULT_DAY_MS = 144_000;

const STORAGE_KEY = 'morpho.dayMs.v1';
const PARAM_KEY = 'dayms';

function positiveNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// URL のクエリ文字列と localStorage の値から、優先順位 (URL > storage > 既定)
// で 1日の実時間 (ms, ×1 speed 基準) を決める。DOM/globalThis に依存しない
// 純粋関数なので vitest で固定できる。
export function resolveDayMs(search: string, storedValue: string | null): number {
  const fromParam = positiveNumber(new URLSearchParams(search).get(PARAM_KEY));
  if (fromParam !== null) return fromParam;
  const fromStorage = positiveNumber(storedValue);
  if (fromStorage !== null) return fromStorage;
  return DEFAULT_DAY_MS;
}

// メインスレッド専用: 実際に location/localStorage を読んで解決する。
export function readDayMsOverride(): number {
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode 等は諦める */ }
  return resolveDayMs(location.search, stored);
}
