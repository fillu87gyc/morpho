import { describe, it, expect } from 'vitest';
import { TickScheduler } from '../src/tick-scheduler.js';

describe('TickScheduler', () => {
  it('予算に十分な余裕があれば、要求した速度分だけそのまま返す', () => {
    const s = new TickScheduler({ budgetMs: 16, maxDebtTicks: 96 });
    // 初期推定 0.5ms/tick なので 16ms 予算なら 32 tick 分は収まる。
    expect(s.planSteps(24)).toBe(24);
    s.report(24, 12); // 24 tick で 12ms → 0.5ms/tick 通り
    expect(s.pendingDebt).toBe(0);
  });

  it('tick コストが予算を超えると、収まる分だけ返し残りは借金として繰り越す', () => {
    const s = new TickScheduler({ budgetMs: 16, maxDebtTicks: 96 });
    expect(s.planSteps(24)).toBe(24);
    // 実測が遅い (2ms/tick) と分かった → 見積もりが上がる
    s.report(24, 48);
    expect(s.estimatedTickMs).toBeGreaterThan(0.5);

    // 次フレーム: 24 が新たに積まれるが、前回分は既に消化済みなので debt=24。
    // 見積もりが 2ms/tick 近くまで上がっていれば、16ms には 8 tick 程度しか収まらない。
    const steps = s.planSteps(24);
    expect(steps).toBeLessThan(24);
    expect(steps).toBeGreaterThan(0);
  });

  it('借金は上限 (maxDebtTicks) を超えて積み上がらない', () => {
    const s = new TickScheduler({ budgetMs: 1, maxDebtTicks: 50 });
    // 毎回 speed=24 を要求し続けても、返す量が少ないままなら debt は 50 で頭打ち。
    for (let i = 0; i < 20; i++) {
      const steps = s.planSteps(24);
      s.report(steps, steps * 10); // 常に重い (10ms/tick) と仮定
    }
    expect(s.pendingDebt).toBeLessThanOrEqual(50);
  });

  it('速度0 (一時停止) を渡しても新規の借金は増えない', () => {
    const s = new TickScheduler({ budgetMs: 16, maxDebtTicks: 96 });
    expect(s.planSteps(0)).toBe(0);
    expect(s.pendingDebt).toBe(0);
  });

  it('一時的に間に合わなくても、後続フレームで借金を解消できる', () => {
    const s = new TickScheduler({ budgetMs: 16, maxDebtTicks: 96 });
    s.planSteps(24);
    s.report(24, 48); // 2ms/tick と判明 → 見積もりが上がる

    // 見積もりが上がった直後は 24 tick 分がコマ切れになり、借金が残る。
    const steps2 = s.planSteps(24);
    expect(steps2).toBeLessThan(24);
    s.report(steps2, steps2 * 2);
    expect(s.pendingDebt).toBeGreaterThan(0);

    // 以後は新規に積まず (targetSpeed=0) 、実際には速いと分かれば
    // 見積もりも下がっていき、借金は数フレームで解消される。
    let totalRan = 0;
    for (let i = 0; i < 50 && s.pendingDebt > 0; i++) {
      const steps = s.planSteps(0);
      s.report(steps, steps * 0.5);
      totalRan += steps;
    }
    expect(s.pendingDebt).toBe(0);
    expect(totalRan).toBeGreaterThan(0);
  });

  it('M8 P4: setBudgetMs/setMaxDebtTicks で早送りモード相当の再設定ができる', () => {
    const s = new TickScheduler({ budgetMs: 16, maxDebtTicks: 96 });
    // 通常モードでは 16ms 予算の枠に収まる分しか返らない (見積もりが重いと仮定)。
    s.report(24, 48); // 2ms/tick と判明
    const before = s.planSteps(24);
    expect(before).toBeLessThan(24);

    // 早送り (100ms/10fps) 相当に切り替え: 予算と借金上限を比率分だけ引き上げる。
    const ratio = 100 / 16;
    s.setBudgetMs(100);
    s.setMaxDebtTicks(Math.round(96 * ratio));
    const demand = 24 * ratio; // ループ間隔が伸びた分、要求量も比例して増やす
    const after = s.planSteps(demand);
    // 100ms 予算なら 2ms/tick でも 50 tick 程度は収まり、16ms 予算のときより多く進む。
    expect(after).toBeGreaterThan(before);
  });

  it('M9: reset() で借金を即座に0へ戻せる (日境界での持ち越し防止)', () => {
    const s = new TickScheduler({ budgetMs: 1, maxDebtTicks: 50 });
    s.planSteps(24);
    s.report(1, 10); // 予算が狭いので大半が debt として残る
    expect(s.pendingDebt).toBeGreaterThan(0);

    s.reset();
    expect(s.pendingDebt).toBe(0);
  });
});
