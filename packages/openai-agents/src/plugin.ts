/**
 * OpenAI Agents Plugin for Temporal.
 *
 * This plugin integrates the OpenAI Agents SDK with Temporal, enabling
 * durable AI agent workflows. Model calls are executed as Temporal activities,
 * providing automatic retry handling and durability.
 */

import { SimplePlugin } from '@temporalio/plugin';
import type { ModelProvider } from '@openai/agents-core';
import { createModelActivity } from './activities';
import type { ModelActivityParameters } from './model-parameters';
import { DEFAULT_MODEL_ACTIVITY_PARAMETERS } from './model-parameters';

/**
 * Options for the OpenAI Agents plugin.
 */
export interface OpenAIAgentsPluginOptions {
  /**
   * The model provider to use for LLM calls.
   * This is required and typically an OpenAIProvider instance.
   *
   * @example
   * ```typescript
   * import { OpenAIProvider } from '@openai/agents-openai';
   *
   * const plugin = new OpenAIAgentsPlugin({
   *   modelProvider: new OpenAIProvider(),
   * });
   * ```
   */
  modelProvider: ModelProvider;

  /**
   * Parameters for activity execution (timeouts, retry policy, etc.).
   * If not provided, default parameters are used.
   */
  modelParams?: ModelActivityParameters;

  /**
   * Whether to register activities with the worker.
   * Set to false for workflow-only workers.
   * @default true
   */
  registerActivities?: boolean;
}

/**
 * A Temporal plugin that integrates OpenAI Agents SDK for use in workflows.
 *
 * This plugin:
 * - Registers the model invocation activity with workers
 * - Configures the model provider for LLM calls
 * - Provides durability for agent workflows through Temporal activities
 *
 * @example
 * ```typescript
 * import { Worker } from '@temporalio/worker';
 * import { OpenAIAgentsPlugin } from '@temporalio/openai-agents';
 * import { OpenAIProvider } from '@openai/agents-openai';
 *
 * const plugin = new OpenAIAgentsPlugin({
 *   modelProvider: new OpenAIProvider(),
 * });
 *
 * const worker = await Worker.create({
 *   plugins: [plugin],
 *   taskQueue: 'my-task-queue',
 *   workflowsPath: require.resolve('./workflows'),
 * });
 * ```
 *
 * @experimental The OpenAI Agents plugin is an experimental feature; APIs may change without notice.
 */
export class OpenAIAgentsPlugin extends SimplePlugin {
  private readonly modelParams: ModelActivityParameters;

  constructor(options: OpenAIAgentsPluginOptions) {
    // Merge provided params with defaults
    const modelParams: ModelActivityParameters = {
      ...DEFAULT_MODEL_ACTIVITY_PARAMETERS,
      ...options.modelParams,
    };

    // Ensure at least one timeout is set
    if (!modelParams.startToCloseTimeout && !modelParams.scheduleToCloseTimeout) {
      modelParams.startToCloseTimeout = DEFAULT_MODEL_ACTIVITY_PARAMETERS.startToCloseTimeout;
    }

    super({
      name: 'OpenAIAgentsPlugin',
      activities:
        options.registerActivities !== false
          ? createModelActivity(options.modelProvider)
          : undefined,
    });

    this.modelParams = modelParams;
  }

  /**
   * Get the model activity parameters configured for this plugin.
   * Useful for creating TemporalOpenAIRunner instances with matching configuration.
   */
  getModelParams(): ModelActivityParameters {
    return { ...this.modelParams };
  }
}

/**
 * Create an OpenAI Agents plugin with the given options.
 *
 * @param options - Plugin configuration options
 * @returns A new OpenAIAgentsPlugin instance
 *
 * @example
 * ```typescript
 * import { createOpenAIAgentsPlugin } from '@temporalio/openai-agents';
 * import { OpenAIProvider } from '@openai/agents-openai';
 *
 * const plugin = createOpenAIAgentsPlugin({
 *   modelProvider: new OpenAIProvider(),
 *   modelParams: {
 *     startToCloseTimeout: '2m',
 *     heartbeatTimeout: '30s',
 *   },
 * });
 * ```
 */
export function createOpenAIAgentsPlugin(
  options: OpenAIAgentsPluginOptions
): OpenAIAgentsPlugin {
  return new OpenAIAgentsPlugin(options);
}
