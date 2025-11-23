import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { isSystemSettingEnabled } from './system-settings.js';

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

export type QueueType = 'default' | 'telegram';

/**
 * Service for managing conversation context in Redis
 * Stores conversation history with automatic summarization when context window is too large
 */
export class ConversationService {
  private redis: Redis;
  private readonly TTL = 3600; // 1 hour in seconds
  private readonly LAST_CONVERSATION_KEY = 'cursor:last_conversation_id';
  private readonly TELEGRAM_LAST_CONVERSATION_KEY = 'cursor:telegram:last_conversation_id';

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
   * Get the Redis key for the last conversation ID based on queue type
   */
  private getLastConversationKey(queueType: QueueType = 'default'): string {
    return queueType === 'telegram'
      ? this.TELEGRAM_LAST_CONVERSATION_KEY
      : this.LAST_CONVERSATION_KEY;
  }

  /**
   * Get or create a conversation ID
   * Conversation IDs are always created internally by cursor-runner (never by external services)
   * If no conversationId is provided, returns the last conversation ID for the specified queue type
   * If no last conversation exists, creates a new one automatically
   * @param conversationId - Optional explicit conversation ID to use
   * @param queueType - Queue type to use when getting last conversation ID (default: 'default')
   */
  async getConversationId(
    conversationId?: string,
    queueType: QueueType = 'default'
  ): Promise<string> {
    if (!this.redisAvailable) {
      // If Redis is not available, generate a new ID each time
      // This means context won't persist, but the system will still work
      return conversationId || randomUUID();
    }

    try {
      if (conversationId) {
        // When conversationId is explicitly provided, use it and don't update the "last conversation"
        // This ensures each task gets its own conversation when conversationId is provided
        // Only update last accessed time for tracking purposes
        await this.updateLastAccessed(conversationId);
        return conversationId;
      }

      // Get last conversation ID for the specified queue type
      const lastConversationKey = this.getLastConversationKey(queueType);
      const lastId = await this.redis.get(lastConversationKey);
      if (lastId) {
        await this.updateLastAccessed(lastId);
        return lastId;
      }

      // Create new conversation if none exists
      const newId = randomUUID();
      await this.redis.set(lastConversationKey, newId);
      await this.createConversation(newId, queueType);
      return newId;
    } catch (error) {
      logger.warn('Redis operation failed, using new conversation ID', {
        error: getErrorMessage(error),
        queueType,
      });
      this.redisAvailable = false;
      return conversationId || randomUUID();
    }
  }

  /**
   * Create a new conversation
   * @param conversationId - The conversation ID to create
   * @param queueType - Queue type to update when creating conversation (default: 'default')
   */
  async createConversation(
    conversationId: string,
    queueType: QueueType = 'default'
  ): Promise<void> {
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

      // Update last conversation ID for the specified queue type
      const lastConversationKey = this.getLastConversationKey(queueType);
      await this.redis.set(lastConversationKey, conversationId);

      logger.info('Created new conversation', { conversationId, queueType });
    } catch (error) {
      logger.warn('Failed to create conversation in Redis', {
        conversationId,
        queueType,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Force create a new conversation (clears the last conversation ID)
   * This is useful when you want to explicitly start a fresh conversation
   * @param queueType - Queue type to use when creating conversation (default: 'default')
   */
  async forceNewConversation(queueType: QueueType = 'default'): Promise<string> {
    const newId = randomUUID();

    if (!this.redisAvailable) {
      return newId;
    }

    try {
      const lastConversationKey = this.getLastConversationKey(queueType);
      await this.redis.set(lastConversationKey, newId);
      await this.createConversation(newId, queueType);
      logger.info('Forced new conversation creation', { conversationId: newId, queueType });
      return newId;
    } catch (error) {
      logger.warn('Failed to force new conversation in Redis, returning new ID anyway', {
        error: getErrorMessage(error),
        queueType,
      });
      this.redisAvailable = false;
      return newId;
    }
  }

  /**
   * Add a message to the conversation (excluding review agent messages unless DEBUG is true)
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
    // Check if DEBUG is enabled - read from system settings database, fallback to env var
    const debugEnabled = isSystemSettingEnabled('debug');

    if (isReviewAgent && !debugEnabled) {
      // Don't store review agent messages unless DEBUG is enabled
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
   * Excludes review agent messages (messages starting with [Review Agent)
   */
  buildContextString(messages: ConversationMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    // Filter out review agent messages - they should not be included in worker agent context
    const workerMessages = messages.filter(
      (msg) =>
        !msg.content.startsWith('[Review Agent Request]') &&
        !msg.content.startsWith('[Review Agent Response]')
    );

    return workerMessages
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
        // Default to 'default' queue type for backward compatibility
        await this.createConversation(conversationId, 'default');
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
    // Check connection before saving
    const isConnected = await this.checkRedisConnection();
    if (!isConnected) {
      logger.warn('Cannot save conversation, Redis not available', {
        conversationId,
        redisStatus: this.redis.status,
      });
      return;
    }

    try {
      const key = `cursor:conversation:${conversationId}`;
      await this.redis.setex(key, this.TTL, JSON.stringify(context));
      logger.debug('Saved conversation to Redis', {
        conversationId,
        key,
        messageCount: context.messages.length,
        ttl: this.TTL,
      });
    } catch (error) {
      logger.error('Failed to save conversation to Redis', {
        conversationId,
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        redisStatus: this.redis.status,
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
   * Check Redis connection and update availability status
   */
  private async checkRedisConnection(): Promise<boolean> {
    try {
      const status = this.redis.status;
      if (status === 'ready' || status === 'connect') {
        // Try to ping to verify connection is actually working
        const pingResult = await this.redis.ping();
        if (pingResult === 'PONG') {
          if (!this.redisAvailable) {
            logger.info('Redis connection restored', { status });
            this.redisAvailable = true;
          }
          return true;
        }
      }

      // Try to reconnect if not connected
      if (status === 'end' || status === 'close') {
        logger.info('Attempting to reconnect to Redis', { previousStatus: status });
        try {
          await this.redis.connect();
          const pingResult = await this.redis.ping();
          if (pingResult === 'PONG') {
            this.redisAvailable = true;
            return true;
          }
        } catch (reconnectError) {
          logger.warn('Redis reconnection failed', {
            error: getErrorMessage(reconnectError),
          });
        }
      }

      this.redisAvailable = false;
      return false;
    } catch (error) {
      logger.warn('Redis connection check failed', {
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
      return false;
    }
  }

  /**
   * List all conversations from Redis
   * Returns array of conversation summaries
   */
  async listConversations(): Promise<ConversationContext[]> {
    // Check Redis connection status before proceeding
    const isConnected = await this.checkRedisConnection();

    if (!isConnected) {
      logger.warn('Cannot list conversations, Redis not available', {
        redisStatus: this.redis.status,
        redisAvailable: this.redisAvailable,
      });
      return [];
    }

    try {
      // Get all keys matching the conversation pattern
      const keys = await this.redis.keys('cursor:conversation:*');
      logger.debug('Found conversation keys in Redis', { keyCount: keys.length });

      if (keys.length === 0) {
        logger.info('No conversations found in Redis', {
          pattern: 'cursor:conversation:*',
        });
        return [];
      }

      // Fetch all conversations in parallel
      const promises = keys.map(async (key) => {
        try {
          const data = await this.redis.get(key);
          if (data) {
            return JSON.parse(data) as ConversationContext;
          }
          return null;
        } catch (error) {
          logger.warn('Failed to parse conversation', {
            key,
            error: getErrorMessage(error),
          });
          return null;
        }
      });

      const results = await Promise.all(promises);
      const conversations = results.filter((conv): conv is ConversationContext => conv !== null);
      logger.info('Listed conversations from Redis', {
        totalKeys: keys.length,
        validConversations: conversations.length,
      });
      return conversations;
    } catch (error) {
      logger.error('Failed to list conversations from Redis', {
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        redisStatus: this.redis.status,
      });
      this.redisAvailable = false;
      return [];
    }
  }

  /**
   * Get a specific conversation by ID
   */
  async getConversationById(conversationId: string): Promise<ConversationContext | null> {
    if (!this.redisAvailable) {
      return null;
    }

    try {
      return await this.getConversation(conversationId);
    } catch (error) {
      logger.warn('Failed to get conversation by ID', {
        conversationId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
