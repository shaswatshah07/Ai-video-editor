import { TimelineItem } from '../types/edl';

/**
 * Deterministically computes projectStartMs and projectEndMs for all items.
 * Non-active items (DELETED, SUGGESTED_SILENCE_CUT) do not advance the project timeline
 * unless previewed. Active items sequence contiguously, with transition overlap adjustments.
 */
export function recalculateTimeline(items: TimelineItem[]): TimelineItem[] {
  let currentProjMs = 0;

  return items.map((item) => {
    // Non-deleted items (ACTIVE, SUGGESTED_MEME, SUGGESTED_SILENCE_CUT) contribute to the played project time
    // Only DELETED items have zero project duration
    const isPlayed = item.status !== 'DELETED';

    if (!isPlayed) {
      return {
        ...item,
        projectStartMs: currentProjMs,
        projectEndMs: currentProjMs // Zero project duration when deleted
      };
    }

    const startMs = currentProjMs;
    // Base item duration in integer milliseconds
    const durMs = Math.max(0, Math.round(item.sourceEndMs - item.sourceStartMs));
    const endMs = startMs + durMs;

    // Transitions are pure visual overlays at the boundary, NEVER subtract overlapMs
    currentProjMs = endMs;

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
  const activeItems = items.filter(it => it.status !== 'DELETED');
  if (activeItems.length === 0) return 0;
  return Math.max(...activeItems.map(it => it.projectEndMs));
}

/**
 * Determines whether a timeline item is an actual meme reaction clip,
 * explicitly excluding primary video, split primary segments, and added video clips.
 */
export function isActualMemeClip(item: TimelineItem, sourceVideoUrl?: string): boolean {
  if (item.status === 'DELETED') return false;
  if (item.kind !== 'MEME_CLIP') return false;
  if (sourceVideoUrl && item.blobUrl === sourceVideoUrl) return false;
  if (item.meta?.isAddedClip) return false;
  if (item.id.startsWith('clip_') && !item.meta?.memeCategory?.startsWith('meme_')) return false;
  return true;
}

/**
 * Given a project time (T_proj), locate which TimelineItem is playing,
 * along with its exact source timestamp (T_src).
 */
export function mapProjectToSource(
  projectMs: number,
  items: TimelineItem[]
): { item: TimelineItem | null; sourceMs: number; itemOffsetMs: number } {
  const activeItems = items.filter(it => it.status !== 'DELETED');
  
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
  const start = Math.max(0, cutStartProjMs);
  const end = cutEndProjMs;
  if (start >= end || (end - start) < 50) return items;

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
    if (end <= itemStart || start >= itemEnd) {
      result.push(item);
      continue;
    }

    // Case 2: Cut range completely covers this item
    if (start <= itemStart && end >= itemEnd) {
      result.push({
        ...item,
        status: 'DELETED'
      });
      continue;
    }

    // Case 3: Cut range starts inside this item and ends after this item
    if (start > itemStart && end >= itemEnd) {
      const splitOffsetMs = start - itemStart;
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
    if (start <= itemStart && end < itemEnd) {
      const splitOffsetMs = end - itemStart;
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
    if (start > itemStart && end < itemEnd) {
      const leftOffset = start - itemStart;
      const rightOffset = end - itemStart;

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
