/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  parseAndFormatApiError,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
} from '@qwen-code/qwen-code-core';
import { Content, Part, FunctionCall } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();

    const abortController = new AbortController();
    // let currentMessages: Content[] = [
    //   { role: 'user', parts: [{ text: input }] },
    // ];
    let currentRequest = [{ text: input }]; // Start with the initial input
    let turnCount = 0;
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const functionCalls: FunctionCall[] = [];

      // Use GeminiClient's sendMessageStream which includes loop detection
      const responseStream = geminiClient.sendMessageStream(
        // currentMessages[0]?.parts || [],
        currentRequest,
        abortController.signal,
        prompt_id,
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        // if (event.type === GeminiEventType.Content) {
        //   process.stdout.write(event.value);
        // } else if (event.type === GeminiEventType.ToolCallRequest) {
        //   const toolCallRequest = event.value;
        //   const fc: FunctionCall = {
        //     name: toolCallRequest.name,
        //     args: toolCallRequest.args,
        //     id: toolCallRequest.callId,
        //   };
        //   functionCalls.push(fc);
        // Handle different event types from the GeminiClient stream
        switch (event.type) {
          case ServerGeminiEventType.Content:
            process.stdout.write(event.value);
            // Unconditional debug: Always log content to check loop detection
            console.error(`[LOOP DEBUG CLI] Content: "${event.value.substring(0, 100)}${event.value.length > 100 ? '...' : ''}"`);
            
            // Debug: Log content to check loop detection
            if (config.getDebugMode()) {
              console.error(`[DEBUG] Content chunk: "${event.value.substring(0, 50)}${event.value.length > 50 ? '...' : ''}"`);
            }
            break;
          case ServerGeminiEventType.ToolCallRequest:
            functionCalls.push({
              id: event.value.callId,
              name: event.value.name,
              args: event.value.args,
            } as FunctionCall);
            break;
          case ServerGeminiEventType.LoopDetected:
            console.error('\n🔄 Loop detected! The model appears to be repeating itself. Stopping to prevent infinite loops.');
            console.error('\nLoop Recovery Tips:');
            console.error('• Try rephrasing your request with more specific instructions');
            console.error('• Break down complex tasks into smaller, more specific steps');
            console.error('• Provide additional context or constraints');
            console.error('• Consider using a different approach to solve the problem');
            return;
          case ServerGeminiEventType.MaxSessionTurns:
            console.error('\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.');
            return;
          case ServerGeminiEventType.SessionTokenLimitExceeded:
            console.error('\n Session token limit exceeded. Please start a new session or increase the sessionTokenLimit in settings.json.');
            return;
          case ServerGeminiEventType.UserCancelled:
            console.error('Operation cancelled.');
            return;
          case ServerGeminiEventType.Error:
            console.error(`\nError: ${event.value.error.message}`);
            return;
          case ServerGeminiEventType.Finished:
            // Continue processing - this just indicates the current response is complete
            break;
          default:
            // Ignore other event types (Thought, ChatCompressed, etc.)
            break;
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
          }
        }
        //currentMessages = [{ role: 'user', parts: toolResponseParts }];
        // Set the next request to be the tool responses
        currentRequest = toolResponseParts.filter((part): part is { text: string } => 
          typeof part.text === 'string' && part.text.length > 0
        );
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    process.exit(1);
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
