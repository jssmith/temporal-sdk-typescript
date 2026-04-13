/**
 * TemporalRunner - A wrapper around the OpenAI Agents Runner for Temporal workflows.
 *
 * This module provides a runner that automatically converts agents to use
 * Temporal activities for model invocations, making them durable and retryable.
 */

import { inWorkflowContext } from '@temporalio/workflow';
import type {
  Agent,
  AgentInputItem,
  RunResult,
  StreamedRunResult,
  RunConfig,
  Handoff,
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from '@openai/agents-core';
import { Runner } from '@openai/agents-core';
import { TemporalModelStub } from './model-stub';
import type { ModelActivityParameters } from './model-parameters';

/**
 * A dummy Model implementation for workflow context.
 * This model is never actually called since TemporalModelStub is used instead.
 */
class DummyModel implements Model {
  async getResponse(_request: ModelRequest): Promise<ModelResponse> {
    throw new Error('DummyModel.getResponse should never be called in workflow context');
  }

  async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error('DummyModel.getStreamedResponse should never be called in workflow context');
  }
}

/**
 * A dummy ModelProvider for workflow context.
 * The Runner requires a model provider, but we use TemporalModelStub instead.
 */
class DummyModelProvider implements ModelProvider {
  getModel(_modelName?: string): Model {
    return new DummyModel();
  }
}

/**
 * Error thrown when an agent workflow fails due to Temporal-specific issues.
 */
export class AgentsWorkflowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentsWorkflowError';
  }
}

/**
 * Options for running an agent with Temporal.
 */
export interface TemporalRunOptions<TContext = undefined> {
  /** Context to pass to tools and handoffs */
  context?: TContext;

  /** Maximum number of turns before stopping */
  maxTurns?: number;

  /** Run configuration overrides */
  runConfig?: Partial<RunConfig>;

  /** Previous response ID for conversation continuity */
  previousResponseId?: string;
}

/**
 * Extract the model name from an agent.
 */
function getModelName(agent: Agent<any, any>): string | undefined {
  const model = agent.model;
  if (model === undefined || model === null || model === '') {
    return undefined;
  }
  if (typeof model === 'string') {
    return model;
  }
  // Model is an object - Temporal requires string model names
  throw new Error(
    'Temporal workflows require a model name to be a string in the agent. ' +
      'Got a Model object instead.'
  );
}

/**
 * Recursively convert an agent and its handoffs to use TemporalModelStub.
 *
 * This function replaces the model in each agent with a TemporalModelStub
 * that routes model calls through Temporal activities.
 */
function convertAgent<TAgent extends Agent<any, any>>(
  modelParams: ModelActivityParameters,
  agent: TAgent,
  seen: Map<unknown, Agent<any, any>> | null = null
): TAgent {
  if (seen === null) {
    seen = new Map();
  }

  // Short circuit if this agent was already seen to prevent looping from circular handoffs
  const agentId = agent; // Use the agent object itself as the key
  if (seen.has(agentId)) {
    return seen.get(agentId) as TAgent;
  }

  // This agent has already been processed
  if (agent.model instanceof TemporalModelStub) {
    return agent;
  }

  // Get the model name
  const modelName = getModelName(agent);

  // Clone the agent with the new model
  const newAgent = agent.clone({
    model: new TemporalModelStub(modelName, modelParams, agent),
  }) as TAgent;
  seen.set(agentId, newAgent);

  // Convert handoff agents recursively
  const newHandoffs: (Agent<any, any> | Handoff<any>)[] = [];
  for (const handoff of agent.handoffs) {
    if (handoff instanceof Object && 'model' in handoff && 'handoffs' in handoff) {
      // It's an Agent used as a handoff
      newHandoffs.push(
        convertAgent(modelParams, handoff as Agent<any, any>, seen)
      );
    } else if ('onInvokeHandoff' in handoff) {
      // It's a Handoff object - wrap the onInvokeHandoff to convert returned agents
      const originalInvoke = handoff.onInvokeHandoff as (context: any, args: string) => Promise<Agent<any, any>>;
      const wrappedHandoff = {
        ...handoff,
        onInvokeHandoff: async (
          context: any,
          args: string
        ): Promise<Agent<any, any>> => {
          const handoffAgent = await originalInvoke(context, args);
          return convertAgent(modelParams, handoffAgent, seen);
        },
      };
      newHandoffs.push(wrappedHandoff as Handoff<any>);
    } else {
      newHandoffs.push(handoff);
    }
  }

  // Update the cloned agent's handoffs
  (newAgent as { handoffs: typeof newHandoffs }).handoffs = newHandoffs;

  return newAgent;
}

/**
 * A Temporal-aware runner for OpenAI Agents.
 *
 * This runner wraps the standard OpenAI Agents Runner and automatically
 * converts agents to use Temporal activities for model invocations when
 * running inside a Temporal workflow.
 *
 * Outside of workflows, it delegates to the standard runner.
 */
export class TemporalOpenAIRunner {
  private readonly runner: Runner;
  private readonly modelParams: ModelActivityParameters;

  /**
   * Create a new TemporalOpenAIRunner.
   *
   * @param modelParams - Parameters for activity execution
   * @param runConfig - Optional run configuration
   */
  constructor(
    modelParams: ModelActivityParameters,
    runConfig?: Partial<RunConfig>
  ) {
    this.modelParams = modelParams;
    // In workflow context, we use TemporalModelStub instead of the model provider,
    // so we pass a dummy provider to satisfy the Runner's requirement.
    const runConfigWithProvider: Partial<RunConfig> = inWorkflowContext()
      ? { ...runConfig, modelProvider: new DummyModelProvider() }
      : runConfig ?? {};
    this.runner = new Runner(runConfigWithProvider);
  }

  /**
   * Run an agent workflow.
   *
   * When called inside a Temporal workflow, this method:
   * 1. Validates that tools and MCP servers are workflow-compatible
   * 2. Converts the agent (and all handoff agents) to use TemporalModelStub
   * 3. Executes the agent using the standard runner
   *
   * When called outside a workflow, it delegates directly to the standard runner.
   *
   * @param startingAgent - The agent to start with
   * @param input - The input to the agent
   * @param options - Run options
   * @returns The run result
   */
  async run<TAgent extends Agent<any, any>, TContext = undefined>(
    startingAgent: TAgent,
    input: string | AgentInputItem[],
    options?: TemporalRunOptions<TContext>
  ): Promise<RunResult<TContext, TAgent>> {
    // Outside workflow, delegate to standard runner
    if (!inWorkflowContext()) {
      return this.runner.run(startingAgent, input, {
        context: options?.context,
        maxTurns: options?.maxTurns,
        previousResponseId: options?.previousResponseId,
      }) as Promise<RunResult<TContext, TAgent>>;
    }

    // Validate tools - function tools should use activityAsTool
    for (const t of startingAgent.tools) {
      if (typeof t === 'function') {
        throw new Error(
          'Provided tool is not a tool type. If using an activity, make sure to wrap it with activityAsTool.'
        );
      }
    }

    // Validate MCP servers
    if (startingAgent.mcpServers && startingAgent.mcpServers.length > 0) {
      // In a full implementation, we'd check for StatelessMCPServerReference
      // For now, warn about potential issues
      console.warn(
        'MCP servers in workflows should use statelessMcpServer() for durability.'
      );
    }

    // Handle run config model override
    let runConfig = options?.runConfig;
    if (runConfig?.model) {
      if (typeof runConfig.model !== 'string') {
        throw new Error(
          'Temporal workflows require a model name to be a string in the run config.'
        );
      }
      runConfig = {
        ...runConfig,
        model: new TemporalModelStub(runConfig.model, this.modelParams),
      };
    }

    // Convert agent to use TemporalModelStub
    const convertedAgent = convertAgent(this.modelParams, startingAgent, null);

    try {
      const result = await this.runner.run(convertedAgent, input, {
        context: options?.context,
        maxTurns: options?.maxTurns,
        previousResponseId: options?.previousResponseId,
      });
      return result as RunResult<TContext, TAgent>;
    } catch (error) {
      // Let Temporal failures (ActivityFailure, etc.) propagate directly
      // so they can properly fail the workflow
      if (error instanceof Error && isTemporalFailure(error)) {
        throw error;
      }
      // Wrap non-Temporal errors for cleaner error messages
      if (error instanceof Error) {
        throw new AgentsWorkflowError(
          `Agent workflow failed: ${error.message}`,
          { cause: error }
        );
      }
      throw error;
    }
  }

  /**
   * Streaming is not supported in Temporal workflows.
   */
  runStreamed<TAgent extends Agent<any, any>, TContext = undefined>(
    _startingAgent: TAgent,
    _input: string | AgentInputItem[],
    _options?: TemporalRunOptions<TContext>
  ): StreamedRunResult<TContext, TAgent> {
    if (inWorkflowContext()) {
      throw new Error('Temporal workflows do not support streaming.');
    }
    throw new Error('Use the standard Runner for streaming outside workflows.');
  }
}

/**
 * Check if an error is a Temporal failure exception.
 * These need special handling to properly fail the workflow.
 */
function isTemporalFailure(error: Error): boolean {
  // Check for common Temporal failure types
  const name = error.name;
  return (
    name === 'ApplicationFailure' ||
    name === 'CancelledFailure' ||
    name === 'TerminatedFailure' ||
    name === 'TimeoutFailure' ||
    name === 'ActivityFailure' ||
    name === 'ChildWorkflowFailure'
  );
}

/**
 * Create a TemporalOpenAIRunner with the given parameters.
 *
 * @param modelParams - Parameters for activity execution
 * @param runConfig - Optional run configuration
 * @returns A new TemporalOpenAIRunner instance
 */
export function createTemporalRunner(
  modelParams: ModelActivityParameters,
  runConfig?: Partial<RunConfig>
): TemporalOpenAIRunner {
  return new TemporalOpenAIRunner(modelParams, runConfig);
}
