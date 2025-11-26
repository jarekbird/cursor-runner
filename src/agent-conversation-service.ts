/**
 * Service for managing agent conversations in Redis
 * Agent conversations are separate from regular conversations and have additional metadata
 */
import Redis from 'ioredis';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string; // Optional - will be generated if not provided
  source?: 'voice' | 'text' | 'user_input' | 'agent_response' | 'tool_output' | 'system_event';
  messageId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolOutput?: string;
}

export interface AgentConversation {
  conversationId: string;
  messages: AgentMessage[];
  createdAt: string;
  lastAccessedAt: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  // Internal fields (not exposed to frontend)
  title?: string;
  status?: 'active' | 'completed' | 'archived' | 'failed';
}

/**
 * Service for managing agent conversation context in Redis
 */
export class AgentConversationService {
  private redis: Redis;
  private readonly TTL = 3600; // 1 hour in seconds
  private readonly CONVERSATION_PREFIX = 'agent:conversation:';
  private readonly LIST_KEY = 'agent:conversations:list';

  private redisAvailable: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://redis:6379/0';
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          return null;
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error in AgentConversationService', {
        error: error.message,
      });
      this.redisAvailable = false;
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected for agent conversation storage');
      this.redisAvailable = true;
    });

    this.redis.connect().catch((error) => {
      logger.warn('Redis connection failed for agent conversations', {
        error: error.message,
      });
      this.redisAvailable = false;
    });
  }

  /**
   * Create a new agent conversation
   */
  async createConversation(agentId?: string): Promise<AgentConversation> {
    const conversationId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const conversation: AgentConversation = {
      conversationId,
      title: `Agent Conversation ${conversationId.substring(0, 8)}`,
      messages: [],
      createdAt: now,
      lastAccessedAt: now,
      agentId,
      status: 'active',
    };

    await this.saveConversation(conversation);
    await this.addToList(conversationId);

    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string): Promise<AgentConversation | null> {
    if (!this.redisAvailable) {
      return null;
    }

    try {
      const key = `${this.CONVERSATION_PREFIX}${conversationId}`;
      const value = await this.redis.get(key);

      if (!value) {
        return null;
      }

      const conversation = JSON.parse(value) as AgentConversation;
      // Ensure conversationId is set (for backward compatibility with old data)
      if (!conversation.conversationId) {
        conversation.conversationId = conversationId;
      }
      // Update last accessed
      conversation.lastAccessedAt = new Date().toISOString();
      await this.saveConversation(conversation);

      return conversation;
    } catch (error) {
      logger.error('Failed to get agent conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * List all agent conversations
   */
  async listConversations(): Promise<AgentConversation[]> {
    if (!this.redisAvailable) {
      return [];
    }

    try {
      const ids = await this.redis.smembers(this.LIST_KEY);
      const conversations: AgentConversation[] = [];

      for (const id of ids) {
        const conversation = await this.getConversation(id);
        if (conversation) {
          conversations.push(conversation);
        }
      }

      // Sort by lastAccessedAt descending
      return conversations.sort(
        (a, b) =>
          new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
      );
    } catch (error) {
      logger.error('Failed to list agent conversations', {
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(conversationId: string, message: AgentMessage): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Agent conversation ${conversationId} not found`);
    }

    // Ensure message has required fields
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }
    if (!message.messageId) {
      message.messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    conversation.messages.push(message);
    conversation.lastAccessedAt = new Date().toISOString();
    await this.saveConversation(conversation);
  }

  /**
   * Update an existing conversation
   */
  async updateConversation(conversation: AgentConversation): Promise<void> {
    await this.saveConversation(conversation);
  }

  /**
   * Save conversation to Redis
   */
  private async saveConversation(conversation: AgentConversation): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }

    try {
      const key = `${this.CONVERSATION_PREFIX}${conversation.conversationId}`;
      await this.redis.setex(key, this.TTL, JSON.stringify(conversation));
    } catch (error) {
      logger.error('Failed to save agent conversation', {
        conversationId: conversation.conversationId,
        error: getErrorMessage(error),
      });
      this.redisAvailable = false;
    }
  }

  /**
   * Add conversation ID to list
   */
  private async addToList(id: string): Promise<void> {
    if (!this.redisAvailable) {
      return;
    }

    try {
      await this.redis.sadd(this.LIST_KEY, id);
      // Set TTL on list key as well
      await this.redis.expire(this.LIST_KEY, this.TTL);
    } catch (error) {
      logger.error('Failed to add agent conversation to list', {
        id,
        error: getErrorMessage(error),
      });
    }
  }
}


