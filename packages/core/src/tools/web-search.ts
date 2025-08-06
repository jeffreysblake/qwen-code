/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GroundingMetadata } from '@google/genai';
import { BaseTool, Icon, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';

import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { AuthType } from '../core/contentGenerator.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
  // Other properties might exist if needed in the future
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string; // text is optional as per the example
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[]; // Optional as per example
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */

  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

/**
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name: string = 'google_web_search';

  constructor(private readonly config: Config) {
    super(
      WebSearchTool.Name,
      'GoogleSearch',
      'Performs a web search and returns results. Uses Google Search via Gemini API when available, or DuckDuckGo for other models. This tool is useful for finding information on the internet based on a query.',
      Icon.Globe,
      {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'The search query to find information on the web.',
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  validateParams(params: WebSearchToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  getDescription(params: WebSearchToolParams): string {
    return `Searching the web for: "${params.query}"`;
  }

  private async searchWithDuckDuckGo(
    params: WebSearchToolParams,
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    try {
      // First try the instant answers API for quick facts
      const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1&skip_disambig=1`;
      
      let searchResults = '';
      const sources: GroundingChunkItem[] = [];
      
      try {
        const instantResponse = await fetch(instantUrl, { signal });
        if (instantResponse.ok) {
          const instantData = await instantResponse.json();
          
          // Add instant answer if available
          if (instantData.AbstractText) {
            searchResults += `## Summary\n${instantData.AbstractText}\n\n`;
            if (instantData.AbstractURL) {
              sources.push({
                web: {
                  title: instantData.AbstractSource || 'Summary Source',
                  uri: instantData.AbstractURL
                }
              });
            }
          }
          
          if (instantData.Answer) {
            searchResults += `## Quick Answer\n${instantData.Answer}\n\n`;
          }
          
          if (instantData.Definition) {
            searchResults += `## Definition\n${instantData.Definition}\n\n`;
            if (instantData.DefinitionURL) {
              sources.push({
                web: {
                  title: 'Definition Source',
                  uri: instantData.DefinitionURL
                }
              });
            }
          }
        }
      } catch (instantError) {
        console.log('Instant answers failed, continuing with web scraping...');
      }
      
      // Now scrape actual search results from DuckDuckGo
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
      
      const response = await fetch(searchUrl, {
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      });
      
      if (!response.ok) {
        throw new Error(`DuckDuckGo search returned ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Parse search results from HTML
      const results = this.parseSearchResults(html);
      
      if (results.length > 0) {
        if (searchResults) {
          searchResults += `## Search Results\n`;
        } else {
          searchResults = `## Search Results\n`;
        }
        
        results.slice(0, 8).forEach((result: SearchResult, index: number) => {
          searchResults += `**${index + 1}. ${result.title}**\n`;
          if (result.snippet) {
            searchResults += `${result.snippet}\n`;
          }
          searchResults += `🔗 ${result.url}\n\n`;
          
          sources.push({
            web: {
              title: result.title,
              uri: result.url
            }
          });
        });
      }
      
      // If still no results, provide helpful guidance
      if (!searchResults.trim()) {
        const isNewsQuery = params.query.toLowerCase().includes('news') || params.query.toLowerCase().includes('latest');
        const isCurrentEventsQuery = params.query.toLowerCase().includes('recent') || params.query.toLowerCase().includes('today');
        
        if (isNewsQuery || isCurrentEventsQuery) {
          searchResults = `I wasn't able to find recent news results for "${params.query}". For current news and events, I recommend:\n\n`;
          searchResults += `**For AI News:**\n`;
          searchResults += `• TechCrunch AI: https://techcrunch.com/category/artificial-intelligence/\n`;
          searchResults += `• The Verge AI: https://www.theverge.com/ai-artificial-intelligence\n`;
          searchResults += `• MIT Technology Review: https://www.technologyreview.com/topic/artificial-intelligence/\n`;
          searchResults += `• VentureBeat AI: https://venturebeat.com/ai/\n\n`;
          searchResults += `**General Search:**\n`;
          searchResults += `• DuckDuckGo: https://duckduckgo.com/?q=${encodeURIComponent(params.query)}\n`;
          searchResults += `• Google News: https://news.google.com/search?q=${encodeURIComponent(params.query)}`;
        } else {
          searchResults = `No search results found for "${params.query}". This might be because:\n\n`;
          searchResults += `• The query is too specific or contains typos\n`;
          searchResults += `• Try different keywords or a broader search term\n\n`;
          searchResults += `**Try searching manually:**\n`;
          searchResults += `• DuckDuckGo: https://duckduckgo.com/?q=${encodeURIComponent(params.query)}\n`;
          searchResults += `• Or try a different query with me`;
        }
      }
      
      // Add sources section
      if (sources.length > 0) {
        searchResults += `\n\nSources:\n`;
        sources.forEach((source, index) => {
          searchResults += `[${index + 1}] ${source.web?.title} (${source.web?.uri})\n`;
        });
      }
      
      return {
        llmContent: `Web search results for "${params.query}" (via DuckDuckGo):\n\n${searchResults}`,
        returnDisplay: `Search results for "${params.query}" returned via DuckDuckGo.`,
        sources,
      };
      
    } catch (error: unknown) {
      const errorMessage = `DuckDuckGo search failed for "${params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      
      return {
        llmContent: `Search failed. You can try searching manually: https://duckduckgo.com/?q=${encodeURIComponent(params.query)}\n\nError: ${errorMessage}`,
        returnDisplay: 'Search failed - manual search suggested',
      };
    }
  }

  private parseSearchResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];
    
    // DuckDuckGo HTML search results pattern
    // Look for result containers
    const resultPattern = /<div class="result(?:__body|s_links_deep).*?">[\s\S]*?<\/div>/g;
    const titlePattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/;
    
    // Alternative patterns for different DuckDuckGo layouts
    const altTitlePattern = /<h2[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/;
    const altSnippetPattern = /<span[^>]*class="[^"]*snippet[^"]*"[^>]*>(.*?)<\/span>/;
    
    let match;
    let attempts = 0;
    const maxAttempts = 20; // Prevent infinite loops
    
    // Try to extract results using regex patterns
    while ((match = resultPattern.exec(html)) !== null && attempts < maxAttempts) {
      attempts++;
      const resultHtml = match[0];
      
      // Extract title and URL
      let titleMatch = titlePattern.exec(resultHtml) || altTitlePattern.exec(resultHtml);
      if (titleMatch) {
        let url = titleMatch[1];
        let title = titleMatch[2];
        
        // Clean up the title by removing HTML tags
        title = title.replace(/<[^>]*>/g, '').trim();
        
        // Clean up URL (DuckDuckGo sometimes uses redirect URLs)
        if (url.startsWith('/l/?uddg=')) {
          // Extract the actual URL from DuckDuckGo's redirect
          const urlMatch = url.match(/uddg=([^&]+)/);
          if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
          }
        }
        
        // Skip if URL is relative or invalid
        if (!url.startsWith('http')) {
          continue;
        }
        
        // Extract snippet
        let snippet = '';
        const snippetMatch = snippetPattern.exec(resultHtml) || altSnippetPattern.exec(resultHtml);
        if (snippetMatch) {
          snippet = snippetMatch[1].replace(/<[^>]*>/g, '').trim();
        }
        
        results.push({
          title,
          url,
          snippet: snippet || undefined
        });
      }
    }
    
    // If regex didn't work well, try a simpler approach
    if (results.length < 3) {
      // Look for any links that seem like search results
      const linkPattern = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
      const foundUrls = new Set<string>();
      
      while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
        const url = match[1];
        const title = match[2].trim();
        
        // Skip DuckDuckGo internal links and duplicates
        if (foundUrls.has(url) || 
            url.includes('duckduckgo.com') || 
            url.includes('duck.co') ||
            title.length < 10) {
          continue;
        }
        
        foundUrls.add(url);
        results.push({
          title,
          url
        });
      }
    }
    
    return results;
  }

  async execute(
    params: WebSearchToolParams,
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    // Check if we're using a non-Gemini model (OpenAI/LMStudio)
    const contentGeneratorConfig = this.config.getContentGeneratorConfig();
    const isOpenAIModel = contentGeneratorConfig?.authType === AuthType.USE_OPENAI;
    
    if (isOpenAIModel) {
      return this.searchWithDuckDuckGo(params, signal);
    }

    const geminiClient = this.config.getGeminiClient();

    try {
      const response = await geminiClient.generateContent(
        [{ role: 'user', parts: [{ text: params.query }] }],
        { tools: [{ googleSearch: {} }] },
        signal,
      );

      const responseText = getResponseText(response);
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      if (!responseText || !responseText.trim()) {
        return {
          llmContent: `No search results or information found for query: "${params.query}"`,
          returnDisplay: 'No information found.',
        };
      }

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
                marker: citationMarker,
              });
            }
          });

          // Sort insertions by index in descending order to avoid shifting subsequent indices
          insertions.sort((a, b) => b.index - a.index);

          const responseChars = modifiedResponseText.split(''); // Use new variable
          insertions.forEach((insertion) => {
            // Fixed arrow function syntax
            responseChars.splice(insertion.index, 0, insertion.marker);
          });
          modifiedResponseText = responseChars.join(''); // Assign back to modifiedResponseText
        }

        if (sourceListFormatted.length > 0) {
          modifiedResponseText +=
            '\n\nSources:\n' + sourceListFormatted.join('\n'); // Fixed string concatenation
        }
      }

      return {
        llmContent: `Web search results for "${params.query}":\n\n${modifiedResponseText}`,
        returnDisplay: `Search results for "${params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
      };
    }
  }
}
