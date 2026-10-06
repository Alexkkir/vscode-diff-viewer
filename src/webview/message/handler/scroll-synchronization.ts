type ScrollAxis = "scrollLeft" | "scrollTop";

// Native scroll events arrive after a write returns, and several listeners may
// see the same event. Keep each element's actual clamped position until the
// user changes it, rather than consuming a one-shot synchronous guard.
const expectedPositions = new WeakMap<HTMLElement, Partial<Record<ScrollAxis, number>>>();
const observedPositions = new WeakMap<HTMLElement, Record<ScrollAxis, number>>();
const eventAxes = new WeakMap<Event, ScrollAxis[]>();

export function setProgrammaticScroll(element: HTMLElement, axis: ScrollAxis, position: number): void {
  element[axis] = position;
  const expected = expectedPositions.get(element) ?? {};
  expected[axis] = element[axis];
  expectedPositions.set(element, expected);
}

function isProgrammaticScroll(element: HTMLElement, axis: ScrollAxis): boolean {
  const expected = expectedPositions.get(element);
  if (expected?.[axis] === undefined) return false;
  if (expected[axis] === element[axis]) return true;
  delete expected[axis];
  return false;
}

/** Both pane and global listeners must see the same changed axes for an event. */
export function userScrollAxes(event: Event, element: HTMLElement): ScrollAxis[] {
  const cached = eventAxes.get(event);
  if (cached) return cached;
  const previous = observedPositions.get(element) ?? { scrollLeft: 0, scrollTop: 0 };
  const axes = (["scrollLeft", "scrollTop"] as const).filter(
    (axis) => element[axis] !== previous[axis] && !isProgrammaticScroll(element, axis),
  );
  observedPositions.set(element, { scrollLeft: element.scrollLeft, scrollTop: element.scrollTop });
  eventAxes.set(event, axes);
  return axes;
}
