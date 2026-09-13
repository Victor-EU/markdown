<script lang="ts">
import type { Workspace } from '../lib/workspace.svelte.ts';
import Icon from './Icon.svelte';

let { workspace }: { workspace: Workspace } = $props();

let bar: HTMLElement | undefined = $state();
let strip: HTMLElement | undefined = $state();

/** The tab in front, brought into view when the strip overflows (design 4.1). */
function reveal() {
  const id = workspace.activeId;
  if (!strip || id === null) return;
  strip
    .querySelector(`[data-tab="${id}"]`)
    ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// Coming to the front is one way a tab ends up out of sight.
$effect(reveal);

/*
 * The other is the strip getting narrower under it: tabs shrink to a
 * floor and the strip scrolls from there, so a window dragged in from
 * the right can push the tab the reader is in off the end of it.
 */
$effect(() => {
  if (!strip) return;
  const observer = new ResizeObserver(() => reveal());
  observer.observe(strip);
  return () => observer.disconnect();
});

/*
 * Dragging a tab — along the strip to reorder it, off the strip to tear
 * it into a window of its own (design 4.1) — is done with pointer
 * events and not the browser's drag and drop (ADR 0040). Under Tauri the
 * webview's drag session is claimed for file drops before WebKit sees
 * it, so a `drop` never reaches the page; a held button is plain mouse
 * tracking and reaches it fine, from outside the window too.
 */

/** How far a press travels before it is a drag and not a click. */
const SLIP = 4;
/** How far off the title bar the pointer goes before a release tears. */
const SLACK = 24;
/** How long the tab takes to settle into its slot once let go of. */
const SETTLE_MS = 120;

type Slot = { left: number; width: number };

/** A press on a tab, which is a click until it moves. */
type Press = { id: string; pointer: number; x: number; y: number };

type Drag = {
  id: string;
  pointer: number;
  /** Where the tab was picked up, and where it would land now. */
  from: number;
  to: number;
  /** The block it may move within: the pinned tabs, or the rest. */
  low: number;
  high: number;
  /** Every tab's box at pickup, in client coordinates. */
  slots: Slot[];
  /** The pointer's x at pickup, and now. */
  originX: number;
  x: number;
  /** Off the title bar, where letting go tears the tab off. */
  outside: boolean;
  /** Let go of on the strip and sliding into its slot. */
  settling: boolean;
};

let press: Press | null = null;
let drag = $state<Drag | null>(null);

function pointerdown(event: PointerEvent, id: string) {
  if (event.button !== 0 || drag !== null) return;
  // The close button is a button, not a handle.
  if ((event.target as Element | null)?.closest('.close')) return;
  press = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY };
}

function pickUp(from: Press) {
  if (!strip) return;
  const index = workspace.tabs.findIndex((tab) => tab.id === from.id);
  const tab = workspace.tabs[index];
  if (!tab) return;
  const slots = [...strip.querySelectorAll<HTMLElement>('.tab')].map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, width: box.width };
  });
  if (slots.length !== workspace.tabs.length) return;
  // Pinned tabs keep their block at the front, as `workspace.move` does.
  const pinned = workspace.tabs.filter((open) => open.pinned).length;
  const [low, high] = tab.pinned ? [0, pinned - 1] : [pinned, workspace.tabs.length - 1];
  // Picking a tab up brings it to the front, which is what a press on
  // it would have done had it stayed a press.
  workspace.activate(from.id);
  drag = {
    id: from.id,
    pointer: from.pointer,
    from: index,
    to: index,
    low,
    high,
    slots,
    originX: from.x,
    x: from.x,
    outside: false,
    settling: false,
  };
}

/** How far the dragged tab is drawn from its slot, held within its block. */
function shift(drag: Drag): number {
  const slot = drag.slots[drag.from];
  const first = drag.slots[drag.low];
  const last = drag.slots[drag.high];
  if (!slot || !first || !last) return 0;
  if (drag.settling) {
    const target = drag.slots[drag.to];
    if (!target) return 0;
    return drag.to > drag.from
      ? target.left + target.width - slot.width - slot.left
      : target.left - slot.left;
  }
  const raw = drag.x - drag.originX;
  const least = first.left - slot.left;
  const most = last.left + last.width - (slot.left + slot.width);
  return Math.min(Math.max(raw, least), most);
}

/**
 * The slot the dragged tab has reached. It takes a neighbour's place
 * once its leading edge is past the neighbour's middle — covering more
 * than half of it — which holds for tabs of any width, and at the edge
 * of the block, where the tab in hand is held flush with the last slot.
 */
function landing(drag: Drag): number {
  const slot = drag.slots[drag.from];
  if (!slot) return drag.from;
  const left = slot.left + shift(drag);
  const right = left + slot.width;
  let to = drag.from;
  for (let index = drag.from + 1; index <= drag.high; index += 1) {
    const other = drag.slots[index];
    if (other && right >= other.left + other.width / 2) to = index;
  }
  for (let index = drag.from - 1; index >= drag.low; index -= 1) {
    const other = drag.slots[index];
    if (other && left <= other.left + other.width / 2) to = index;
  }
  return to;
}

function pointermove(event: PointerEvent) {
  if (drag !== null) {
    if (event.pointerId !== drag.pointer || drag.settling) return;
    drag.x = event.clientX;
    const box = bar?.getBoundingClientRect();
    drag.outside =
      box !== undefined &&
      (event.clientY < box.top - SLACK ||
        event.clientY > box.bottom + SLACK ||
        event.clientX < 0 ||
        event.clientX > window.innerWidth);
    drag.to = drag.outside ? drag.from : landing(drag);
    return;
  }
  if (press === null || event.pointerId !== press.pointer) return;
  if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < SLIP) return;
  pickUp(press);
  if (drag !== null) pointermove(event);
}

function pointerup(event: PointerEvent) {
  if (drag === null) {
    if (press?.pointer === event.pointerId) press = null;
    return;
  }
  if (event.pointerId !== drag.pointer || drag.settling) return;
  press = null;
  const { id, from, to, outside } = drag;
  if (outside) {
    // Where it was let go of is the whole of the decision and Rust
    // makes it, from the pointer's own position: only Rust knows where
    // the windows are. The window under it takes the tab in, and
    // nothing under it tears the tab into a window of its own.
    drag = null;
    void workspace.moveTab(id, true);
    return;
  }
  if (shift(drag) === 0 && to === from) {
    drag = null;
    return;
  }
  // Slide the last of the way into the slot, then let the strip be
  // laid out in the new order, which puts every tab where it is drawn.
  drag.to = to;
  drag.settling = true;
  window.setTimeout(() => {
    drag = null;
    press = null;
    if (to !== from) workspace.move(from, to);
  }, SETTLE_MS);
}

/** Escape, or the pointer taken away: everything slides back. */
function cancel() {
  press = null;
  if (drag === null || drag.settling) return;
  drag.to = drag.from;
  drag.outside = false;
  drag.settling = true;
  window.setTimeout(() => {
    drag = null;
  }, SETTLE_MS);
}

/** Where each tab is drawn while one of them is being dragged. */
function placement(index: number): string | null {
  if (drag === null) return null;
  if (index === drag.from) return `translateX(${shift(drag)}px)`;
  const slot = drag.slots[drag.from];
  if (!slot || drag.outside) return null;
  if (drag.from < index && index <= drag.to) return `translateX(${-slot.width}px)`;
  if (drag.to <= index && index < drag.from) return `translateX(${slot.width}px)`;
  return null;
}

function auxclick(event: MouseEvent, id: string) {
  if (event.button === 1) {
    event.preventDefault();
    workspace.close(id);
  }
}
</script>

<!--
  A drag is followed on the window rather than the tab: a held button
  keeps reporting to the page from outside the tab, the strip and the
  window itself, which is where a torn-off tab is let go of.
-->
<svelte:window
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={cancel}
  onkeydown={(event) => {
    if (event.key === 'Escape' && (drag !== null || press !== null)) cancel();
  }}
/>

<!--
  The strip is the window's title bar (plan WP 2.8). Everything in it
  that is not a tab is a place to pick the window up by: the corner kept
  clear for the system's own three buttons, the gap after the last tab,
  and the strip's own background between them. `data-tauri-drag-region`
  is what Tauri reads for that, and it moves the window on a press and
  zooms it on a double-click, so neither is ours to implement.

  Bare rather than `deep`, deliberately: only a press that lands on the
  marked element itself drags, so a press on a tab, its close button or
  the new-tab button is that button's and not the window's.
-->
<div class="titlebar" class:lights={workspace.lights} data-tauri-drag-region bind:this={bar}>
  <div
    class="tabs"
    class:dragging={drag !== null}
    role="tablist"
    aria-label="Open documents"
    bind:this={strip}
  >
    {#each workspace.tabs as tab, index (tab.id)}
      {@const doc = workspace.docOf(tab)}
      <div
        class="tab"
        class:active={tab.id === workspace.activeId}
        class:pinned={tab.pinned}
        class:dragged={drag?.id === tab.id}
        class:lifted={drag?.id === tab.id && drag.outside}
        class:settling={drag?.id === tab.id && drag.settling}
        role="presentation"
        data-tab={tab.id}
        style:transform={placement(index)}
        onpointerdown={(event) => pointerdown(event, tab.id)}
        onauxclick={(event) => auxclick(event, tab.id)}
      >
        <button
          type="button"
          class="label"
          role="tab"
          aria-selected={tab.id === workspace.activeId}
          title={doc?.path ?? doc?.untitledName ?? 'Settings'}
          onclick={() => workspace.activate(tab.id)}
          ondblclick={() => workspace.togglePin(tab.id)}
        >
          {#if tab.pinned}<span class="pin" aria-hidden="true"><Icon name="pin" size={12} /></span>{/if}
          {workspace.labels[index]}
          <!-- Only a document can be unsaved, so only a document has a dot. -->
          {#if doc}<span class="dot" class:dirty={doc.dirty} aria-hidden="true">•</span>{/if}
        </button>
        <button
          type="button"
          class="close"
          aria-label={`Close ${workspace.labels[index]}`}
          onclick={() => workspace.close(tab.id)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    {/each}
  </div>
  <button
    type="button"
    class="new-tab"
    aria-label="New File"
    title="New File"
    onclick={() => workspace.newUntitled()}
  >
    <Icon name="plus" size={14} />
  </button>
  <div class="rest" data-tauri-drag-region></div>
</div>
