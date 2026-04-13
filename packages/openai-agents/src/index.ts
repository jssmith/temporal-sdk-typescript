/**
 * @temporalio/openai-agents
 *
 * Temporal integration for the OpenAI Agents SDK.
 *
 * This package enables running OpenAI Agents SDK workflows within Temporal,
 * providing durability, automatic retries, and observability for AI agent
 * workflows.
 *
 * ## Quick Start
 *
 * ```typescript
 * // Worker setup
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
 *   taskQueue: 'agents-task-queue',
 *   workflowsPath: require.resolve('./workflows'),
 * });
 *
 * // Workflow code
 * import { Agent } from '@openai/agents-core';
 * import { createTemporalRunner } from '@temporalio/openai-agents';
 *
 * export async function agentWorkflow(input: string): Promise<string> {
 *   const agent = new Agent({
 *     name: 'My Agent',
 *     instructions: 'You are a helpful assistant.',
 *   });
 *
 *   const runner = createTemporalRunner({
 *     startToCloseTimeout: '2m',
 *   });
 *
 *   const result = await runner.run(agent, input);
 *   return result.finalOutput;
 * }
 * ```
 *
 * @packageDocumentation
 */

// Plugin
export {
  OpenAIAgentsPlugin,
  OpenAIAgentsPluginOptions,
  createOpenAIAgentsPlugin,
} from './plugin';

// Runner
export {
  TemporalOpenAIRunner,
  TemporalRunOptions,
  AgentsWorkflowError,
  createTemporalRunner,
} from './runner';

// Model configuration
export {
  ModelActivityParameters,
  ModelSummaryProvider,
  ActivityCancellationType,
  DEFAULT_MODEL_ACTIVITY_PARAMETERS,
} from './model-parameters';

// Model stub (for workflow code)
export { TemporalModelStub, createTemporalModel } from './model-stub';

// Activities
export {
  createModelActivity,
  ActivityModelInput,
  ModelActivities,
} from './activities';

// Tracing utilities
export {
  isInWorkflow,
  isReplaying,
  getWorkflowTracingConfig,
  shouldEnableTracing,
} from './trace-provider';

// Re-export workflow utilities for convenience
// (These are also available via '@temporalio/openai-agents/workflow')
export {
  activityAsTool,
  statelessMcpServer,
  ActivityAsToolOptions,
  ActivityToolDefinition,
  StatelessMCPServerOptions,
  MCPToolDefinition,
  MCPCallToolResult,
  ToolSerializationError,
} from './workflow';
