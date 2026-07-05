import { describe, it, expect, vi } from 'vitest';
import {
  AssetManager,
  TILE_TEXTURES,
  SPRITE_FAMILIES,
  SPRITE_SINGLES,
  textureFileName,
  spriteFamilyFileName,
  spriteSingleFileName,
} from '../src/assets.js';

function fakeImage(): HTMLImageElement {
  return {} as HTMLImageElement;
}

describe('ファイル名生成', () => {
  it('タイル/スプライトのファイル名を組み立てる', () => {
    expect(textureFileName('moss-ground')).toBe('moss-ground.png');
    expect(spriteFamilyFileName('rock-cluster', 2)).toBe('rock-cluster-2.png');
    expect(spriteSingleFileName('driftwood')).toBe('driftwood.png');
  });
});

describe('AssetManager', () => {
  it('未ロードの間は null を返し、ロード完了後は Image を返す', async () => {
    const loader = vi.fn(async (path: string) => {
      expect(path).toBe('textures/moss-ground.png');
      return fakeImage();
    });
    const mgr = new AssetManager('textures/', loader);

    expect(mgr.getTexture('moss-ground')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mgr.getTexture('moss-ground')).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('同じキーへの重複リクエストは1回しかロードしない', async () => {
    const loader = vi.fn(async () => fakeImage());
    const mgr = new AssetManager('textures/', loader);

    mgr.getTexture('rock-face');
    mgr.getTexture('rock-face');
    mgr.getTexture('rock-face');
    await new Promise((r) => setTimeout(r, 0));
    mgr.getTexture('rock-face');

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('ロード失敗時は failed のまま null を返し続け、例外を投げない', async () => {
    const loader = vi.fn(async () => {
      throw new Error('404');
    });
    const mgr = new AssetManager('textures/', loader);

    expect(mgr.getTexture('cave-floor')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mgr.getTexture('cave-floor')).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('getSprite はバリエーションごとに別キーでロードする', async () => {
    const loader = vi.fn(async () => fakeImage());
    const mgr = new AssetManager('textures/', loader);

    mgr.getSprite('rock-cluster', 1);
    mgr.getSprite('rock-cluster', 2);
    await new Promise((r) => setTimeout(r, 0));

    expect(loader).toHaveBeenCalledWith('textures/rock-cluster-1.png');
    expect(loader).toHaveBeenCalledWith('textures/rock-cluster-2.png');
    expect(mgr.getSprite('rock-cluster', 1)).not.toBeNull();
    expect(mgr.getSprite('rock-cluster', 2)).not.toBeNull();
  });

  it('preloadAll は発注ブリーフの全アセットをロードし終える', async () => {
    const loader = vi.fn(async () => fakeImage());
    const mgr = new AssetManager('textures/', loader);

    await mgr.preloadAll();

    const expectedCount =
      TILE_TEXTURES.length +
      Object.values(SPRITE_FAMILIES).reduce((a, b) => a + b, 0) +
      SPRITE_SINGLES.length;
    expect(loader).toHaveBeenCalledTimes(expectedCount);
    for (const name of TILE_TEXTURES) {
      expect(mgr.getTexture(name)).not.toBeNull();
    }
  });

  it('clear() 後は再ロードされる', async () => {
    const loader = vi.fn(async () => fakeImage());
    const mgr = new AssetManager('textures/', loader);

    mgr.getTexture('sand-dry');
    await new Promise((r) => setTimeout(r, 0));
    mgr.clear();
    expect(mgr.getTexture('sand-dry')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mgr.getTexture('sand-dry')).not.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
