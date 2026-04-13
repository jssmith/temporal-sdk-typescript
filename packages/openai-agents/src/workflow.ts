/**
 * Workflow utilities for OpenAI Agents SDK integration.
 *
 * This module provides utilities for using Temporal activities and MCP servers
 * as OpenAI agent tools within Temporal workflows.
 */

import {
  proxyActivities,
  ActivityOptions,
} from '@temporalio/workflow';
import type {
  FunctionTool,
  MCPServer,
  RunContext,
} from '@openai/agents-core';
import type { RetryPolicy, Duration } from '@temporalio/common';

/**
 * MCP tool input schema structure expected by MCPServer interface.
 */
interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
}

/**
 * MCP tool content result structure.
 */
type CallToolResultContent = Array<{ type: string; text: string }>;

/**
 * Error thrown when tool serialization fails.
 */
export class ToolSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolSerializationError';
  }
}

/**
 * Error thrown when an agent workflow fails due to Temporal-specific issues.
 * Re-exported from runner for convenience.
 */
export { AgentsWorkflowError, createTemporalRunner, TemporalOpenAIRunner } from './runner';
export type { TemporalRunOptions } from './runner';

/**
 * Options for converting an activity to a tool.
 */
export interface ActivityAsToolOptions {
  /** Task queue for the activity (uses workflow's queue if not specified) */
  taskQueue?: string;

  /** Maximum time from scheduling to completion */
  scheduleToCloseTimeout?: Duration;

  /** Maximum time from scheduling to starting */
  scheduleToStartTimeout?: Duration;

  /** Maximum time for the activity to complete */
  startToCloseTimeout?: Duration;

  /** Maximum time between heartbeats */
  heartbeatTimeout?: Duration;

  /** Retry policy for the activity */
  retryPolicy?: RetryPolicy;

  /** Custom activity ID */
  activityId?: string;

  /** Custom summary for the activity */
  summary?: string;

  /** Whether to use strict JSON schema validation */
  strictJsonSchema?: boolean;
}

/**
 * JSON schema for tool parameters.
 */
export interface JsonObjectSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Definition for an activity that can be converted to a tool.
 */
export interface ActivityToolDefinition<TInput, TOutput> {
  /** The name of the activity (and tool) */
  name: string;

  /** Description of what the tool does */
  description: string;

  /** JSON schema for the input parameters */
  parameters: JsonObjectSchema;

  /** The activity function type (for type inference) */
  activityFn: (input: TInput) => Promise<TOutput>;
}

/**
 * Convert a Temporal activity to an OpenAI agent tool.
 *
 * This function creates a FunctionTool that executes the specified activity
 * when invoked by the agent. The tool handles JSON parsing of inputs and
 * string conversion of outputs.
 *
 * @param definition - The activity definition including name, description, and schema
 * @param options - Activity execution options (timeouts, retry policy, etc.)
 * @returns A FunctionTool that can be used with OpenAI agents
 *
 * @example
 * ```typescript
 * // Define your activity
 * const getWeatherActivity = {
 *   name: 'getWeather',
 *   description: 'Get the weather for a location',
 *   parameters: {
 *     type: 'object',
 *     properties: {
 *       location: { type: 'string', description: 'City name' },
 *     },
 *     required: ['location'],
 *   },
 *   activityFn: async (input: { location: string }) => {
 *     // This is just for type inference, not executed
 *     return { temperature: 72 };
 *   },
 * };
 *
 * // Convert to tool
 * const weatherTool = activityAsTool(getWeatherActivity, {
 *   startToCloseTimeout: '30s',
 * });
 *
 * // Use with agent
 * const agent = new Agent({
 *   name: 'Weather Agent',
 *   tools: [weatherTool],
 * });
 * ```
 *
 * @experimental This API is experimental and may change in future versions.
 */
export function activityAsTool<TInput, TOutput>(
  definition: ActivityToolDefinition<TInput, TOutput>,
  options: ActivityAsToolOptions = {}
): FunctionTool<unknown> {
  const { name, description, parameters } = definition;

  // Build activity options
  const activityOptions: ActivityOptions = {
    taskQueue: options.taskQueue,
    scheduleToCloseTimeout: options.scheduleToCloseTimeout,
    scheduleToStartTimeout: options.scheduleToStartTimeout,
    startToCloseTimeout: options.startToCloseTimeout ?? '1m',
    heartbeatTimeout: options.heartbeatTimeout,
    retry: options.retryPolicy,
    activityId: options.activityId,
  };

  // Ensure parameters has required fields for FunctionTool
  const toolParameters = {
    type: 'object' as const,
    properties: parameters.properties,
    required: parameters.required ?? [],
    additionalProperties: parameters.additionalProperties ?? false,
  };

  // Create the tool
  const tool: FunctionTool<unknown> = {
    type: 'function',
    name,
    description,
    parameters: toolParameters,
    strict: options.strictJsonSchema ?? true,

    invoke: async (
      _runContext: RunContext<unknown>,
      input: string
    ): Promise<string> => {
      // Parse JSON input
      let parsedInput: TInput;
      try {
        parsedInput = JSON.parse(input) as TInput;
      } catch {
        throw new ToolSerializationError(
          `Invalid JSON input for tool ${name}: ${input}`
        );
      }

      // Create activity proxy and execute
      const activities = proxyActivities<Record<string, (input: TInput) => Promise<TOutput>>>(
        activityOptions
      );

      const activityFn = activities[name];
      if (!activityFn) {
        throw new ToolSerializationError(`Activity '${name}' not found`);
      }
      const result = await activityFn(parsedInput);

      // Convert result to string
      try {
        if (typeof result === 'string') {
          return result;
        }
        return JSON.stringify(result);
      } catch {
        throw new ToolSerializationError(
          'Tool output must be convertible to string. ' +
            'Return a string or JSON-serializable object.'
        );
      }
    },

    needsApproval: async () => false,
    isEnabled: async () => true,
  };

  return tool;
}

/**
 * Options for stateless MCP server.
 */
export interface StatelessMCPServerOptions {
  /** Activity options for MCP operations */
  activityOptions?: ActivityOptions;

  /** Whether to cache the tools list */
  cacheToolsList?: boolean;

  /** Optional argument for the MCP server factory */
  factoryArgument?: unknown;
}

/**
 * MCP tool definition returned from list operations.
 */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

/**
 * Result from calling an MCP tool.
 */
export interface MCPCallToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * A stateless MCP server reference for Temporal workflows.
 *
 * This creates an MCPServer-compatible object that executes MCP operations
 * as Temporal activities. Each operation (listTools, callTool) is a separate
 * activity call, providing durability without maintaining persistent connections.
 *
 * This approach is suitable for simple use cases where connection overhead is
 * acceptable and you don't need to maintain state between operations.
 */
class StatelessMCPServerReference implements MCPServer {
  private readonly serverName: string;
  private readonly activityOptions: ActivityOptions;
  readonly cacheToolsList: boolean;
  private readonly factoryArgument: unknown;
  private cachedTools?: MCPToolDefinition[];

  constructor(name: string, options: StatelessMCPServerOptions = {}) {
    this.serverName = name;
    this.activityOptions = options.activityOptions ?? {
      startToCloseTimeout: '1m',
    };
    this.cacheToolsList = options.cacheToolsList ?? false;
    this.factoryArgument = options.factoryArgument;
  }

  get name(): string {
    return `${this.serverName}-stateless`;
  }

  async connect(): Promise<void> {
    // No-op - connections happen per-activity
  }

  async close(): Promise<void> {
    // No-op - no persistent connection to close
  }

  async invalidateToolsCache(): Promise<void> {
    this.cachedTools = undefined;
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    if (this.cachedTools && this.cacheToolsList) {
      return this.cachedTools;
    }

    // Execute activity to list tools
    type ListToolsInput = { factoryArgument?: unknown };
    const activities = proxyActivities<{
      [key: string]: (input: ListToolsInput) => Promise<MCPToolDefinition[]>;
    }>(this.activityOptions);

    const activityName = `${this.serverName}-list-tools`;
    const activityFn = activities[activityName];
    if (!activityFn) {
      throw new Error(`Activity '${activityName}' not found`);
    }
    const toolDefs = await activityFn({
      factoryArgument: this.factoryArgument,
    });

    if (this.cacheToolsList) {
      this.cachedTools = toolDefs;
    }

    return toolDefs;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown> | null
  ): Promise<CallToolResultContent> {
    type CallToolInput = {
      toolName: string;
      arguments?: Record<string, unknown> | null;
      factoryArgument?: unknown;
    };

    const activities = proxyActivities<{
      [key: string]: (input: CallToolInput) => Promise<MCPCallToolResult>;
    }>(this.activityOptions);

    const activityName = `${this.serverName}-call-tool`;
    const activityFn = activities[activityName];
    if (!activityFn) {
      throw new Error(`Activity '${activityName}' not found`);
    }
    const result = await activityFn({
      toolName,
      arguments: args,
      factoryArgument: this.factoryArgument,
    });

    // Return the content array as expected by MCPServer interface
    return result.content.map((c) => ({
      type: c.type,
      text: c.text ?? '',
    }));
  }
}

/**
 * Create a stateless MCP server reference for use in workflows.
 *
 * This creates an MCPServer-compatible object that executes MCP operations
 * as Temporal activities. It provides durability without maintaining
 * persistent connections between operations.
 *
 * @param name - Name of the MCP server (should match plugin configuration)
 * @param options - Configuration options
 * @returns An MCPServer instance for use with OpenAI agents
 *
 * @example
 * ```typescript
 * const mcpServer = statelessMcpServer('my-mcp-server', {
 *   activityOptions: {
 *     startToCloseTimeout: '2m',
 *   },
 *   cacheToolsList: true,
 * });
 *
 * const agent = new Agent({
 *   name: 'MCP Agent',
 *   mcpServers: [mcpServer],
 * });
 * ```
 *
 * @experimental This API is experimental and may change in future versions.
 */
export function statelessMcpServer(
  name: string,
  options?: StatelessMCPServerOptions
): MCPServer {
  return new StatelessMCPServerReference(name, options);
}
