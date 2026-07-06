// M22: water フィールドから marching squares で湖岸線を抽出する。DOM 非依存の
// 純粋関数。「水色の丸」の代わりに「岸線のある水域」を描くための下ごしらえ。

export interface Point {
  x: number;
  y: number;
}

interface Segment {
  a: Point;
  b: Point;
}

function lerpEdge(v0: number, v1: number, threshold: number, p0: Point, p1: Point): Point {
  const denom = v1 - v0;
  const t = Math.abs(denom) < 1e-9 ? 0.5 : (threshold - v0) / denom;
  const tc = Math.min(1, Math.max(0, t));
  return { x: p0.x + (p1.x - p0.x) * tc, y: p0.y + (p1.y - p0.y) * tc };
}

/**
 * `field` (fieldSize × fieldSize) 上で `threshold` を跨ぐ境界線分を marching
 * squares で列挙する。座標系はフィールドのセル単位 (0..fieldSize-1)。
 * 鞍点 (対角のみが同じ状態) はコーナー一致による単純な解決 (中心サンプル
 * 無し) を使う — 見た目のための輪郭抽出なので位相の完全な正しさよりも
 * 決定性と単純さを優先する。
 */
function marchingSquaresSegments(field: Float32Array, fieldSize: number, threshold: number): Segment[] {
  const segments: Segment[] = [];
  const at = (x: number, y: number): number => field[y * fieldSize + x] ?? 0;
  const inside = (v: number): boolean => v > threshold;

  for (let y = 0; y < fieldSize - 1; y++) {
    for (let x = 0; x < fieldSize - 1; x++) {
      const vTl = at(x, y);
      const vTr = at(x + 1, y);
      const vBr = at(x + 1, y + 1);
      const vBl = at(x, y + 1);
      const tl = inside(vTl), tr = inside(vTr), br = inside(vBr), bl = inside(vBl);

      const pTl: Point = { x, y };
      const pTr: Point = { x: x + 1, y };
      const pBr: Point = { x: x + 1, y: y + 1 };
      const pBl: Point = { x, y: y + 1 };

      const topCrosses = tl !== tr;
      const rightCrosses = tr !== br;
      const bottomCrosses = bl !== br;
      const leftCrosses = tl !== bl;

      const topPt = () => lerpEdge(vTl, vTr, threshold, pTl, pTr);
      const rightPt = () => lerpEdge(vTr, vBr, threshold, pTr, pBr);
      const bottomPt = () => lerpEdge(vBl, vBr, threshold, pBl, pBr);
      const leftPt = () => lerpEdge(vTl, vBl, threshold, pTl, pBl);

      const crossCount = Number(topCrosses) + Number(rightCrosses) + Number(bottomCrosses) + Number(leftCrosses);
      if (crossCount === 0) continue;

      if (crossCount === 2) {
        const pts: Point[] = [];
        if (topCrosses) pts.push(topPt());
        if (rightCrosses) pts.push(rightPt());
        if (bottomCrosses) pts.push(bottomPt());
        if (leftCrosses) pts.push(leftPt());
        segments.push({ a: pts[0]!, b: pts[1]! });
        continue;
      }

      // crossCount === 4 (鞍点): 対角の状態が一致する側でペアリングする。
      if (tl === br) {
        segments.push({ a: topPt(), b: leftPt() });
        segments.push({ a: bottomPt(), b: rightPt() });
      } else {
        segments.push({ a: topPt(), b: rightPt() });
        segments.push({ a: bottomPt(), b: leftPt() });
      }
    }
  }
  return segments;
}

function pointKey(p: Point): string {
  return `${p.x}:${p.y}`;
}

/** 線分の集合を端点共有でつなぎ、輪 (または開いた鎖) の点列に組み立てる。 */
function stitchLoops(segments: Segment[]): Point[][] {
  const adjacency = new Map<string, { segIdx: number; other: 'a' | 'b' }[]>();
  const addAdj = (key: string, segIdx: number, other: 'a' | 'b') => {
    const list = adjacency.get(key);
    if (list) list.push({ segIdx, other });
    else adjacency.set(key, [{ segIdx, other }]);
  };
  segments.forEach((s, i) => {
    addAdj(pointKey(s.a), i, 'b');
    addAdj(pointKey(s.b), i, 'a');
  });

  const used = new Uint8Array(segments.length);
  const loops: Point[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const seg = segments[i]!;
    const loop: Point[] = [seg.a, seg.b];

    let guard = segments.length + 1;
    while (guard-- > 0) {
      const tailKey = pointKey(loop[loop.length - 1]!);
      const candidates = adjacency.get(tailKey) ?? [];
      const next = candidates.find((c) => !used[c.segIdx]);
      if (!next) break;
      used[next.segIdx] = 1;
      const nextSeg = segments[next.segIdx]!;
      const nextPoint = next.other === 'a' ? nextSeg.a : nextSeg.b;
      // 輪が閉じた (開始点に戻った) 場合はここで終了する。
      if (pointKey(nextPoint) === pointKey(loop[0]!)) break;
      loop.push(nextPoint);
    }
    loops.push(loop);
  }
  return loops;
}

export interface Coastline {
  /** ワールド座標系の閉ループ (または開いた鎖) の点列。 */
  loops: Point[][];
}

/**
 * water フィールドから湖岸線を抽出し、ワールド座標系へスケールする。
 * `minCells` 未満の面積 (概算) しかない微小な水たまりは、
 * ノイズ的な小さすぎる輪郭として除外する。
 */
export function extractCoastline(
  field: Float32Array,
  fieldSize: number,
  worldSize: number,
  threshold = 0.5,
  minLoopPoints = 3,
): Coastline {
  const segments = marchingSquaresSegments(field, fieldSize, threshold);
  const loops = stitchLoops(segments).filter((l) => l.length >= minLoopPoints);
  const cellWorld = worldSize / fieldSize;
  return {
    loops: loops.map((loop) => loop.map((p) => ({ x: p.x * cellWorld, y: p.y * cellWorld }))),
  };
}
