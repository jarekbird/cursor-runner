# End-to-End Gmail Flow Scenarios

This document describes detailed end-to-end Gmail flow scenarios for the cursor-runner system. These flows are used to drive integration tests, acceptance criteria, and user acceptance testing.

**Date**: 2024-12-19  
**Task**: TASK-EML-007

---

## Overview

This document defines three primary Gmail flows:
1. **Summarize Unread Inbox Messages** - Read and summarize unread emails
2. **Draft and Send Reply for Thread** - Draft and send email replies
3. **Extract Receipts and Store** - Extract structured data from emails

Each flow includes:
- Trigger source
- HTTP request details
- Prompt construction
- Gmail MCP tool calls
- Execution path
- Result handling
- Error scenarios

---

## Flow 1: Summarize Unread Inbox Messages

### Trigger Source

**Option A: jarek-va Task**
- jarek-va creates a task in the database with prompt: "Summarize my unread inbox messages from the last 7 days"
- Task operator agent (if enabled) picks up the task and sends HTTP request to cursor-runner

**Option B: Scheduled Agent**
- Scheduled agent (cron-based) triggers daily/hourly to summarize unread messages
- Agent sends HTTP request to cursor-runner with Gmail prompt

**Option C: Manual Trigger**
- Operator manually sends HTTP request to cursor-runner endpoint

### HTTP Request

**Endpoint**: `POST /cursor/iterate/async`

**Method**: POST

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "prompt": "Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last 7 days. For each message, use getMessage to retrieve the full content, then summarize it in 3 bullet points covering: - Sender and subject - Key content or request - Action required (if any). Return the summaries in a structured format with one summary per message. Limit to the 10 most recent unread messages.",
  "repository": null,
  "branchName": null,
  "callbackUrl": "http://app:3000/api/cursor/callback",
  "conversationId": "conv-12345",
  "maxIterations": 5,
  "queueType": "api"
}
```

**Example cURL**:
```bash
curl -X POST http://localhost:3001/cursor/iterate/async \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last 7 days...",
    "callbackUrl": "http://app:3000/api/cursor/callback",
    "conversationId": "conv-12345",
    "maxIterations": 5
  }'
```

### Prompt Construction

**Base Prompt** (from TASK-EML-006 template):
```
Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last 7 days. 
For each message, use getMessage to retrieve the full content, then summarize it in 3 bullet points covering:
- Sender and subject
- Key content or request
- Action required (if any)

Return the summaries in a structured format with one summary per message.
Limit to the 10 most recent unread messages.
```

**Conversation Context** (if `conversationId` provided):
- CursorExecutionService loads conversation history from Redis
- Prepends previous messages to the prompt for context

**System Instructions** (appended automatically):
- Git cleanup instructions
- MCP connection references (SQLite, Redis)
- Task management instructions
- Code push reporting requirements

**Full Prompt Example** (what cursor CLI receives):
```
[Previous conversation context if any]

Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last 7 days. 
For each message, use getMessage to retrieve the full content, then summarize it in 3 bullet points covering:
- Sender and subject
- Key content or request
- Action required (if any)

Return the summaries in a structured format with one summary per message.
Limit to the 10 most recent unread messages.

[SYSTEM_SETTINGS_MCP_INSTRUCTIONS - automatically appended]
```

### Gmail MCP Tool Calls

**Expected Tool Sequence**:

1. **`listMessages`**
   - **Parameters**:
     ```json
     {
       "label": "UNREAD",
       "query": "in:inbox newer_than:7d",
       "maxResults": 10
     }
     ```
   - **Expected Output**:
     ```json
     {
       "messages": [
         {
           "id": "msg-123",
           "threadId": "thread-456",
           "snippet": "Meeting request for next week..."
         },
         ...
       ]
     }
     ```

2. **`getMessage`** (for each message)
   - **Parameters**:
     ```json
     {
       "messageId": "msg-123"
     }
     ```
   - **Expected Output**:
     ```json
     {
       "id": "msg-123",
       "threadId": "thread-456",
       "snippet": "Meeting request for next week...",
       "payload": {
         "headers": [
           {"name": "From", "value": "sender@example.com"},
           {"name": "Subject", "value": "Meeting Request"}
         ],
         "body": {
           "data": "base64-encoded-email-body"
         }
       }
     }
     ```

### Execution Path

1. **cursor-runner receives request**
   - Server receives POST to `/cursor/iterate/async`
   - Request body parsed and validated
   - Request ID generated: `req-{timestamp}-{random}`

2. **CursorExecutionService.iterate called**
   - Service validates repository (if provided)
   - Loads conversation context from Redis (if `conversationId` provided)
   - Prepares command arguments

3. **Prompt is built**
   - Base prompt from request
   - Conversation context prepended (if any)
   - System instructions appended (SYSTEM_SETTINGS_MCP_INSTRUCTIONS)

4. **CursorCLI.executeCommand runs cursor CLI**
   - Command: `cursor --model auto --print --force "{full prompt}"`
   - Environment: All `process.env` variables passed (including Gmail env vars)
   - Working directory: Repository path or default

5. **cursor CLI discovers Gmail MCP tools**
   - cursor CLI reads MCP config from `/root/.cursor/mcp.json`
   - Discovers `gmail` MCP server entry
   - Connects to Gmail MCP server process
   - Lists available tools: `listMessages`, `getMessage`, `sendReply`, etc.

6. **cursor CLI calls Gmail MCP tools**
   - Agent decides to call `listMessages` with filters
   - Agent calls `getMessage` for each message ID
   - Gmail MCP server authenticates using `GMAIL_*` env vars
   - Gmail MCP server makes Gmail API calls
   - Results returned to cursor CLI

7. **Results are captured**
   - cursor CLI processes tool outputs
   - Generates summary based on email content
   - Outputs structured summary text

8. **Response sent to callback URL**
   - CursorExecutionService sends POST to `callbackUrl`
   - Payload includes success status, output, requestId, iterations

### Result Handling

**Success Response** (sent to callback URL):
```json
{
  "success": true,
  "requestId": "req-1234567890-abc123",
  "output": "## Unread Messages Summary (Last 7 Days)\n\n1. **From**: sender@example.com\n   **Subject**: Meeting Request\n   - Sender: John Doe (sender@example.com)\n   - Key content: Requesting a meeting next week to discuss project timeline\n   - Action required: Respond with available times\n\n2. **From**: ...",
  "iterations": 1,
  "maxIterations": 5,
  "duration": "15.234s",
  "timestamp": "2024-12-19T10:30:00.000Z"
}
```

**Storage**:
- Conversation history stored in Redis: `cursor:conversation:{conversationId}`
- Output available for subsequent requests in same conversation

**Return to jarek-va**:
- jarek-va receives callback webhook
- Stores summary in database or displays to user
- May trigger follow-up actions (e.g., create tasks for action items)

### Error Scenarios

**Gmail MCP Unavailable**:
- **Symptom**: cursor CLI cannot connect to Gmail MCP server
- **Error Response**:
  ```json
  {
    "success": false,
    "requestId": "req-1234567890-abc123",
    "error": "Gmail MCP server not available: connection failed",
    "timestamp": "2024-12-19T10:30:00.000Z"
  }
  ```
- **Handling**: Log error, return error to callback URL

**Authentication Failure**:
- **Symptom**: Gmail MCP server returns auth error
- **Error Response**:
  ```json
  {
    "success": false,
    "requestId": "req-1234567890-abc123",
    "error": "Gmail authentication failed: invalid refresh token",
    "timestamp": "2024-12-19T10:30:00.000Z"
  }
  ```
- **Handling**: Log error, notify operator to update credentials

**No Messages Found**:
- **Symptom**: `listMessages` returns empty result
- **Success Response** (with empty summary):
  ```json
  {
    "success": true,
    "requestId": "req-1234567890-abc123",
    "output": "No unread messages found in the last 7 days.",
    "iterations": 1,
    "timestamp": "2024-12-19T10:30:00.000Z"
  }
  ```
- **Handling**: Return success with informative message

**Rate Limit Hit**:
- **Symptom**: Gmail API returns 429 Too Many Requests
- **Error Response**:
  ```json
  {
    "success": false,
    "requestId": "req-1234567890-abc123",
    "error": "Gmail API rate limit exceeded. Please try again later.",
    "timestamp": "2024-12-19T10:30:00.000Z"
  }
  ```
- **Handling**: Log error, implement retry with exponential backoff (future enhancement)

---

## Flow 2: Draft and Send Reply for Thread

### Trigger Source

**Option A: jarek-va Task**
- jarek-va creates task: "Draft a reply to thread ID abc123"
- Task operator sends HTTP request to cursor-runner

**Option B: Manual Trigger**
- Operator sends HTTP request with thread ID and reply requirements

### HTTP Request

**Endpoint**: `POST /cursor/iterate`

**Method**: POST

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "prompt": "Given thread ID abc123, use Gmail MCP tools to: 1. Use getMessage to read the last 5 messages in the thread. 2. Understand the context and tone of the conversation. 3. Draft a professional reply that addresses all questions in the thread. The reply should: - Address all questions or requests in the thread - Maintain appropriate professional tone - Be concise and clear - Include any necessary information or next steps. Return the drafted reply text ready to send.",
  "repository": null,
  "branchName": null,
  "conversationId": "conv-12345",
  "maxIterations": 3,
  "queueType": "api"
}
```

### Prompt Construction

**Base Prompt** (from TASK-EML-006 template):
```
Given thread ID abc123, use Gmail MCP tools to:
1. Use getMessage to read the last 5 messages in the thread
2. Understand the context and tone of the conversation
3. Draft a professional reply that addresses all questions in the thread

The reply should:
- Address all questions or requests in the thread
- Maintain appropriate professional tone
- Be concise and clear
- Include any necessary information or next steps

Return the drafted reply text ready to send.
```

**System Instructions**: Automatically appended (same as Flow 1)

### Gmail MCP Tool Calls

**Expected Tool Sequence**:

1. **`getMessage`** (for thread messages)
   - **Parameters**:
     ```json
     {
       "messageId": "msg-123"
     }
     ```
   - Called multiple times to get all messages in thread

2. **`sendReply`** (if prompt includes "send")
   - **Parameters**:
     ```json
     {
       "threadId": "abc123",
       "replyText": "Thank you for your email. I can confirm that..."
     }
     ```
   - **Expected Output**:
     ```json
     {
       "success": true,
       "messageId": "msg-789",
       "threadId": "abc123"
     }
     ```

### Execution Path

Similar to Flow 1, but:
- Synchronous execution (waits for completion)
- May include `sendReply` tool call if sending is requested
- Returns response directly (not via callback)

### Result Handling

**Success Response** (HTTP response):
```json
{
  "success": true,
  "requestId": "req-1234567890-abc123",
  "output": "Drafted reply:\n\nThank you for your email. I can confirm that we can schedule the meeting for next week. Please let me know your availability.\n\nBest regards,\n[Your Name]",
  "iterations": 1,
  "maxIterations": 3,
  "duration": "8.456s",
  "timestamp": "2024-12-19T10:35:00.000Z"
}
```

**If Reply Was Sent**:
- Output includes confirmation: "Reply sent successfully. Message ID: msg-789"

### Error Scenarios

**Invalid Thread ID**:
- **Error Response**:
  ```json
  {
    "success": false,
    "requestId": "req-1234567890-abc123",
    "error": "Thread not found: abc123",
    "timestamp": "2024-12-19T10:35:00.000Z"
  }
  ```

**Send Failure**:
- **Error Response**:
  ```json
  {
    "success": false,
    "requestId": "req-1234567890-abc123",
    "error": "Failed to send reply: insufficient permissions (gmail.send scope required)",
    "timestamp": "2024-12-19T10:35:00.000Z"
  }
  ```

---

## Flow 3: Extract Receipts and Store

### Trigger Source

**Option A: Scheduled Agent**
- Scheduled agent runs daily/hourly
- Sends HTTP request to cursor-runner to extract receipts

**Option B: Manual Trigger**
- Operator manually triggers extraction

### HTTP Request

**Endpoint**: `POST /cursor/iterate/async`

**Method**: POST

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "prompt": "Use Gmail MCP tools to: 1. List messages from the last 30 days labeled 'Receipts' (or matching query 'label:Receipts'). 2. For each message, use getMessage to retrieve the full content. 3. Extract the following information into structured JSON format: - Merchant name - Total amount - Date - Transaction ID (if available) - Category (if determinable). Return a JSON array with one object per receipt.",
  "repository": null,
  "branchName": null,
  "callbackUrl": "http://app:3000/api/cursor/callback",
  "conversationId": "conv-receipts-12345",
  "maxIterations": 5,
  "queueType": "api"
}
```

### Prompt Construction

**Base Prompt** (from TASK-EML-006 template):
```
Use Gmail MCP tools to:
1. List messages from the last 30 days labeled 'Receipts' (or matching query 'label:Receipts')
2. For each message, use getMessage to retrieve the full content
3. Extract the following information into structured JSON format:
   - Merchant name
   - Total amount
   - Date
   - Transaction ID (if available)
   - Category (if determinable)

Return a JSON array with one object per receipt.
```

**System Instructions**: Automatically appended

### Gmail MCP Tool Calls

**Expected Tool Sequence**:

1. **`listMessages`**
   - **Parameters**:
     ```json
     {
       "label": "Receipts",
       "query": "label:Receipts newer_than:30d",
       "maxResults": 50
     }
     ```

2. **`getMessage`** (for each receipt email)
   - Extract structured data from email body

### Execution Path

Similar to Flow 1 (async execution)

### Result Handling

**Success Response** (sent to callback URL):
```json
{
  "success": true,
  "requestId": "req-1234567890-abc123",
  "output": "[\n  {\n    \"merchant\": \"Amazon\",\n    \"amount\": 49.99,\n    \"date\": \"2024-12-15\",\n    \"transactionId\": \"TXN-123456\",\n    \"category\": \"Shopping\"\n  },\n  {\n    \"merchant\": \"Starbucks\",\n    \"amount\": 5.50,\n    \"date\": \"2024-12-14\",\n    \"transactionId\": null,\n    \"category\": \"Food & Drink\"\n  }\n]",
  "iterations": 1,
  "maxIterations": 5,
  "duration": "12.789s",
  "timestamp": "2024-12-19T10:40:00.000Z"
}
```

**Storage**:
- jarek-va receives callback with JSON data
- Stores receipts in database or processes for expense tracking

### Error Scenarios

**No Receipts Found**:
- Returns success with empty array: `[]`

**Parsing Errors**:
- Returns partial results with error message for unparseable emails

---

## Common Error Scenarios (All Flows)

### Gmail MCP Server Not Running

**Symptom**: cursor CLI cannot connect to Gmail MCP server process

**Error Response**:
```json
{
  "success": false,
  "requestId": "req-1234567890-abc123",
  "error": "Gmail MCP server not available: process not found",
  "timestamp": "2024-12-19T10:30:00.000Z"
}
```

**Handling**: 
- Check Gmail MCP server is installed
- Verify MCP config includes `gmail` entry
- Check server logs for startup errors

### Network Timeout

**Symptom**: Gmail API calls timeout

**Error Response**:
```json
{
  "success": false,
  "requestId": "req-1234567890-abc123",
  "error": "Gmail API request timeout after 30s",
  "timestamp": "2024-12-19T10:30:00.000Z"
}
```

**Handling**: Implement retry logic (future enhancement)

### Invalid Environment Variables

**Symptom**: Gmail MCP server cannot authenticate

**Error Response**:
```json
{
  "success": false,
  "requestId": "req-1234567890-abc123",
  "error": "Gmail authentication failed: missing GMAIL_REFRESH_TOKEN",
  "timestamp": "2024-12-19T10:30:00.000Z"
}
```

**Handling**: 
- Validate env vars at startup (already implemented)
- Log clear error message
- Return error to callback URL

---

## Summary

These three flows cover the primary Gmail MCP use cases:
1. **Reading and summarizing** emails
2. **Drafting and sending** replies
3. **Extracting structured data** from emails

Each flow follows the same execution pattern:
- HTTP request to cursor-runner
- Prompt construction with system instructions
- cursor CLI execution with Gmail MCP tools
- Result handling via callback or direct response

**Next Steps**:
- TASK-EML-008: Implement integration tests based on these flows
- TASK-EML-009: Create optional smoke test for live Gmail account

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19

