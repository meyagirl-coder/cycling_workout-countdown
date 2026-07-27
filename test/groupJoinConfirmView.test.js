import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroupJoinConfirmView } from '../src/ui/groupJoinConfirmView.js';

function setup(handlerOverrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const handlers = { onConfirmJoin: vi.fn(), onCancelSchedule: vi.fn(), ...handlerOverrides };
  const view = createGroupJoinConfirmView(root, handlers);
  return { root, handlers, view };
}

describe('createGroupJoinConfirmView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 19, 50, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the scheduled start time in a human-readable "yyyy/MM/dd HH:mm" format', () => {
    const { root, view } = setup();
    view.update(new Date(2026, 6, 24, 20, 0).getTime());

    expect(root.querySelector('.group-join-confirm-start-time').textContent).toContain('2026/07/24 20:00');
  });

  it('shows "尚未開始" when the scheduled start time is still in the future', () => {
    const { root, view } = setup();
    view.update(new Date(2026, 6, 24, 20, 0).getTime()); // 10 minutes from "now"

    expect(root.querySelector('.group-join-confirm-elapsed').textContent).toBe('尚未開始');
  });

  it('shows "已進行 X分Y秒" when the scheduled start time has already passed, so the user knows joining will catch up to the live position rather than starting from 0 (regression check for the confirm-then-catch-up flow)', () => {
    const { root, view } = setup();
    const startTimestamp = new Date(2026, 6, 24, 19, 50, 0).getTime() - (2 * 60 + 10) * 1000; // 2m10s ago
    view.update(startTimestamp);

    expect(root.querySelector('.group-join-confirm-elapsed').textContent).toBe('已進行 2 分 10 秒');
  });

  it('calls onConfirmJoin when the "加入團練" button is clicked', () => {
    const { root, handlers } = setup();
    root.querySelector('.btn-group-join-confirm').click();
    expect(handlers.onConfirmJoin).toHaveBeenCalledTimes(1);
  });

  it('showWaitingPhase() switches the same banner (not a separate element) from the confirm phase to the waiting phase, changing the label and swapping which sub-section is visible (one-page, no jump - see playerApp.js regression notes)', () => {
    const { root, view } = setup();
    view.update(new Date(2026, 6, 24, 20, 0).getTime());
    expect(root.querySelector('.group-join-confirm-label').textContent).toBe('團體訓練邀請');
    expect(root.querySelector('.group-join-confirm-phase').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.group-join-waiting-phase').classList.contains('hidden')).toBe(true);

    view.showWaitingPhase();

    expect(root.querySelector('.group-join-confirm-label').textContent).toBe('團體訓練排程中');
    expect(root.querySelector('.group-join-confirm-phase').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.group-join-waiting-phase').classList.contains('hidden')).toBe(false);
  });

  it('updateWaitingCountdown() shows "距離開始還有..." using the same format as the classic waiting screen', () => {
    const { root, view } = setup();
    view.showWaitingPhase();
    view.updateWaitingCountdown(90 * 1000);

    expect(root.querySelector('.group-join-waiting-countdown').textContent).toBe('距離開始還有 1分30秒');
  });

  it('calls onCancelSchedule when the "取消排程" button (waiting phase) is clicked', () => {
    const { root, handlers } = setup();
    root.querySelector('.btn-group-join-cancel').click();
    expect(handlers.onCancelSchedule).toHaveBeenCalledTimes(1);
  });
});
