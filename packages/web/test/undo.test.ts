import { describe, it, expect } from 'vitest';
import { UndoStack, type FieldLike } from '../src/undo.js';

function makeField(size: number, fill = 0): FieldLike {
  return { size, data: new Float32Array(size * size).fill(fill) };
}

describe('UndoStack', () => {
  it('stroke 中に変更したセルを、undo で元の値に戻す', () => {
    const field = makeField(8, 0);
    const undo = new UndoStack();
    undo.beginStroke();
    undo.recordBefore(field, 4, 4, 1);
    field.data[4 * 8 + 4] = 0.9;
    undo.endStroke();

    expect(field.data[4 * 8 + 4]).toBeCloseTo(0.9);
    undo.undo();
    expect(field.data[4 * 8 + 4]).toBe(0);
  });

  it('1 stroke 内の複数スタンプが重なっていても、逆順に戻して正しく巻き戻す', () => {
    const field = makeField(8, 0);
    const undo = new UndoStack();
    undo.beginStroke();
    // 1発目: セル(3,3)を 0 → 0.5
    undo.recordBefore(field, 3, 3, 1);
    field.data[3 * 8 + 3] = 0.5;
    // 2発目 (重なる): セル(3,3)を 0.5 → 0.8, セル(4,3)を 0 → 0.3
    undo.recordBefore(field, 4, 3, 1);
    field.data[3 * 8 + 3] = 0.8;
    field.data[3 * 8 + 4] = 0.3;
    undo.endStroke();

    undo.undo();
    expect(field.data[3 * 8 + 3]).toBe(0);
    expect(field.data[3 * 8 + 4]).toBe(0);
  });

  it('何も変更しなかった stroke は積まれない (canUndo が false のまま)', () => {
    const field = makeField(8, 0);
    const undo = new UndoStack();
    expect(undo.canUndo).toBe(false);
    undo.beginStroke();
    undo.endStroke();
    expect(undo.canUndo).toBe(false);
  });

  it('深さの上限を超えると、古い stroke から捨てられる', () => {
    const field = makeField(8, 0);
    const undo = new UndoStack(3);
    for (let i = 0; i < 5; i++) {
      undo.beginStroke();
      undo.recordBefore(field, 1, 1, 0);
      field.data[1 * 8 + 1] = i;
      undo.endStroke();
    }
    expect(undo.depth).toBe(3);
  });

  it('undo を stroke の数だけ繰り返すと canUndo が false になる', () => {
    const field = makeField(8, 0);
    const undo = new UndoStack();
    undo.beginStroke();
    undo.recordBefore(field, 1, 1, 0);
    field.data[1 * 8 + 1] = 1;
    undo.endStroke();

    expect(undo.canUndo).toBe(true);
    undo.undo();
    expect(undo.canUndo).toBe(false);
    // 積まれていない状態で undo してもクラッシュしない
    expect(() => undo.undo()).not.toThrow();
  });

  it('フィールド境界をはみ出すマージンでもクランプされて安全', () => {
    const field = makeField(4, 0.2);
    const undo = new UndoStack();
    undo.beginStroke();
    undo.recordBefore(field, 0, 0, 5);
    for (let i = 0; i < field.data.length; i++) field.data[i] = 0.9;
    undo.endStroke();
    undo.undo();
    for (let i = 0; i < field.data.length; i++) expect(field.data[i]).toBeCloseTo(0.2);
  });
});
