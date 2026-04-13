/**
 * Parameters for configuring Temporal activity execution for model calls.
 */

import type { RetryPolicy, Duration } from '@temporalio/common';
import type { Agent, AgentInputItem } from '@openai/agents-core';

/**
 * Abstract interface for providing model summaries.
 * Implement this to customize activity summaries based on agent context.
 */
export interface ModelSummaryProvider {
  /**
   * Given the provided information, produce a summary for the model invocation activity.
   */
  provide(
    agent: Agent<any, any> | undefined,
    instructions: string | undefined,
    input: string | AgentInputItem[]
  ): string;
}

/**
 * Activity cancellation type options.
 */
export type ActivityCancellationType =
  | 'TRY_CANCEL'
  | 'WAIT_CANCELLATION_COMPLETED'
  | 'ABANDON';

/**
 * Parameters for configuring Temporal activity execution for model calls.
 *
 * This interface encapsulates all the parameters that can be used to configure
 * how Temporal activities are executed when making model calls through the
 * OpenAI Agents integration.
 */
export interface ModelActivityParameters {
  /**
   * Specific task queue to use for model activities.
   * If not set, uses the worker's default task queue.
   */
  taskQueue?: string;

  /**
   * Maximum time from scheduling to completion.
   * Can be a Duration string (e.g., '5m', '1h') or milliseconds.
   */
  scheduleToCloseTimeout?: Duration;

  /**
   * Maximum time from scheduling to starting.
   */
  scheduleToStartTimeout?: Duration;

  /**
   * Maximum time for the activity to complete.
   * @default '60s'
   */
  startToCloseTimeout?: Duration;

  /**
   * Maximum time between heartbeats.
   * Enable this for long-running model calls to detect worker failures.
   */
  heartbeatTimeout?: Duration;

  /**
   * Policy for retrying failed activities.
   * If not set, uses Temporal's default retry policy.
   */
  retryPolicy?: RetryPolicy;

  /**
   * How the activity handles cancellation.
   * @default 'TRY_CANCEL'
   */
  cancellationType?: ActivityCancellationType;

  /**
   * Custom summary for the activity execution.
   * Can be a static string or a ModelSummaryProvider for dynamic summaries.
   * If not set, uses the agent name.
   */
  summaryOverride?: string | ModelSummaryProvider;

  /**
   * Whether to use a local activity instead of a regular activity.
   * Local activities are faster but have different failure semantics.
   *
   * WARNING: If changed during a workflow execution, this would break determinism.
   * @default false
   */
  useLocalActivity?: boolean;
}

/**
 * Default model activity parameters.
 */
export const DEFAULT_MODEL_ACTIVITY_PARAMETERS: Required<
  Pick<ModelActivityParameters, 'startToCloseTimeout' | 'cancellationType' | 'useLocalActivity'>
> = {
  startToCloseTimeout: '60s',
  cancellationType: 'TRY_CANCEL',
  useLocalActivity: false,
};
