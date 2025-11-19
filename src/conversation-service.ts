import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ConversationContext {
  conversationId: string;
  messages: ConversationMessage[];
  summarizedMessages?: ConversationMessage[];
  createdAt: string;
  lastAccessedAt: string;
}

/**
 * Service for managing conversation context in Redis
 * Stores conversation history with automatic summarization when context window is too large
 */
export class ConversationService {
  private redis: Redis;
  private readonly TTL = 3600; // 1 hour in seconds
  private readonly LAST_CONVERSATION_KEY = 'cursor:last_conversation_id';

  private redisAvailable: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379/0';
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying after 3 attempts
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true, // Don't connect immediately
      enableOfflineQueue: false, // Don't queue commands when offline
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error', { error: error.message });
      this.redisAvailable = false;
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected for conversation storage');
      this.redisAvailable = true;
    });

    // Try to connect, but don't fail if it doesn't work
    this.redis.connect().catch((error) => {
      logger.warn('Redis connection failed, conversation context will not be persisted', {
        error: error.message,
      });
      this.redisAvailable = false;
    });
  }

  /**
   * Get or create a conversation ID
   * Conversation IDs are always created internally by cursor-runner (never by external services)
   * If no conversationId is provided, returns the last conversation ID
   * If no last conversation exists, creates a new one automatically
   */
  async getConversationId(conversationId?: string): Promise<string> {
    if (!this.redisAvailable) {
      // If Redis is not available, generate a new ID each time
      // This means context won't persist, but the system will still work
      return conversationId || randomUUID();
    }

    try {
      if (conversationId) {
        // Update last accessed time
        await this.updateLastAccessed(conversationId);
        return conversationId;
      }

      // Get last conversation ID (most recently used conversation)
      const lastId = await this.redis.get(this.LAST_CONVERSATION_KEY);
      if (lastId) {
        await this.updateLastAccessed(lastId);
        return lastId;
      }

      // Create new conversation if none exists
      const newId = randomUUID();
      await this.redis.set(this.LAST_CONVERSATION_KEY, newId);
      await this.createConversation(newId);
      return newId;
    } catch (error) {
      logger.warn('Redis operation failed, using new conversation ID', {
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      return conversationId || randomUUID();
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(conversationId: string): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }

    try {
      const context: ConversationContext = {
        conversationId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };

      await this.redis.setex(
        `cursor:conversation:${conversationId}`,
        this.TTL,
        JSON.stringify(context)
      );

      // Update last conversation ID
      await this.redis.set(this.LAST_CONVERSATION_KEY, conversationId);

      logger.info('Created new conversation', { conversationId });
    } catch (error) {
      logger.warn('Failed to create conversation in Redis', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Force create a new conversation (clears the last conversation ID)
   * This is useful when you want to explicitly start a fresh conversation
   */
  async forceNewConversation(): Promise<string> {
    const newId = randomUUID();

    if (!this.redisAvailable) {
      return newId;
    }

    try {
      await this.redis.set(this.LAST_CONVERSATION_KEY, newId);
      await this.createConversation(newId);
      logger.info('Forced new conversation creation', { conversationId: newId });
      return newId;
    } catch (error) {
      logger.warn('Failed to force new conversation in Redis, returning new ID anyway', {
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      return newId;
    }
  }

  /**
   * Add a message to the conversation (excluding review agent messages)
   *
   * IMPORTANT: Only stores the individual message content, NOT the full context.
   * The full context is built dynamically from all stored messages when needed.
   * This prevents duplicating the entire context window with each iteration.
   */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    isReviewAgent: boolean = false
  ): Promise<void> {
    if (isReviewAgent) {
      // Don't store review agent messages
      return;
    }

    if (!this.redisAvailable) {
      // If Redis is not available, silently skip storing
      return;
    }

    try {
      const message: ConversationMessage = {
        role,
        content,
        timestamp: new Date().toISOString(),
      };

      const context = await this.getConversation(conversationId);
      context.messages.push(message);
      context.lastAccessedAt = new Date().toISOString();

      await this.saveConversation(conversationId, context);
    } catch (error) {
      logger.warn('Failed to add message to conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Get conversation context (returns summarized if available, otherwise raw)
   */
  async getConversationContext(conversationId: string): Promise<ConversationMessage[]> {
    if (!this.redisAvailable) {
      return [];
    }

    try {
      const context = await this.getConversation(conversationId);

      // Use summarized messages if available, otherwise use raw messages
      return context.summarizedMessages || context.messages;
    } catch (error) {
      logger.warn('Failed to get conversation context', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      return [];
    }
  }

  /**
   * Get raw conversation messages (for summarization)
   */
  async getRawConversation(conversationId: string): Promise<ConversationMessage[]> {
    if (!this.redisAvailable) {
      return [];
    }

    try {
      const context = await this.getConversation(conversationId);
      return context.messages;
    } catch (error) {
      logger.warn('Failed to get raw conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      return [];
    }
  }

  /**
   * Summarize conversation context when it's too large
   * This should be called when cursor complains about context window
   */
  async summarizeConversation(
    conversationId: string,
    summarizeFunction: (messages: ConversationMessage[]) => Promise<string>
  ): Promise<void> {
    if (!this.redisAvailable) {
      logger.warn('Cannot summarize conversation, Redis not available', { conversationId });
      return;
    }

    try {
      const context = await this.getConversation(conversationId);

      // Get messages to summarize (use summarized if available, otherwise raw)
      const messagesToSummarize = context.summarizedMessages || context.messages;

      // Summarize to 1/3 of original size
      const summary = await summarizeFunction(messagesToSummarize);

      // Create a new summarized message from the summary
      const summarizedMessage: ConversationMessage = {
        role: 'assistant',
        content: `[Conversation Summary] ${summary}`,
        timestamp: new Date().toISOString(),
      };

      // Keep the most recent messages (last 3) and add summary
      const recentMessages = messagesToSummarize.slice(-3);
      context.summarizedMessages = [summarizedMessage, ...recentMessages];
      context.lastAccessedAt = new Date().toISOString();

      await this.saveConversation(conversationId, context);

      logger.info('Conversation summarized', {
        conversationId,
        originalCount: messagesToSummarize.length,
        summarizedCount: context.summarizedMessages.length,
      });
    } catch (error) {
      logger.warn('Failed to summarize conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Build context string from conversation messages for cursor prompt
   * Prefixes messages with "user:" or "cursor:" to indicate sender
   */
  buildContextString(messages: ConversationMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    return messages
      .map((msg) => {
        const prefix = msg.role === 'user' ? 'user:' : 'cursor:';
        return `${prefix} ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * Check if context window error occurred
   */
  isContextWindowError(output: string): boolean {
    const errorPatterns = [
      /context.*window.*too.*large/i,
      /context.*length.*exceeded/i,
      /token.*limit.*exceeded/i,
      /maximum.*context.*length/i,
      /context.*too.*long/i,
    ];

    return errorPatterns.some((pattern) => pattern.test(output));
  }

  /**
   * Get conversation from Redis
   */
  private async getConversation(conversationId: string): Promise<ConversationContext> {
    if (!this.redisAvailable) {
      // Return empty context if Redis is not available
      return {
        conversationId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };
    }

    try {
      const data = await this.redis.get(`cursor:conversation:${conversationId}`);

      if (!data) {
        // Create new conversation if it doesn't exist
        await this.createConversation(conversationId);
        return this.getConversation(conversationId);
      }

      return JSON.parse(data) as ConversationContext;
    } catch (error) {
      logger.warn('Failed to get conversation from Redis', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      // Return empty context
      return {
        conversationId,
        messages: [],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Save conversation to Redis
   */
  private async saveConversation(
    conversationId: string,
    context: ConversationContext
  ): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }

    try {
      await this.redis.setex(
        `cursor:conversation:${conversationId}`,
        this.TTL,
        JSON.stringify(context)
      );
    } catch (error) {
      logger.warn('Failed to save conversation to Redis', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Update last accessed time
   */
  private async updateLastAccessed(conversationId: string): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }

    try {
      const context = await this.getConversation(conversationId);
      context.lastAccessedAt = new Date().toISOString();
      await this.saveConversation(conversationId, context);
    } catch (error) {
      logger.warn('Failed to update last accessed time', {
        conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
