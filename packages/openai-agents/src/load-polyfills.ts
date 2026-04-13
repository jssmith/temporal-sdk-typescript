/**
 * Polyfills for running OpenAI Agents SDK in Temporal workflow sandbox.
 *
 * Temporal workflows run in a sandboxed JavaScript environment with limited
 * globals. This module provides polyfills for Web APIs that the OpenAI Agents
 * SDK may depend on.
 *
 * Usage: Import this module at the top of your workflow file:
 * ```typescript
 * import '@temporalio/openai-agents/load-polyfills';
 * ```
 */

import { inWorkflowContext } from '@temporalio/workflow';

// Type for globalThis with optional polyfill properties
type GlobalThisWithPolyfills = typeof globalThis & {
  Headers?: unknown;
  ReadableStream?: unknown;
  structuredClone?: unknown;
  crypto?: { randomUUID?: () => string } | undefined;
  EventTarget?: unknown;
  Event?: unknown;
  CustomEvent?: unknown;
};

// Minimal type definitions for event handling (DOM types not available in workflow sandbox)
type EventHandler = (event: EventPolyfill) => void;
type EventHandlerObject = { handleEvent: (event: EventPolyfill) => void };
type EventListener = EventHandler | EventHandlerObject;

/**
 * Simple Event polyfill for workflow sandbox.
 */
class EventPolyfill {
  readonly type: string;
  readonly timeStamp: number;
  readonly defaultPrevented: boolean = false;
  readonly bubbles: boolean = false;
  readonly cancelable: boolean = false;

  constructor(type: string, _eventInitDict?: { bubbles?: boolean; cancelable?: boolean }) {
    this.type = type;
    this.timeStamp = Date.now();
  }

  preventDefault(): void {
    // No-op
  }

  stopPropagation(): void {
    // No-op
  }

  stopImmediatePropagation(): void {
    // No-op
  }
}

/**
 * CustomEvent polyfill for workflow sandbox.
 */
class CustomEventPolyfill<T = unknown> extends EventPolyfill {
  readonly detail: T | null;

  constructor(
    type: string,
    eventInitDict?: { bubbles?: boolean; cancelable?: boolean; detail?: T }
  ) {
    super(type, eventInitDict);
    this.detail = eventInitDict?.detail ?? null;
  }
}

/**
 * Simple EventTarget polyfill for workflow sandbox.
 * Provides basic event emission functionality needed by the OpenAI Agents SDK.
 */
class EventTargetPolyfill {
  private listeners: Map<string, Set<EventListener>> = new Map();

  addEventListener(
    type: string,
    callback: EventListener | null,
    _options?: { capture?: boolean; once?: boolean; passive?: boolean } | boolean
  ): void {
    if (!callback) return;
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
  }

  removeEventListener(
    type: string,
    callback: EventListener | null,
    _options?: { capture?: boolean } | boolean
  ): void {
    if (!callback) return;
    this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: EventPolyfill): boolean {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return true;

    for (const listener of listeners) {
      try {
        if (typeof listener === 'function') {
          listener.call(this, event);
        } else if (listener.handleEvent) {
          listener.handleEvent(event);
        }
      } catch {
        // Ignore errors in event handlers
      }
    }
    return !event.defaultPrevented;
  }
}

const g = globalThis as GlobalThisWithPolyfills;

if (inWorkflowContext()) {
  // Apply Headers polyfill if needed
  if (typeof g.Headers === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Headers } = require('headers-polyfill');
      g.Headers = Headers;
    } catch {
      // headers-polyfill not available, skip
    }
  }

  // Apply web-streams-polyfill if needed
  if (typeof g.ReadableStream === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports,import/no-unassigned-import
      require('web-streams-polyfill/polyfill');
    } catch {
      // web-streams-polyfill not available, skip
    }
  }

  // Apply structuredClone polyfill if needed
  if (!('structuredClone' in g)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const structuredClone = require('@ungap/structured-clone');
      g.structuredClone = structuredClone.default;
    } catch {
      // @ungap/structured-clone not available, skip
    }
  }

  // Apply crypto.randomUUID polyfill if needed (for tracing)
  if (typeof g.crypto === 'undefined' || !g.crypto?.randomUUID) {
    // Create a deterministic UUID generator for workflow replay compatibility
    // Note: In practice, tracing should be disabled in workflow context
    const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
      // This is a simple polyfill - actual implementation should use
      // deterministic generation based on workflow run ID
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }) as `${string}-${string}-${string}-${string}-${string}`;
    };

    if (typeof g.crypto === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      g.crypto = { randomUUID } as any;
    } else {
      g.crypto.randomUUID = randomUUID;
    }
  }

  // Apply EventTarget polyfill if needed (for OpenAI Agents SDK event emission)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).EventTarget === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventTarget = EventTargetPolyfill;
  }

  // Apply Event polyfill if needed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).Event === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Event = EventPolyfill;
  }

  // Apply CustomEvent polyfill if needed (for OpenAI Agents SDK event emission)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).CustomEvent === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CustomEvent = CustomEventPolyfill;
  }
}
