/**
 * TemporalModelStub - A Model implementation that delegates to Temporal activities.
 *
 * This module is intended to be used within Temporal workflows.
 * It implements the OpenAI Agents SDK Model interface but routes all
 * model calls through Temporal activities for durability.
 */

import {
  proxyActivities,
  proxyLocalActivities,
  ActivityOptions,
} from '@temporalio/workflow';
import type { LocalActivityOptions } from '@temporalio/common';
import type {
  Model,
  ModelRequest,
  ModelResponse,
  Agent,
  SerializedTool,
  SerializedHandoff,
  StreamEvent,
} from '@openai/agents-core';
import type { ModelActivityParameters, ModelSummaryProvider } from './model-parameters';
import { DEFAULT_MODEL_ACTIVITY_PARAMETERS } from './model-parameters';
import type { ActivityModelInput, ModelActivities } from './activities';

/**
 * A stub that allows invoking models as Temporal activities.
 *
 * This class implements the Model interface from the OpenAI Agents SDK,
 * but instead of calling the model directly, it executes a Temporal activity
 * that makes the actual model call. This provides durability and automatic
 * retry handling for LLM calls.
 */
export class TemporalModelStub implements Model {
  private readonly modelName: string | undefined;
  private readonly modelParams: ModelActivityParameters;
  private readonly agent: Agent<any, any> | undefined;

  constructor(
    modelName: string | undefined,
    modelParams: ModelActivityParameters,
    agent?: Agent<any, any>
  ) {
    this.modelName = modelName;
    this.modelParams = modelParams;
    this.agent = agent;
  }

  /**
   * Get a response from the model via a Temporal activity.
   */
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    // Serialize tools - they already come serialized in ModelRequest
    const tools: SerializedTool[] = request.tools;
    const handoffs: SerializedHandoff[] = request.handoffs;

    // Build the activity input
    const activityInput: ActivityModelInput = {
      modelName: this.modelName,
      systemInstructions: request.systemInstructions,
      input: request.input,
      modelSettings: request.modelSettings,
      tools,
      outputType: request.outputType,
      handoffs,
      tracing:
        request.tracing === false
          ? 'disabled'
          : request.tracing === 'enabled_without_data'
            ? 'enabled_without_data'
            : 'enabled',
      previousResponseId: request.previousResponseId,
      conversationId: request.conversationId,
    };

    // Determine the activity summary
    const summary = this.getSummary(request.systemInstructions, request.input);

    // Build activity options
    const baseOptions = {
      startToCloseTimeout:
        this.modelParams.startToCloseTimeout ??
        DEFAULT_MODEL_ACTIVITY_PARAMETERS.startToCloseTimeout,
      scheduleToCloseTimeout: this.modelParams.scheduleToCloseTimeout,
      scheduleToStartTimeout: this.modelParams.scheduleToStartTimeout,
      retry: this.modelParams.retryPolicy,
    };

    if (this.modelParams.useLocalActivity) {
      // Use local activity
      const localOptions: LocalActivityOptions = {
        ...baseOptions,
      };

      const activities = proxyLocalActivities<ModelActivities>(localOptions);
      return activities.invokeModelActivity(activityInput);
    } else {
      // Use regular activity
      const activityOptions: ActivityOptions = {
        ...baseOptions,
        taskQueue: this.modelParams.taskQueue,
        heartbeatTimeout: this.modelParams.heartbeatTimeout,
      };

      const activities = proxyActivities<ModelActivities>(activityOptions);
      return activities.invokeModelActivity(activityInput);
    }
  }

  /**
   * Streaming is not supported in Temporal workflows.
   */
  async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error('Streaming is not supported in Temporal workflows');
  }

  /**
   * Determine the summary for the activity execution.
   */
  private getSummary(
    instructions: string | undefined,
    input: string | unknown[]
  ): string | undefined {
    if (this.modelParams.summaryOverride) {
      if (typeof this.modelParams.summaryOverride === 'string') {
        return this.modelParams.summaryOverride;
      }
      // It's a ModelSummaryProvider
      const provider = this.modelParams.summaryOverride as ModelSummaryProvider;
      return provider.provide(this.agent, instructions, input as string | import('@openai/agents-core').AgentInputItem[]);
    }

    // Default to agent name if available
    if (this.agent) {
      return this.agent.name;
    }

    return undefined;
  }
}

/**
 * Creates a TemporalModelStub for use in workflows.
 *
 * @param modelName - The model name (e.g., 'gpt-4', 'gpt-3.5-turbo')
 * @param modelParams - Activity execution parameters
 * @param agent - Optional agent for context (used for summary)
 * @returns A Model implementation that routes calls through Temporal activities
 */
export function createTemporalModel(
  modelName: string | undefined,
  modelParams: ModelActivityParameters,
  agent?: Agent<any, any>
): Model {
  return new TemporalModelStub(modelName, modelParams, agent);
}
