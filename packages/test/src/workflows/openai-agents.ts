/**
 * Test workflows for the OpenAI Agents Temporal plugin.
 *
 * These workflows demonstrate various agent patterns and are used
 * for integration testing.
 */

// Load polyfills first - must be before any OpenAI Agents imports
import '@temporalio/openai-agents/load-polyfills';

import { Agent } from '@openai/agents-core';
import { proxyActivities } from '@temporalio/workflow';
import {
  createTemporalRunner,
  activityAsTool,
} from '@temporalio/openai-agents';
import type * as activities from '../activities/openai-agents';

// Proxy activities for tool usage
const { getWeather, calculateSum } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/**
 * Basic agent workflow - simple text response.
 */
export async function basicAgentWorkflow(prompt: string): Promise<string> {
  const agent = new Agent({
    name: 'BasicAgent',
    instructions: 'You are a helpful assistant. Respond concisely.',
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(agent, prompt);
  return result.finalOutput ?? '';
}

/**
 * Agent workflow with custom instructions.
 */
export async function haikuAgentWorkflow(prompt: string): Promise<string> {
  const agent = new Agent({
    name: 'HaikuAgent',
    instructions: 'You only respond in haikus. Always format your response as a traditional 5-7-5 syllable haiku.',
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(agent, prompt);
  return result.finalOutput ?? '';
}

/**
 * Agent workflow with a tool that calls a Temporal activity.
 */
export async function toolAgentWorkflow(question: string): Promise<string> {
  // Create a tool that wraps the getWeather activity
  const weatherTool = activityAsTool(
    {
      name: 'getWeather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city or location to get weather for',
          },
        },
        required: ['location'],
        additionalProperties: false,
      },
      activityFn: getWeather,
    },
    {
      startToCloseTimeout: '30s',
    }
  );

  const agent = new Agent({
    name: 'WeatherAgent',
    instructions: 'You are a weather assistant. Use the getWeather tool to answer weather questions.',
    tools: [weatherTool],
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(agent, question, { maxTurns: 5 });
  return result.finalOutput ?? '';
}

/**
 * Agent workflow with multiple tools.
 */
export async function multiToolAgentWorkflow(question: string): Promise<string> {
  const weatherTool = activityAsTool(
    {
      name: 'getWeather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'The location' },
        },
        required: ['location'],
        additionalProperties: false,
      },
      activityFn: getWeather,
    },
    { startToCloseTimeout: '30s' }
  );

  const calculatorTool = activityAsTool(
    {
      name: 'calculateSum',
      description: 'Calculate the sum of two numbers',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      activityFn: calculateSum,
    },
    { startToCloseTimeout: '30s' }
  );

  const agent = new Agent({
    name: 'MultiToolAgent',
    instructions: 'You are a helpful assistant with access to weather and calculator tools.',
    tools: [weatherTool, calculatorTool],
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(agent, question, { maxTurns: 5 });
  return result.finalOutput ?? '';
}

/**
 * Agent workflow with handoffs between agents.
 */
export async function handoffAgentWorkflow(question: string): Promise<string> {
  // Specialist agent for weather
  const weatherAgent = new Agent({
    name: 'WeatherSpecialist',
    instructions: 'You are a weather specialist. Provide detailed weather information.',
    handoffDescription: 'Specialist for weather-related questions',
  });

  // Specialist agent for math
  const mathAgent = new Agent({
    name: 'MathSpecialist',
    instructions: 'You are a math specialist. Help with calculations and math problems.',
    handoffDescription: 'Specialist for math and calculations',
  });

  // Triage agent that routes to specialists
  const triageAgent = new Agent({
    name: 'TriageAgent',
    instructions: `You are a triage agent. Route questions to the appropriate specialist:
    - Weather questions go to WeatherSpecialist
    - Math questions go to MathSpecialist
    - For other questions, answer directly.`,
    handoffs: [weatherAgent, mathAgent],
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(triageAgent, question, { maxTurns: 10 });
  return result.finalOutput ?? '';
}

/**
 * Agent workflow with max turns limit.
 */
export async function maxTurnsAgentWorkflow(
  prompt: string,
  maxTurns: number
): Promise<{ output: string; turnCount: number }> {
  const agent = new Agent({
    name: 'TurnsAgent',
    instructions: 'You are a helpful assistant.',
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const result = await runner.run(agent, prompt, { maxTurns });
  // Use rawResponses.length as a proxy for turn count
  // since turnCount isn't directly exposed on RunState
  return {
    output: result.finalOutput ?? '',
    turnCount: result.rawResponses.length,
  };
}

/**
 * Agent workflow with context passed through.
 */
export async function contextAgentWorkflow(
  prompt: string,
  userId: string
): Promise<string> {
  interface UserContext {
    userId: string;
    preferences: { language: string };
  }

  const agent = new Agent<UserContext>({
    name: 'ContextAgent',
    instructions: 'You are a helpful assistant. Use the user context to personalize responses.',
  });

  const runner = createTemporalRunner({
    startToCloseTimeout: '2m',
  });

  const context: UserContext = {
    userId,
    preferences: { language: 'English' },
  };

  const result = await runner.run(agent, prompt, { context });
  return result.finalOutput ?? '';
}
