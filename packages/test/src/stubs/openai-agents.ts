/**
 * Test stubs for OpenAI Agents plugin testing.
 *
 * These stubs mirror the pattern from @openai/agents-core/test/stubs.ts
 * and provide fake models and responses for testing without real API calls.
 */

import type {
  Model,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  AgentOutputItem,
} from '@openai/agents-core';
import { Usage } from '@openai/agents-core';
import * as protocol from '@openai/agents-core/types';

/**
 * A basic assistant message response.
 */
export function fakeModelMessage(text: string): protocol.AssistantMessageItem {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text,
        providerData: {
          annotations: [],
        },
      },
    ],
  };
}

/**
 * A function call response for tool invocation.
 */
export function fakeFunctionCall(
  toolName: string,
  args: Record<string, unknown>
): protocol.FunctionCallItem {
  return {
    id: `call_${Math.random().toString(36).slice(2)}`,
    type: 'function_call',
    name: toolName,
    callId: `call_${Math.random().toString(36).slice(2)}`,
    status: 'completed',
    arguments: JSON.stringify(args),
  };
}

/**
 * A handoff call response.
 */
export function fakeHandoffCall(
  toolName: string,
  args: Record<string, unknown> = {}
): protocol.FunctionCallItem {
  return fakeFunctionCall(toolName, args);
}

/**
 * Create a basic model response with a text message.
 */
export function textResponse(text: string): ModelResponse {
  return {
    output: [fakeModelMessage(text)],
    usage: new Usage(),
  };
}

/**
 * Create a model response with a tool call.
 */
export function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  followUpText?: string
): ModelResponse {
  const output: AgentOutputItem[] = [fakeFunctionCall(toolName, args)];
  if (followUpText) {
    output.push(fakeModelMessage(followUpText));
  }
  return {
    output,
    usage: new Usage(),
  };
}

/**
 * Create a model response with a handoff.
 */
export function handoffResponse(
  handoffToolName: string,
  args: Record<string, unknown> = {}
): ModelResponse {
  return {
    output: [fakeHandoffCall(handoffToolName, args)],
    usage: new Usage(),
  };
}

/**
 * A fake Model implementation that returns pre-programmed responses.
 *
 * Responses are consumed in order - each call to getResponse() returns
 * the next response from the queue.
 */
export class FakeModel implements Model {
  private responses: ModelResponse[];
  private callCount = 0;

  constructor(responses: ModelResponse[] = []) {
    this.responses = [...responses];
  }

  async getResponse(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses.shift();
    if (!response) {
      throw new Error(
        `FakeModel: No more responses available (called ${this.callCount + 1} times)`
      );
    }
    this.callCount++;
    return response;
  }

  async *getStreamedResponse(
    _request: ModelRequest
  ): AsyncIterable<protocol.StreamEvent> {
    throw new Error('Streaming not implemented in FakeModel');
  }
}

/**
 * A fake ModelProvider that returns FakeModel instances.
 *
 * NOTE: This provider maintains a single shared model instance to support
 * Temporal activity execution, where each activity call gets the model via getModel().
 * Without this, each activity would get a fresh model with reset responses.
 */
export class FakeModelProvider implements ModelProvider {
  private modelResponses: Map<string, ModelResponse[]> = new Map();
  private defaultResponses: ModelResponse[];
  private sharedModel: FakeModel | null = null;

  constructor(defaultResponses: ModelResponse[] = [textResponse('Hello World')]) {
    this.defaultResponses = defaultResponses;
  }

  /**
   * Set responses for a specific model name.
   */
  setModelResponses(modelName: string, responses: ModelResponse[]): void {
    this.modelResponses.set(modelName, responses);
  }

  async getModel(name?: string): Promise<Model> {
    // Return a shared model instance to maintain state across activity calls
    if (!this.sharedModel) {
      const responses = name
        ? this.modelResponses.get(name) ?? this.defaultResponses
        : this.defaultResponses;
      this.sharedModel = new FakeModel([...responses]);
    }
    return this.sharedModel;
  }
}

/**
 * Generator-based fake model for more complex test scenarios.
 *
 * Similar to the ai-sdk test pattern where responses are yielded from a generator.
 */
export class GeneratorFakeModel implements Model {
  private generator: Generator<ModelResponse>;
  private done = false;

  constructor(generator: Generator<ModelResponse>) {
    this.generator = generator;
  }

  async getResponse(_request: ModelRequest): Promise<ModelResponse> {
    if (this.done) {
      throw new Error('GeneratorFakeModel: Generator exhausted');
    }

    const result = this.generator.next();
    this.done = result.done ?? false;

    if (result.done && result.value === undefined) {
      throw new Error('GeneratorFakeModel: Generator exhausted');
    }

    return result.value;
  }

  async *getStreamedResponse(
    _request: ModelRequest
  ): AsyncIterable<protocol.StreamEvent> {
    throw new Error('Streaming not implemented in GeneratorFakeModel');
  }
}

/**
 * Generator-based fake model provider.
 *
 * NOTE: This provider maintains a single shared model instance to support
 * Temporal activity execution, where each activity call gets the model via getModel().
 * Without this, each activity would get a fresh generator starting from the beginning.
 */
export class GeneratorFakeModelProvider implements ModelProvider {
  private generatorFactory: () => Generator<ModelResponse>;
  private sharedModel: GeneratorFakeModel | null = null;

  constructor(generatorFactory: () => Generator<ModelResponse>) {
    this.generatorFactory = generatorFactory;
  }

  async getModel(_name?: string): Promise<Model> {
    // Return a shared model instance to maintain generator state across activity calls
    if (!this.sharedModel) {
      this.sharedModel = new GeneratorFakeModel(this.generatorFactory());
    }
    return this.sharedModel;
  }
}
