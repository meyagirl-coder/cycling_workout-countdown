import { describe, expect, it, vi } from 'vitest';
import { createGroupJoinConfirmView } from '../src/ui/groupJoinConfirmView.js';

function makeWorkout(overrides = {}) {
  return {
    id: 'group-join-confirm-view-test-workout',
    name: 'Group Ride',
    source: 'paste-trainerday-structure',
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
  const handlers = { onConfirmJoin: vi.fn(), ...handlerOverrides };
  const view = createGroupJoinConfirmView(root, handlers);
  return { root, handlers, view };
}

describe('createGroupJoinConfirmView', () => {
  it('shows the workout name, total duration, and interval count', () => {
    const { root, view } = setup();
    view.update(makeWorkout(), Date.now() + 60000);

    expect(root.querySelector('.group-join-confirm-workout-name').textContent).toBe('Group Ride');
    expect(root.querySelector('.group-join-confirm-workout-meta').textContent).toContain('30:00');
    expect(root.querySelector('.group-join-confirm-workout-meta').textContent).toContain('2 組');
  });

  it('shows the scheduled start time in a human-readable "yyyy/MM/dd HH:mm" format', () => {
    const { root, view } = setup();
    view.update(makeWorkout(), new Date(2026, 6, 24, 20, 0).getTime());

    expect(root.querySelector('.group-join-confirm-start-time').textContent).toContain('2026/07/24 20:00');
  });

  it('calls onConfirmJoin when the "加入團練" button is clicked', () => {
    const { root, handlers } = setup();
    root.querySelector('.btn-group-join-confirm').click();
    expect(handlers.onConfirmJoin).toHaveBeenCalledTimes(1);
  });
});
