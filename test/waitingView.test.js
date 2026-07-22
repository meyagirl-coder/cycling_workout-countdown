import { describe, expect, it, vi } from 'vitest';
import { createWaitingView } from '../src/ui/waitingView.js';

function makeWorkout(overrides = {}) {
  return {
    id: 'waiting-view-test-workout',
    name: 'Group Ride',
    source: 'paste-percent',
    totalDuration: 1800,
    intervals: [
      { type: 'steady', duration: 900, powerStart: 60, powerEnd: 60, cadence: null },
      { type: 'steady', duration: 900, powerStart: 80, powerEnd: 80, cadence: null },
    ],
    ...overrides,
  };
}

function setup(handlerOverrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const handlers = { onCancelSchedule: vi.fn(), ...handlerOverrides };
  const view = createWaitingView(root, handlers);
  return { root, handlers, view };
}

describe('createWaitingView', () => {
  it('shows the workout name, total duration, and interval count', () => {
    const { root, view } = setup();
    view.update(makeWorkout(), 5 * 60 * 1000);

    expect(root.querySelector('.waiting-workout-name').textContent).toBe('Group Ride');
    expect(root.querySelector('.waiting-workout-meta').textContent).toContain('30:00');
    expect(root.querySelector('.waiting-workout-meta').textContent).toContain('2 組');
  });

  it('shows the "距離開始還有 X 小時 Y 分" countdown text', () => {
    const { root, view } = setup();
    const remainingMs = (2 * 60 + 30) * 60 * 1000;
    view.update(makeWorkout(), remainingMs);

    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 2 小時 30 分');
  });

  it('updates the countdown text on a subsequent update() call (live updating)', () => {
    const { root, view } = setup();
    const workout = makeWorkout();

    view.update(workout, 10 * 60 * 1000);
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 10 分');

    view.update(workout, 9 * 60 * 1000);
    expect(root.querySelector('.waiting-countdown').textContent).toBe('距離開始還有 9 分');
  });

  it('shows a warning telling the user not to fully close the tab', () => {
    const { root } = setup();
    const warningText = root.querySelector('.waiting-warning').textContent;
    expect(warningText).toContain('關閉');
    expect(warningText).toMatch(/自動開始|自動觸發/);
  });

  it('calls onCancelSchedule when the cancel button is clicked', () => {
    const { root, handlers } = setup();
    root.querySelector('.btn-cancel-schedule').click();
    expect(handlers.onCancelSchedule).toHaveBeenCalledTimes(1);
  });
});
