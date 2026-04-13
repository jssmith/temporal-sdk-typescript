/**
 * Test OpenAI Agents SDK integration with Temporal workflows.
 *
 * These tests verify the @temporalio/openai-agents plugin functionality
 * using fake models for deterministic testing.
 */

import { temporal } from '@temporalio/proto';
import { OpenAIAgentsPlugin } from '@temporalio/openai-agents';
import {
  basicAgentWorkflow,
  haikuAgentWorkflow,
  toolAgentWorkflow,
  multiToolAgentWorkflow,
  handoffAgentWorkflow,
  maxTurnsAgentWorkflow,
} from './workflows/openai-agents';
import * as activities from './activities/openai-agents';
import { helpers, makeTestFunction } from './helpers-integration';
import {
  FakeModelProvider,
  GeneratorFakeModelProvider,
  textResponse,
  toolCallResponse,
  handoffResponse,
} from './stubs/openai-agents';
import type { ModelResponse } from '@openai/agents-core';

import EventType = temporal.api.enums.v1.EventType;

// Toggle for running against real OpenAI API (requires OPENAI_API_KEY)
const remoteTests = ['1', 't', 'true'].includes(
  (process.env.OPENAI_AGENTS_REMOTE_TESTS ?? 'false').toLowerCase()
);

const test = makeTestFunction({
  workflowsPath: require.resolve('./workflows/openai-agents'),
});

// =============================================================================
// Basic Agent Tests
// =============================================================================

test('Basic agent responds to prompt', async (t) => {
  if (remoteTests) {
    t.timeout(120 * 1000);
  }

  const { createWorker, executeWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new FakeModelProvider([textResponse('Hello! How can I help you today?')]),
      }),
    ],
  });

  await worker.runUntil(async () => {
    const result = await executeWorkflow(basicAgentWorkflow, {
      args: ['Hello'],
    });

    t.assert(result);
    if (!remoteTests) {
      t.is(result, 'Hello! How can I help you today?');
    }
  });
});

test('Haiku agent responds in haikus', async (t) => {
  if (remoteTests) {
    t.timeout(120 * 1000);
  }

  const { createWorker, executeWorkflow } = helpers(t);

  const haikuResponse = `Autumn leaves falling
Gentle breeze whispers softly
Nature's poetry`;

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new FakeModelProvider([textResponse(haikuResponse)]),
      }),
    ],
  });

  await worker.runUntil(async () => {
    const result = await executeWorkflow(haikuAgentWorkflow, {
      args: ['Tell me about autumn'],
    });

    t.assert(result);
    if (!remoteTests) {
      t.is(result, haikuResponse);
    }
  });
});

// =============================================================================
// Tool Usage Tests
// =============================================================================

function* toolWorkflowGenerator(): Generator<ModelResponse> {
  // First response: call the getWeather tool
  yield toolCallResponse('getWeather', { location: 'Tokyo' });
  // Second response: final answer after tool result
  yield textResponse('The weather in Tokyo is sunny and 22°C.');
}

test('Agent can use tools backed by Temporal activities', async (t) => {
  if (remoteTests) {
    t.timeout(120 * 1000);
  }

  const { createWorker, startWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new GeneratorFakeModelProvider(toolWorkflowGenerator),
      }),
    ],
    activities,
  });

  await worker.runUntil(async () => {
    const handle = await startWorkflow(toolAgentWorkflow, {
      args: ['What is the weather in Tokyo?'],
      workflowExecutionTimeout: '30 seconds',
    });

    const result = await handle.result();

    t.assert(result);
    if (!remoteTests) {
      t.is(result, 'The weather in Tokyo is sunny and 22°C.');

      // Verify activities were scheduled
      const { events } = await handle.fetchHistory();
      const activityScheduledEvents =
        events?.filter(
          (e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
        ) ?? [];

      // Should have at least 2 activities: invokeModelActivity and getWeather
      t.assert(
        activityScheduledEvents.length >= 2,
        `Expected at least 2 activities, got ${activityScheduledEvents.length}`
      );

      // Check that getWeather activity was called
      const activityTypes = activityScheduledEvents.map(
        (e) => e?.activityTaskScheduledEventAttributes?.activityType?.name
      );
      t.assert(
        activityTypes.includes('getWeather'),
        'getWeather activity should have been called'
      );
    }
  });
});

function* multiToolGenerator(): Generator<ModelResponse> {
  // First: call calculator
  yield toolCallResponse('calculateSum', { a: 5, b: 3 });
  // Second: call weather
  yield toolCallResponse('getWeather', { location: 'London' });
  // Third: final response
  yield textResponse('5 + 3 = 8, and the weather in London is cloudy at 15°C.');
}

test('Agent can use multiple tools', async (t) => {
  if (remoteTests) {
    t.timeout(120 * 1000);
  }

  const { createWorker, startWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new GeneratorFakeModelProvider(multiToolGenerator),
      }),
    ],
    activities,
  });

  await worker.runUntil(async () => {
    const handle = await startWorkflow(multiToolAgentWorkflow, {
      args: ['What is 5 + 3, and what is the weather in London?'],
      workflowExecutionTimeout: '30 seconds',
    });

    const result = await handle.result();

    t.assert(result);
    if (!remoteTests) {
      t.true(result.includes('8'));
      t.true(result.includes('London'));

      // Verify both tool activities were scheduled
      const { events } = await handle.fetchHistory();
      const activityScheduledEvents =
        events?.filter(
          (e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
        ) ?? [];

      const activityTypes = activityScheduledEvents.map(
        (e) => e?.activityTaskScheduledEventAttributes?.activityType?.name
      );

      t.assert(
        activityTypes.includes('calculateSum'),
        'calculateSum activity should have been called'
      );
      t.assert(
        activityTypes.includes('getWeather'),
        'getWeather activity should have been called'
      );
    }
  });
});

// =============================================================================
// Handoff Tests
// =============================================================================

function* handoffGenerator(): Generator<ModelResponse> {
  // Triage agent hands off to weather specialist
  yield handoffResponse('transfer_to_WeatherSpecialist');
  // Weather specialist responds
  yield textResponse('As the weather specialist, I can tell you it is a beautiful sunny day!');
}

test('Agent can hand off to other agents', async (t) => {
  if (remoteTests) {
    t.timeout(120 * 1000);
  }

  const { createWorker, executeWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new GeneratorFakeModelProvider(handoffGenerator),
      }),
    ],
  });

  await worker.runUntil(async () => {
    const result = await executeWorkflow(handoffAgentWorkflow, {
      args: ['What is the weather like today?'],
      workflowExecutionTimeout: '30 seconds',
    });

    t.assert(result);
    if (!remoteTests) {
      t.true(result.includes('weather'));
    }
  });
});

// =============================================================================
// Max Turns Tests
// =============================================================================

test('Agent respects max turns limit', async (t) => {
  const { createWorker, executeWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new FakeModelProvider([textResponse('Response in one turn')]),
      }),
    ],
  });

  await worker.runUntil(async () => {
    const result = await executeWorkflow(maxTurnsAgentWorkflow, {
      args: ['Hello', 3],
      workflowExecutionTimeout: '30 seconds',
    });

    t.assert(result);
    t.is(result.output, 'Response in one turn');
    t.true(result.turnCount <= 3, `Turn count ${result.turnCount} should be <= 3`);
  });
});

// =============================================================================
// Activity Scheduling Verification
// =============================================================================

test('Model invocations are scheduled as activities', async (t) => {
  const { createWorker, startWorkflow } = helpers(t);

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: new FakeModelProvider([textResponse('Activity test response')]),
      }),
    ],
  });

  await worker.runUntil(async () => {
    const handle = await startWorkflow(basicAgentWorkflow, {
      args: ['Test activity scheduling'],
      workflowExecutionTimeout: '30 seconds',
    });

    await handle.result();

    // Verify invokeModelActivity was scheduled
    const { events } = await handle.fetchHistory();
    const activityScheduledEvents =
      events?.filter(
        (e) => e.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED
      ) ?? [];

    const activityTypes = activityScheduledEvents.map(
      (e) => e?.activityTaskScheduledEventAttributes?.activityType?.name
    );

    t.assert(
      activityTypes.includes('invokeModelActivity'),
      'invokeModelActivity should have been scheduled'
    );
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

test('Handles model errors gracefully', async (t) => {
  const { createWorker, startWorkflow } = helpers(t);

  // Create a provider that throws an error
  const errorProvider = {
    async getModel() {
      return {
        async getResponse() {
          throw new Error('Model API error');
        },
        async *getStreamedResponse() {
          throw new Error('Streaming not supported');
        },
      };
    },
  };

  const worker = await createWorker({
    plugins: [
      new OpenAIAgentsPlugin({
        modelProvider: errorProvider,
      }),
    ],
  });

  await worker.runUntil(async () => {
    const handle = await startWorkflow(basicAgentWorkflow, {
      args: ['This should fail'],
      workflowExecutionTimeout: '30 seconds',
    });

    // Expect the workflow to fail - error message is at top level
    // The actual "Model API error" is nested in cause.cause.message
    const error = await t.throwsAsync(handle.result(), {
      message: /Workflow execution failed/,
    });

    // Verify the error chain contains our original error message
    // @ts-expect-error - accessing cause chain
    const activityCause = error?.cause?.cause;
    t.is(activityCause?.message, 'Model API error');
  });
});
