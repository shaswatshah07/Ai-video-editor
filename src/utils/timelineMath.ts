import { TimelineItem } from '../types/edl';

/**
 * Deterministically computes projectStartMs and projectEndMs for all items.
 * Non-active items (DELETED, SUGGESTED_SILENCE_CUT) do not advance the project timeline
 * unless previewed. Active items sequence contiguously, with transition overlap adjustments.
 */
export function recalculateTimeline(items: TimelineItem[]): TimelineItem[] {
  let currentProjMs = 0;

  return items.map((item, index) => {
    // Only ACTIVE items and inserted MEME clips contribute to the played project time
    const isPlayed = item.status === 'ACTIVE' || item.status === 'SUGGESTED_MEME';

    if (!isPlayed) {
      return {
        ...item,
        projectStartMs: currentProjMs,
        projectEndMs: currentProjMs // Zero project duration when skipped/deleted
      };
    }

    const startMs = currentProjMs;
    // Base item duration in integer milliseconds
    const durMs = Math.max(0, Math.round(item.sourceEndMs - item.sourceStartMs));
    let endMs = startMs + durMs;

    // Check if next item has an overlap transition from this item
    let overlapMs = 0;
    if (item.transitionOut && item.transitionOut.type !== 'none' && index < items.length - 1) {
      // Overlap duration cannot exceed half the clip duration or the next clip duration
      overlapMs = Math.min(item.transitionOut.durationMs, Math.floor(durMs / 2));
    }

    currentProjMs = endMs - overlapMs;

    return {
      ...item,
      durationMs: durMs,
      projectStartMs: startMs,
      projectEndMs: endMs
    };
  });
}

/**
 * Total active project duration in milliseconds
 */
export function getTotalProjectDuration(items: TimelineItem[]): number {
  const activeItems = items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
  if (activeItems.length === 0) return 0;
  return Math.max(...activeItems.map(it => it.projectEndMs));
}

/**
 * Given a project time (T_proj), locate which TimelineItem is playing,
 * along with its exact source timestamp (T_src).
 */
export function mapProjectToSource(
  projectMs: number,
  items: TimelineItem[]
): { item: TimelineItem | null; sourceMs: number; itemOffsetMs: number } {
  const activeItems = items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
  
  if (activeItems.length === 0) {
    return { item: null, sourceMs: 0, itemOffsetMs: 0 };
  }

  // Handle bounds
  if (projectMs <= 0) {
    const first = activeItems[0];
    return { item: first, sourceMs: first.sourceStartMs, itemOffsetMs: 0 };
  }

  for (const item of activeItems) {
    if (projectMs >= item.projectStartMs && projectMs < item.projectEndMs) {
      const offset = projectMs - item.projectStartMs;
      const sourceMs = Math.min(item.sourceEndMs, item.sourceStartMs + offset);
      return { item, sourceMs, itemOffsetMs: offset };
    }
  }

  // If at or past the end
  const last = activeItems[activeItems.length - 1];
  return { item: last, sourceMs: last.sourceEndMs, itemOffsetMs: last.durationMs };
}

/**
 * Given a source timestamp (T_src) from original transcript/chapters,
 * finds corresponding project time (T_proj). Returns null if that source slice is deleted.
 */
export function mapSourceToProjectMs(
  sourceMs: number,
  items: TimelineItem[]
): number | null {
  for (const item of items) {
    if (sourceMs >= item.sourceStartMs && sourceMs <= item.sourceEndMs) {
      if (item.status === 'DELETED') {
        return null;
      }
      const offset = sourceMs - item.sourceStartMs;
      return item.projectStartMs + offset;
    }
  }
  return null;
}

/**
 * Splits overlapping 'ACTIVE' segments at cutStartProjMs and cutEndProjMs,
 * marking the inner slice 'DELETED'.
 */
export function splitAndTrimProjectRange(
  items: TimelineItem[],
  cutStartProjMs: number,
  cutEndProjMs: number
): TimelineItem[] {
  if (cutStartProjMs >= cutEndProjMs) return items;

  const result: TimelineItem[] = [];

  for (const item of items) {
    // If item is already deleted or not active, preserve it
    if (item.status !== 'ACTIVE') {
      result.push(item);
      continue;
    }

    const itemStart = item.projectStartMs;
    const itemEnd = item.projectEndMs;

    // Case 1: Cut range is completely outside this item
    if (cutEndProjMs <= itemStart || cutStartProjMs >= itemEnd) {
      result.push(item);
      continue;
    }

    // Case 2: Cut range completely covers this item
    if (cutStartProjMs <= itemStart && cutEndProjMs >= itemEnd) {
      result.push({
        ...item,
        status: 'DELETED'
      });
      continue;
    }

    // Case 3: Cut range starts inside this item and ends after this item
    if (cutStartProjMs > itemStart && cutEndProjMs >= itemEnd) {
      const splitOffsetMs = cutStartProjMs - itemStart;
      const splitSourceMs = item.sourceStartMs + splitOffsetMs;

      // Left kept part
      result.push({
        ...item,
        id: `${item.id}_left_${Date.now()}`,
        sourceEndMs: splitSourceMs,
        durationMs: splitOffsetMs,
        status: 'ACTIVE'
      });

      // Right cut part
      result.push({
        ...item,
        id: `${item.id}_cut_${Date.now()}`,
        sourceStartMs: splitSourceMs,
        durationMs: item.sourceEndMs - splitSourceMs,
        status: 'DELETED'
      });
      continue;
    }

    // Case 4: Cut range starts before this item and ends inside this item
    if (cutStartProjMs <= itemStart && cutEndProjMs < itemEnd) {
      const splitOffsetMs = cutEndProjMs - itemStart;
      const splitSourceMs = item.sourceStartMs + splitOffsetMs;

      // Left cut part
      result.push({
        ...item,
        id: `${item.id}_cut_${Date.now()}`,
        sourceEndMs: splitSourceMs,
        durationMs: splitOffsetMs,
        status: 'DELETED'
      });

      // Right kept part
      result.push({
        ...item,
        id: `${item.id}_right_${Date.now()}`,
        sourceStartMs: splitSourceMs,
        durationMs: item.sourceEndMs - splitSourceMs,
        status: 'ACTIVE'
      });
      continue;
    }

    // Case 5: Cut range is strictly inside this single item (splits into 3 pieces: left, cut, right)
    if (cutStartProjMs > itemStart && cutEndProjMs < itemEnd) {
      const leftOffset = cutStartProjMs - itemStart;
      const rightOffset = cutEndProjMs - itemStart;

      const leftSourceEnd = item.sourceStartMs + leftOffset;
      const rightSourceStart = item.sourceStartMs + rightOffset;

      // Left kept piece
      result.push({
        ...item,
        id: `${item.id}_left_${Date.now()}`,
        sourceEndMs: leftSourceEnd,
        durationMs: leftOffset,
        status: 'ACTIVE'
      });

      // Middle deleted piece
      result.push({
        ...item,
        id: `${item.id}_midcut_${Date.now()}`,
        sourceStartMs: leftSourceEnd,
        sourceEndMs: rightSourceStart,
        durationMs: rightOffset - leftOffset,
        status: 'DELETED'
      });

      // Right kept piece
      result.push({
        ...item,
        id: `${item.id}_right_${Date.now()}`,
        sourceStartMs: rightSourceStart,
        durationMs: item.sourceEndMs - rightSourceStart,
        status: 'ACTIVE'
      });
    }
  }

  return recalculateTimeline(result);
}

/**
 * Splits an active item at a specific project playhead timestamp
 */
export function splitItemAtPlayhead(
  items: TimelineItem[],
  playheadProjMs: number
): TimelineItem[] {
  const result: TimelineItem[] = [];

  for (const item of items) {
    if (item.status === 'ACTIVE' && playheadProjMs > item.projectStartMs && playheadProjMs < item.projectEndMs) {
      const offset = playheadProjMs - item.projectStartMs;
      const splitSourceMs = item.sourceStartMs + offset;

      result.push({
        ...item,
        id: `${item.id}_part1_${Date.now()}`,
        sourceEndMs: splitSourceMs,
        durationMs: offset,
        status: 'ACTIVE'
      });

      result.push({
        ...item,
        id: `${item.id}_part2_${Date.now()}`,
        sourceStartMs: splitSourceMs,
        durationMs: item.sourceEndMs - splitSourceMs,
        status: 'ACTIVE'
      });
    } else {
      result.push(item);
    }
  }

  return recalculateTimeline(result);
}
