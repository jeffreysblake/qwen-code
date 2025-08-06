/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { GeminiEventType, ServerGeminiStreamEvent } from '../core/turn.js';
import { logLoopDetected } from '../telemetry/loggers.js';
import { LoopDetectedEvent, LoopType } from '../telemetry/types.js';
import { Config, DEFAULT_GEMINI_FLASH_MODEL } from '../config/config.js';
import { SchemaUnion, Type } from '@google/genai';

const TOOL_CALL_LOOP_THRESHOLD = 5;
const CONTENT_LOOP_THRESHOLD = 2; // Further reduced from 3 to 2 for immediate detection
const CONTENT_CHUNK_SIZE = 10; // Further reduced from 20 to 10 for faster detection
const MAX_HISTORY_LENGTH = 1000;

/**
 * The number of recent conversation turns to include in the history when asking the LLM to check for a loop.
 */
const LLM_LOOP_CHECK_HISTORY_COUNT = 20;

/**
 * The number of turns that must pass in a single prompt before the LLM-based loop check is activated.
 */
const LLM_CHECK_AFTER_TURNS = 30;

/**
 * The default interval, in number of turns, at which the LLM-based loop check is performed.
 * This value is adjusted dynamically based on the LLM's confidence.
 */
const DEFAULT_LLM_CHECK_INTERVAL = 3;

/**
 * The minimum interval for LLM-based loop checks.
 * This is used when the confidence of a loop is high, to check more frequently.
 */
const MIN_LLM_CHECK_INTERVAL = 5;

/**
 * The maximum interval for LLM-based loop checks.
 * This is used when the confidence of a loop is low, to check less frequently.
 */
const MAX_LLM_CHECK_INTERVAL = 15;

/**
 * Service for detecting and preventing infinite loops in AI responses.
 * Monitors tool call repetitions and content sentence repetitions.
 */
export class LoopDetectionService {
  private readonly config: Config;
  private promptId = '';

  // Tool call tracking
  private lastToolCallKey: string | null = null;
  private toolCallRepetitionCount: number = 0;

  // Content streaming tracking
  private streamContentHistory = '';
  private contentStats = new Map<string, number[]>();
  private lastContentIndex = 0;
  private loopDetected = false;
  private inCodeBlock = false;

  // LLM loop track tracking
  private turnsInCurrentPrompt = 0;
  private llmCheckInterval = DEFAULT_LLM_CHECK_INTERVAL;
  private lastCheckTurn = 0;

  // Loop recovery tracking
  private loopRecoveryAttempts = 0;
  private readonly MAX_RECOVERY_ATTEMPTS = 2;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Gets the current number of recovery attempts
   */
  get recoveryAttempts(): number {
    return this.loopRecoveryAttempts;
  }

  private getToolCallKey(toolCall: { name: string; args: object }): string {
    const argsString = JSON.stringify(toolCall.args);
    const keyString = `${toolCall.name}:${argsString}`;
    return createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * Processes a stream event and checks for loop conditions.
   * @param event - The stream event to process
   * @returns true if a loop is detected, false otherwise
   */
  addAndCheck(event: ServerGeminiStreamEvent): boolean {
    if (this.loopDetected) {
      return true;
    }

    switch (event.type) {
      case GeminiEventType.ToolCallRequest:
        // content chanting only happens in one single stream, reset if there
        // is a tool call in between
        this.resetContentTracking();
        this.loopDetected = this.checkToolCallLoop(event.value);
        break;
      case GeminiEventType.ToolCallResponse:
        // Tool responses should not trigger loop detection as they are external data
        // Reset content tracking since tool responses break content flow
        this.resetContentTracking();
        console.log(`[Tool Response] ${event.value.callId}: Output length ${JSON.stringify(event.value.responseParts).length} chars`);
        break;
      case GeminiEventType.Content:
        console.error(`[LOOP DEBUG] Processing content event: "${event.value.substring(0, 50)}${event.value.length > 50 ? '...' : ''}"`);
        this.loopDetected = this.checkContentLoop(event.value);
        if (this.loopDetected) {
          console.error(`[LOOP DEBUG] LOOP DETECTED! Returning true`);
        }
        break;
      default:
        break;
    }
    return this.loopDetected;
  }

  /**
   * Signals the start of a new turn in the conversation.
   *
   * This method increments the turn counter and, if specific conditions are met,
   * triggers an LLM-based check to detect potential conversation loops. The check
   * is performed periodically based on the `llmCheckInterval`.
   *
   * @param signal - An AbortSignal to allow for cancellation of the asynchronous LLM check.
   * @returns A promise that resolves to `true` if a loop is detected, and `false` otherwise.
   */
  async turnStarted(signal: AbortSignal) {
    this.turnsInCurrentPrompt++;

    if (
      this.turnsInCurrentPrompt >= LLM_CHECK_AFTER_TURNS &&
      this.turnsInCurrentPrompt - this.lastCheckTurn >= this.llmCheckInterval
    ) {
      this.lastCheckTurn = this.turnsInCurrentPrompt;
      return await this.checkForLoopWithLLM(signal);
    }

    return false;
  }

  private checkToolCallLoop(toolCall: { name: string; args: object }): boolean {
    const key = this.getToolCallKey(toolCall);
    if (this.lastToolCallKey === key) {
      this.toolCallRepetitionCount++;
    } else {
      this.lastToolCallKey = key;
      this.toolCallRepetitionCount = 1;
    }
    if (this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD) {
      logLoopDetected(
        this.config,
        new LoopDetectedEvent(
          LoopType.CONSECUTIVE_IDENTICAL_TOOL_CALLS,
          this.promptId,
        ),
      );
      return true;
    }
    return false;
  }

  /**
   * Detects content loops by analyzing streaming text for repetitive patterns.
   *
   * The algorithm works by:

  private checkContentLoop(content: string): boolean {
    // Code blocks can often contain repetitive syntax that is not indicative of a loop.
    // To avoid false positives, we detect when we are inside a code block and
    // temporarily disable loop detection.
    const numFences = (content.match(/```/g) ?? []).length;
    if (numFences) {
      // Reset tracking when a code fence is detected to avoid analyzing content
      // that spans across code block boundaries.
      this.resetContentTracking();
    }

    const wasInCodeBlock = this.inCodeBlock;
    this.inCodeBlock =
      numFences % 2 === 0 ? this.inCodeBlock : !this.inCodeBlock;
    if (wasInCodeBlock) {
      return false;
    }

    this.streamContentHistory += content;

    // Debug: Log when we accumulate significant repetitive content
    if (this.streamContentHistory.length > 100) {
      const recentHistory = this.streamContentHistory.slice(-100);
      if (/(\*\*")+/.test(recentHistory) && recentHistory.match(/(\*\*")+/g)?.some(match => match.length > 30)) {
        console.error(`[LOOP DEBUG] Large repetitive pattern in history: "${recentHistory}"`);
      }
    }

    this.truncateAndUpdate();
    return this.analyzeContentChunksForLoop();
  }

  /**
   * Quick check for obvious repetitive patterns like **"**"**" or similar
   */
  private hasObviousRepetition(content: string): boolean {
    // Check both the new content and the recent accumulated history
    const textsToCheck = [content];
    
    // Also check the last 200 characters of accumulated history for patterns
    if (this.streamContentHistory.length > 0) {
      const recentHistory = this.streamContentHistory.slice(-200);
      textsToCheck.push(recentHistory);
      // Check the combined recent history + new content
      textsToCheck.push(recentHistory + content);
    }

    for (const text of textsToCheck) {
      // Check for patterns like **"**"**" (quote repetition) - very aggressive
      const quotePattern = /(\*\*")+/g;
      const quoteMatches = text.match(quotePattern);
      if (quoteMatches && quoteMatches.some(match => match.length > 5)) {
        console.error(`[LOOP DEBUG] Quote pattern detected: ${quoteMatches.join(', ')}`);
        return true;
      }

      // Check for any single character repeated many times (excluding normal punctuation)
      const charRepeatPattern = /([^#\-*_=\s])\1{8,}/g; // Exclude markdown chars
      const charMatches = text.match(charRepeatPattern);
      if (charMatches) {
        console.error(`[LOOP DEBUG] Character repetition detected: ${charMatches.join(', ')}`);
        return true;
      }

      // Check for short patterns repeated multiple times - exclude common markdown
      const shortPatterns = text.match(/(.{1,6})\1{3,}/g); // Increased threshold back to 3+
      if (shortPatterns) {
        // Filter out common markdown patterns
        const suspiciousPatterns = shortPatterns.filter(pattern => {
          const basePattern = pattern.match(/^(.+?)\1+$/)?.[1] || '';
          // Skip common markdown: ###, ---, ***, ===, etc.
          return !/^[#\-*_=\s]+$/.test(basePattern);
        });
        if (suspiciousPatterns.length > 0) {
          console.error(`[LOOP DEBUG] Short pattern repetition detected: ${suspiciousPatterns.join(', ')}`);
          return true;
        }
      }

      // Specific check for the exact pattern we're seeing: **"**"**"
      const specificPattern = /(\*\*"(\*\*)?){2,}/g;
      if (specificPattern.test(text)) {
        console.error(`[LOOP DEBUG] Specific **" pattern detected in: "${text.substring(0, 100)}"`);
        return true;
      }

      // Check for quote-heavy content that looks suspicious
      const quoteCount = (text.match(/"/g) || []).length;
      const starCount = (text.match(/\*/g) || []).length;
      if (text.length > 20 && quoteCount > text.length * 0.3 && starCount > text.length * 0.3) {
        console.error(`[LOOP DEBUG] Suspicious quote/star density: quotes=${quoteCount}, stars=${starCount}, length=${text.length}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Truncates the content history to prevent unbounded memory growth.
   * When truncating, adjusts all stored indices to maintain their relative positions.
   */
  private truncateAndUpdate(): void {
    if (this.streamContentHistory.length <= MAX_HISTORY_LENGTH) {
      return;
    }

    // Calculate how much content to remove from the beginning
    const truncationAmount =
      this.streamContentHistory.length - MAX_HISTORY_LENGTH;
    this.streamContentHistory =
      this.streamContentHistory.slice(truncationAmount);
    this.lastContentIndex = Math.max(
      0,
      this.lastContentIndex - truncationAmount,
    );

    // Update all stored chunk indices to account for the truncation
    for (const [hash, oldIndices] of this.contentStats.entries()) {
      const adjustedIndices = oldIndices
        .map((index) => index - truncationAmount)
        .filter((index) => index >= 0);

      if (adjustedIndices.length > 0) {
        this.contentStats.set(hash, adjustedIndices);
      } else {
        this.contentStats.delete(hash);
      }
    }
  }

  /**
   * Analyzes content in fixed-size chunks to detect repetitive patterns.
   *
   * Uses a sliding window approach:
   * 1. Extract chunks of fixed size (CONTENT_CHUNK_SIZE)
   * 2. Hash each chunk for efficient comparison
   * 3. Track positions where identical chunks appear
   * 4. Detect loops when chunks repeat frequently within a short distance
   */
  private analyzeContentChunksForLoop(): boolean {
    while (this.hasMoreChunksToProcess()) {
      // Extract current chunk of text
      const currentChunk = this.streamContentHistory.substring(
        this.lastContentIndex,
        this.lastContentIndex + CONTENT_CHUNK_SIZE,
      );
      const chunkHash = createHash('sha256').update(currentChunk).digest('hex');

      if (this.isLoopDetectedForChunk(currentChunk, chunkHash)) {
        logLoopDetected(
          this.config,
          new LoopDetectedEvent(
            LoopType.CHANTING_IDENTICAL_SENTENCES,
            this.promptId,
          ),
        );
        return true;
      }

      // Move to next position in the sliding window
      this.lastContentIndex++;
    }

    return false;
  }

  private hasMoreChunksToProcess(): boolean {
    return (
      this.lastContentIndex + CONTENT_CHUNK_SIZE <=
      this.streamContentHistory.length
    );
  }

  /**
   * Determines if a content chunk indicates a loop pattern.
   *
   * Loop detection logic:
   * 1. Check if we've seen this hash before (new chunks are stored for future comparison)
   * 2. Verify actual content matches to prevent hash collisions
   * 3. Track all positions where this chunk appears
   * 4. A loop is detected when the same chunk appears CONTENT_LOOP_THRESHOLD times
   *    within a small average distance (≤ 1.5 * chunk size)
   */
  private isLoopDetectedForChunk(chunk: string, hash: string): boolean {
    const existingIndices = this.contentStats.get(hash);

    if (!existingIndices) {
      this.contentStats.set(hash, [this.lastContentIndex]);
      return false;
    }

    if (!this.isActualContentMatch(chunk, existingIndices[0])) {
      return false;
    }

    existingIndices.push(this.lastContentIndex);

    if (existingIndices.length < CONTENT_LOOP_THRESHOLD) {
      return false;
    }

    // Analyze the most recent occurrences to see if they're clustered closely together
    const recentIndices = existingIndices.slice(-CONTENT_LOOP_THRESHOLD);
    const totalDistance =
      recentIndices[recentIndices.length - 1] - recentIndices[0];
    const averageDistance = totalDistance / (CONTENT_LOOP_THRESHOLD - 1);
    const maxAllowedDistance = CONTENT_CHUNK_SIZE * 1.5;

    return averageDistance <= maxAllowedDistance;
  }

  /**
   * Verifies that two chunks with the same hash actually contain identical content.
   * This prevents false positives from hash collisions.
   */
  private isActualContentMatch(
    currentChunk: string,
    originalIndex: number,
  ): boolean {
    const originalChunk = this.streamContentHistory.substring(
      originalIndex,
      originalIndex + CONTENT_CHUNK_SIZE,
    );
    return originalChunk === currentChunk;
  }

  private async checkForLoopWithLLM(signal: AbortSignal) {
    const recentHistory = this.config
      .getGeminiClient()
      .getHistory()
      .slice(-LLM_LOOP_CHECK_HISTORY_COUNT);

    const prompt = `You are a sophisticated AI diagnostic agent specializing in identifying when a conversational AI is stuck in an unproductive state. Your task is to analyze the provided conversation history and determine if the assistant has ceased to make meaningful progress.

An unproductive state is characterized by one or more of the following patterns over the last 5 or more assistant turns:

Repetitive Actions: The assistant repeats the same tool calls or conversational responses a decent number of times. This includes simple loops (e.g., tool_A, tool_A, tool_A) and alternating patterns (e.g., tool_A, tool_B, tool_A, tool_B, ...).

Cognitive Loop: The assistant seems unable to determine the next logical step. It might express confusion, repeatedly ask the same questions, or generate responses that don't logically follow from the previous turns, indicating it's stuck and not advancing the task.

Crucially, differentiate between a true unproductive state and legitimate, incremental progress.
For example, a series of 'tool_A' or 'tool_B' tool calls that make small, distinct changes to the same file (like adding docstrings to functions one by one) is considered forward progress and is NOT a loop. A loop would be repeatedly replacing the same text with the same content, or cycling between a small set of files with no net change.

Please analyze the conversation history to determine the possibility that the conversation is stuck in a repetitive, non-productive state.`;
    const contents = [
      ...recentHistory,
      { role: 'user', parts: [{ text: prompt }] },
    ];
    const schema: SchemaUnion = {
      type: Type.OBJECT,
      properties: {
        reasoning: {
          type: Type.STRING,
          description:
            'Your reasoning on if the conversation is looping without forward progress.',
        },
        confidence: {
          type: Type.NUMBER,
          description:
            'A number between 0.0 and 1.0 representing your confidence that the conversation is in an unproductive state.',
        },
      },
      required: ['reasoning', 'confidence'],
    };
    let result;
    try {
      result = await this.config
        .getGeminiClient()
        .generateJson(contents, schema, signal, DEFAULT_GEMINI_FLASH_MODEL);
    } catch (e) {
      // Do nothing, treat it as a non-loop.
      this.config.getDebugMode() ? console.error(e) : console.debug(e);
      return false;
    }

    if (typeof result.confidence === 'number') {
      if (result.confidence > 0.9) {
        if (typeof result.reasoning === 'string' && result.reasoning) {
          console.warn(result.reasoning);
        }
        logLoopDetected(
          this.config,
          new LoopDetectedEvent(LoopType.LLM_DETECTED_LOOP, this.promptId),
        );
        return true;
      } else {
        this.llmCheckInterval = Math.round(
          MIN_LLM_CHECK_INTERVAL +
            (MAX_LLM_CHECK_INTERVAL - MIN_LLM_CHECK_INTERVAL) *
              (1 - result.confidence),
        );
      }
    }
    return false;
  }

  /**
   * Resets all loop detection state.
   */
  reset(promptId: string): void {
    console.error(`[LOOP DEBUG] Resetting loop detector for prompt: ${promptId}`);
    this.promptId = promptId;
    this.resetToolCallCount();
    this.resetContentTracking();
    this.resetLlmCheckTracking();
    this.loopDetected = false;
    this.loopRecoveryAttempts = 0; // Reset recovery attempts for new prompt
  }

  private resetToolCallCount(): void {
    this.lastToolCallKey = null;
    this.toolCallRepetitionCount = 0;
  }

  /**
   * Public method to reset content tracking for recovery attempts
   */
  resetContentTracking(resetHistory = true): void {
    if (resetHistory) {
      this.streamContentHistory = '';
    }
    this.contentStats.clear();
    this.lastContentIndex = 0;
  }

  private resetLlmCheckTracking(): void {
    this.turnsInCurrentPrompt = 0;
    this.llmCheckInterval = DEFAULT_LLM_CHECK_INTERVAL;
    this.lastCheckTurn = 0;
  }

  /**
   * Gets suggested recovery prompts based on the type of loop detected
   */
  getLoopRecoveryPrompts(): string[] {
    const basePrompts = [
      "Let me take a step back and approach this differently. What specific aspect should I focus on first?",
      "I notice I might be repeating myself. Can you provide more specific guidance on what you'd like me to do differently?",
      "Let me break this down into smaller, more manageable steps. What's the most important part to address first?",
    ];

    const toolCallPrompts = [
      "I seem to be stuck in a loop with tool calls. Let me try a different approach to this problem.",
      "Instead of repeating the same operations, let me analyze what we've learned so far and adjust my strategy.",
    ];

    const contentPrompts = [
      "I notice I'm generating repetitive content. Let me refocus on providing more specific and actionable information.",
      "Let me restructure my response to be more targeted and avoid repetition.",
    ];

    // Return different prompts based on what type of loop was detected
    if (this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD) {
      return [...basePrompts, ...toolCallPrompts];
    } else {
      return [...basePrompts, ...contentPrompts];
    }
  }

  /**
   * Gets an automatic recovery prompt that can be injected to break the loop
   */
  getAutoRecoveryPrompt(): string {
    const recoveryPrompts = [
      "I notice I'm in a repetitive pattern. Let me step back and approach this task from a different angle. What would be the most effective way to make progress on your original request?",
      "I'm detecting that I may be stuck in a loop. Let me refocus on your core objective and try a more targeted approach. Can you help me understand what specific outcome you're looking for?",
      "I seem to be repeating myself without making meaningful progress. Let me take a different approach and break this down into smaller, more manageable steps. What's the most important aspect to address first?",
    ];

    // Cycle through different recovery prompts to avoid getting stuck in recovery loops
    return recoveryPrompts[this.loopRecoveryAttempts % recoveryPrompts.length];
  }

  /**
   * Suggests context compression when loops are detected due to conversation length
   */
  shouldCompressContext(): boolean {
    // Suggest compression if we've had multiple recovery attempts
    // or if the conversation history is getting very long
    return this.loopRecoveryAttempts >= 1 || this.turnsInCurrentPrompt > 50;
  }

  /**
   * Gets a compression prompt that summarizes the conversation for continuation
   */
  getContextCompressionPrompt(): string {
    return `I notice this conversation has become quite long and I may be losing track of the main objectives. Let me summarize what we've accomplished so far and refocus on the remaining goals:

**Summary of Progress:**
- [Previous accomplishments will be summarized here]

**Current Objective:**
- [Main goal will be restated here]

**Next Steps:**
- [Specific actionable steps will be outlined here]

Please confirm if this summary is accurate and let me know what specific aspect you'd like me to focus on next.`;
  }

  /**
   * Attempts automatic recovery by suggesting the model take a different approach
   */
  shouldAttemptAutoRecovery(): boolean {
    return this.loopRecoveryAttempts < this.MAX_RECOVERY_ATTEMPTS;
  }

  /**
   * Marks that a recovery attempt has been made
   */
  recordRecoveryAttempt(): void {
    this.loopRecoveryAttempts++;
  }
}
