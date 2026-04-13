/**
 * Temporal activity that invokes an LLM model.
 *
 * This activity wraps model calls to make them durable and retryable
 * through Temporal's activity execution semantics.
 */

import {
  heartbeat,
  activityInfo,
  ApplicationFailure,
} from '@temporalio/activity';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SerializedTool,
  SerializedHandoff,
  SerializedOutputType,
  AgentInputItem,
  ModelSettings,
} from '@openai/agents-core';
import { setTracingDisabled, getOrCreateTrace } from '@openai/agents-core';

/**
 * Activity input for model invocation.
 * This is a serializable version of ModelRequest.
 */
export interface ActivityModelInput {
  /** The model name to use */
  modelName?: string;

  /** System instructions for the model */
  systemInstructions?: string;

  /** The input to the model */
  input: string | AgentInputItem[];

  /** Model settings (temperature, etc.) */
  modelSettings: ModelSettings;

  /** Serialized tools available to the model */
  tools: SerializedTool[];

  /** Output type specification */
  outputType: SerializedOutputType;

  /** Serialized handoffs available to the model */
  handoffs: SerializedHandoff[];

  /** Tracing configuration: 'disabled', 'enabled', or 'enabled_without_data' */
  tracing: 'disabled' | 'enabled' | 'enabled_without_data';

  /** Previous response ID for conversation continuity */
  previousResponseId?: string;

  /** Conversation ID for session management */
  conversationId?: string;
}

/**
 * Starts auto-heartbeat for long-running activities.
 * Heartbeats are sent at half the heartbeat timeout interval.
 */
function startAutoHeartbeat(intervalMs: number): { cancel: () => void } {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const sendHeartbeat = () => {
    if (cancelled) return;
    try {
      heartbeat();
    } catch {
      // Activity might be cancelled, ignore heartbeat errors
    }
    if (!cancelled) {
      timeoutId = setTimeout(sendHeartbeat, intervalMs);
    }
  };

  // Start the heartbeat loop
  timeoutId = setTimeout(sendHeartbeat, intervalMs);

  return {
    cancel: () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  };
}


/**
 * Determines if an OpenAI API error is retryable based on status code and headers.
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;

  const response = (error as { response?: { status?: number; headers?: { get?: (key: string) => string | null } } }).response;
  if (!response) return true;

  // Check x-should-retry header
  const shouldRetry = response.headers?.get?.('x-should-retry');
  if (shouldRetry === 'true') return true;
  if (shouldRetry === 'false') return false;

  // Retryable status codes
  const status = response.status;
  if (status === 408 || status === 409 || status === 429 || (status && status >= 500)) {
    return true;
  }

  return false;
}

/**
 * Checks if an error is an API status error (has response with status code).
 */
function isAPIStatusError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'response' in error &&
    typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
  );
}

/**
 * Creates the model activity functions for the plugin.
 *
 * @param modelProvider - Optional custom model provider. Defaults to OpenAI with retries disabled.
 * @returns An object containing the invokeModelActivity function.
 */
export function createModelActivity(modelProvider?: ModelProvider) {
  // Default provider will be set up by the plugin with OpenAIProvider
  const provider = modelProvider;

  return {
    /**
     * Activity that invokes a model with the given input.
     * This is the core activity that makes LLM calls durable.
     */
    async invokeModelActivity(input: ActivityModelInput): Promise<ModelResponse> {
      if (!provider) {
        throw ApplicationFailure.create({
          message: 'Model provider not configured',
          nonRetryable: true,
        });
      }

      // Disable tracing in activities - the OpenAI SDK's tracing context
      // is not available outside of the Runner context
      setTracingDisabled(true);

      const model = await provider.getModel(input.modelName);

      // Start auto-heartbeat if heartbeat timeout is configured
      const info = activityInfo();
      const heartbeatTask =
        info.heartbeatTimeoutMs && info.heartbeatTimeoutMs > 0
          ? startAutoHeartbeat(info.heartbeatTimeoutMs / 2)
          : null;

      try {
        // Build the model request using serialized tools/handoffs directly
        const request: ModelRequest = {
          systemInstructions: input.systemInstructions,
          input: input.input,
          modelSettings: input.modelSettings,
          tools: input.tools,
          outputType: input.outputType,
          handoffs: input.handoffs,
          // Tracing is disabled in activities as the OpenAI SDK's tracing context
        // is not available outside of the Runner context
        tracing: false,
          previousResponseId: input.previousResponseId,
          conversationId: input.conversationId,
        };

        // Wrap in getOrCreateTrace to provide the required trace context
        // The trace is created but never exported since tracing is disabled
        const response = await getOrCreateTrace(async () => {
          return model.getResponse(request);
        }, { name: 'temporal-model-activity' });
        return response;
      } catch (error) {
        // Handle OpenAI API errors with appropriate retry hints
        if (isAPIStatusError(error)) {
          const shouldRetry = isRetryableError(error);
          const status = (error as { response?: { status?: number } }).response?.status;

          throw ApplicationFailure.create({
            message: `OpenAI API error: ${status}`,
            nonRetryable: !shouldRetry,
            cause: error instanceof Error ? error : undefined,
          });
        }

        // For non-API errors (model provider errors, programming errors, etc.),
        // treat them as non-retryable since they're unlikely to be transient
        throw ApplicationFailure.create({
          message: error instanceof Error ? error.message : String(error),
          nonRetryable: true,
          cause: error instanceof Error ? error : undefined,
        });
      } finally {
        heartbeatTask?.cancel();
      }
    },
  };
}

/**
 * Type for the activities object returned by createModelActivity.
 */
export type ModelActivities = ReturnType<typeof createModelActivity>;
