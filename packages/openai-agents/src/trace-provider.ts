/**
 * Tracing utilities for OpenAI Agents SDK in Temporal workflows.
 *
 * The OpenAI Agents SDK uses non-deterministic operations for tracing
 * (randomUUID, Date.now) which can break workflow replay. This module
 * provides utilities to handle tracing in workflow context.
 *
 * Recommended approach: Disable tracing in workflow context entirely.
 * The actual model invocations happen in activities where tracing works
 * normally with full observability.
 */

import { inWorkflowContext, workflowInfo } from '@temporalio/workflow';

/**
 * Check if we're currently in a workflow context.
 */
export function isInWorkflow(): boolean {
  return inWorkflowContext();
}

/**
 * Check if the workflow is currently replaying.
 * Returns false if not in a workflow context.
 */
export function isReplaying(): boolean {
  if (!inWorkflowContext()) {
    return false;
  }
  return workflowInfo().unsafe.isReplaying;
}

/**
 * Get tracing configuration for use in workflows.
 *
 * Returns 'disabled' when in workflow context to prevent non-deterministic
 * operations from breaking replay. Tracing still works in activities where
 * the actual model calls happen.
 *
 * @returns Tracing configuration value
 */
export function getWorkflowTracingConfig(): 'disabled' | 'enabled' {
  if (inWorkflowContext()) {
    return 'disabled';
  }
  return 'enabled';
}

/**
 * Determine if tracing should be enabled for the current context.
 *
 * @param requestedTracing - The tracing configuration requested by the caller
 * @returns Whether tracing should actually be enabled
 */
export function shouldEnableTracing(
  requestedTracing: boolean | 'enabled_without_data'
): boolean {
  // Always disable tracing in workflow context to maintain determinism
  if (inWorkflowContext()) {
    return false;
  }
  return requestedTracing !== false;
}
