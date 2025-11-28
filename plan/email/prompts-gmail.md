# Gmail Prompt Templates and Capabilities

This document provides reusable Gmail prompt templates and capability descriptions for AI agents using Gmail MCP tools in the cursor-runner system.

**Date**: 2024-12-19  
**Task**: TASK-EML-006

---

## 1. Gmail Capabilities Overview

The Gmail MCP integration enables AI agents to interact with Gmail through standardized MCP tools. Agents should **always use Gmail MCP tools** rather than making direct API calls.

### 1.1 Read and Summarize Emails

**Capability**: Read emails from Gmail inbox and generate summaries.

**Gmail MCP Tools Used**:
- `listMessages` - List emails matching filters (label, date range, query)
- `getMessage` - Get full email content and metadata

**Use Cases**:
- Summarize unread messages in inbox
- Review emails in specific labels
- Search for emails by sender, subject, or content
- Get email thread history

**When to Use**: When the task requires reading or understanding email content.

### 1.2 Draft and Send Email Replies

**Capability**: Draft and send email replies based on thread context.

**Gmail MCP Tools Used**:
- `getMessage` - Get email content to understand context
- `sendReply` - Send reply to email thread

**Use Cases**:
- Draft professional replies to customer inquiries
- Respond to meeting requests
- Acknowledge receipt of important emails
- Send follow-up messages

**When to Use**: When the task requires responding to emails.

### 1.3 Extract Structured Data

**Capability**: Extract structured information from emails (receipts, schedules, contact details).

**Gmail MCP Tools Used**:
- `listMessages` - Find emails matching criteria (label, sender, subject)
- `getMessage` - Get email content for parsing

**Use Cases**:
- Extract receipt information (merchant, amount, date)
- Parse calendar invitations
- Extract contact information from emails
- Collect project details from client communications

**When to Use**: When the task requires extracting specific data points from emails.

### 1.4 Auto-Categorize and Tag Messages

**Capability**: Analyze emails and categorize them (requires `gmail.modify` scope).

**Gmail MCP Tools Used**:
- `listMessages` - Get emails to categorize
- `getMessage` - Read email content for analysis
- `modifyMessage` - Add/remove labels (if scope allows)

**Use Cases**:
- Categorize emails as urgent, important, informational, or spam
- Auto-tag emails based on content
- Organize emails into folders/labels

**When to Use**: When the task requires organizing or categorizing emails.

---

## 2. Prompt Templates

### 2.1 Template: Summarize Unread Messages

**Purpose**: Get a summary of recent unread emails.

**Template**:
```
Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last {timeRange} (e.g., "7 days", "24 hours"). 
For each message, use getMessage to retrieve the full content, then summarize it in 3 bullet points covering:
- Sender and subject
- Key content or request
- Action required (if any)

Return the summaries in a structured format with one summary per message.
Limit to the {maxMessages} most recent unread messages.
```

**Parameters**:
- `timeRange`: Time range for messages (e.g., "7 days", "24 hours", "1 week")
- `maxMessages`: Maximum number of messages to summarize (default: 10)

**Example**:
```
Use the Gmail MCP tools to list recent unread messages in the PRIMARY inbox from the last 7 days. 
For each message, use getMessage to retrieve the full content, then summarize it in 3 bullet points covering:
- Sender and subject
- Key content or request
- Action required (if any)

Return the summaries in a structured format with one summary per message.
Limit to the 10 most recent unread messages.
```

**Expected Output Format**:
```
## Unread Messages Summary (Last 7 Days)

1. **From**: sender@example.com
   **Subject**: Meeting Request
   - Sender: John Doe (sender@example.com)
   - Key content: Requesting a meeting next week to discuss project timeline
   - Action required: Respond with available times

2. **From**: ...
```

**Gmail MCP Tool Calls**:
1. `listMessages` with filters: `label:UNREAD`, `after:YYYY-MM-DD`
2. For each message ID: `getMessage(messageId)`

---

### 2.2 Template: Draft Reply for Thread

**Purpose**: Draft a professional reply to an email thread.

**Template**:
```
Given thread ID {threadId}, use Gmail MCP tools to:
1. Use getMessage to read the last {messageCount} messages in the thread
2. Understand the context and tone of the conversation
3. Draft a {tone} reply that {requirements}

The reply should:
- Address all questions or requests in the thread
- Maintain appropriate professional tone
- Be concise and clear
- Include any necessary information or next steps

Return the drafted reply text ready to send.
```

**Parameters**:
- `threadId`: Gmail thread ID
- `messageCount`: Number of recent messages to read for context (default: 10)
- `tone`: Desired tone (e.g., "professional", "friendly", "formal")
- `requirements`: Specific requirements for the reply (e.g., "confirms the meeting time", "provides the requested information")

**Example**:
```
Given thread ID abc123, use Gmail MCP tools to:
1. Use getMessage to read the last 5 messages in the thread
2. Understand the context and tone of the conversation
3. Draft a professional reply that confirms the meeting time for next Tuesday at 2 PM

The reply should:
- Address all questions or requests in the thread
- Maintain appropriate professional tone
- Be concise and clear
- Include any necessary information or next steps

Return the drafted reply text ready to send.
```

**Expected Output Format**:
```
## Drafted Reply

Subject: Re: Meeting Request

Hi John,

Thank you for reaching out. I can confirm that I'm available for a meeting next Tuesday at 2 PM.

Looking forward to discussing the project timeline.

Best regards,
[Your Name]
```

**Gmail MCP Tool Calls**:
1. `getMessage` for each message in thread (using thread ID)
2. `sendReply` (if sending, not just drafting)

---

### 2.3 Template: Extract Receipts

**Purpose**: Extract structured receipt data from emails.

**Template**:
```
Scan the last {timeRange} of emails labeled '{label}' (or from senders matching '{senderPattern}') and extract receipt information.

Use Gmail MCP tools to:
1. Use listMessages to find emails matching the criteria
2. Use getMessage to retrieve email content for each match
3. Extract the following fields into JSON format:
   - merchant: Name of the merchant/vendor
   - total: Total amount (as number)
   - date: Purchase date (ISO 8601 format)
   - items: Array of items purchased (if available)
   - receipt_number: Receipt or order number (if available)

Return a JSON array with one object per receipt found.
```

**Parameters**:
- `timeRange`: Time range to search (e.g., "30 days", "3 months")
- `label`: Gmail label to filter by (e.g., "Receipts", "Purchases")
- `senderPattern`: Optional sender email pattern to filter (e.g., "*@amazon.com")

**Example**:
```
Scan the last 30 days of emails labeled 'Receipts' and extract receipt information.

Use Gmail MCP tools to:
1. Use listMessages to find emails matching the criteria
2. Use getMessage to retrieve email content for each match
3. Extract the following fields into JSON format:
   - merchant: Name of the merchant/vendor
   - total: Total amount (as number)
   - date: Purchase date (ISO 8601 format)
   - items: Array of items purchased (if available)
   - receipt_number: Receipt or order number (if available)

Return a JSON array with one object per receipt found.
```

**Expected Output Format**:
```json
[
  {
    "merchant": "Amazon",
    "total": 49.99,
    "date": "2024-12-15T10:30:00Z",
    "items": ["Item 1", "Item 2"],
    "receipt_number": "123-4567890-1234567"
  },
  {
    "merchant": "Starbucks",
    "total": 5.45,
    "date": "2024-12-14T08:15:00Z",
    "items": null,
    "receipt_number": null
  }
]
```

**Gmail MCP Tool Calls**:
1. `listMessages` with filters: `label:Receipts`, `after:YYYY-MM-DD`
2. For each message ID: `getMessage(messageId)`

---

### 2.4 Template: Categorize Messages

**Purpose**: Categorize unread messages by priority/type.

**Template**:
```
Use Gmail MCP tools to list unread messages and categorize each one as:
- urgent: Requires immediate attention (deadlines, critical issues)
- important: Important but not urgent (meetings, decisions needed)
- informational: For information only (newsletters, updates)
- spam: Unwanted or suspicious emails

For each message:
1. Use getMessage to read the full content
2. Analyze the sender, subject, and content
3. Assign the appropriate category based on:
   - Urgency indicators (deadlines, "urgent", "asap")
   - Importance indicators (from important contacts, key topics)
   - Spam indicators (suspicious sender, promotional content)

Return a categorized list with one entry per message.
```

**Parameters**: None (uses default unread messages)

**Example**:
```
Use Gmail MCP tools to list unread messages and categorize each one as:
- urgent: Requires immediate attention (deadlines, critical issues)
- important: Important but not urgent (meetings, decisions needed)
- informational: For information only (newsletters, updates)
- spam: Unwanted or suspicious emails

For each message:
1. Use getMessage to read the full content
2. Analyze the sender, subject, and content
3. Assign the appropriate category based on:
   - Urgency indicators (deadlines, "urgent", "asap")
   - Importance indicators (from important contacts, key topics)
   - Spam indicators (suspicious sender, promotional content)

Return a categorized list with one entry per message.
```

**Expected Output Format**:
```
## Categorized Messages

### Urgent (2)
1. **From**: boss@company.com
   **Subject**: Project deadline moved to tomorrow
   **Reason**: Contains deadline that requires immediate action

2. **From**: client@example.com
   **Subject**: URGENT: System outage
   **Reason**: Critical issue requiring immediate attention

### Important (3)
1. **From**: team@company.com
   **Subject**: Weekly team meeting
   **Reason**: Meeting invitation from team

### Informational (5)
1. **From**: newsletter@example.com
   **Subject**: Weekly digest
   **Reason**: Newsletter content

### Spam (1)
1. **From**: suspicious@suspicious.com
   **Subject**: You've won $1,000,000!
   **Reason**: Suspicious promotional content
```

**Gmail MCP Tool Calls**:
1. `listMessages` with filter: `label:UNREAD`
2. For each message ID: `getMessage(messageId)`
3. Optionally: `modifyMessage` to add labels (if `gmail.modify` scope is available)

---

### 2.5 Template: Extract Client Details

**Purpose**: Extract structured information about a client from email communications.

**Template**:
```
Use Gmail MCP tools to find emails from {clientEmail} (or matching '{senderPattern}') from the last {timeRange} and extract the following information into structured JSON:

1. Contact Information:
   - Name: Full name from email signature or content
   - Email: Email address
   - Phone: Phone number (if mentioned)
   - Company: Company name (if mentioned)

2. Project Details:
   - Current projects: List of active projects mentioned
   - Project status: Status of projects (if mentioned)
   - Key milestones: Important dates or milestones

3. Recent Communications:
   - Last contact date: Date of most recent email
   - Communication frequency: How often emails are received
   - Topics discussed: Main topics from recent emails

Use listMessages to find matching emails, then getMessage to read content for extraction.
```

**Parameters**:
- `clientEmail`: Specific client email address (e.g., "client@example.com")
- `senderPattern`: Alternative pattern to match (e.g., "*@clientcompany.com")
- `timeRange`: Time range to search (e.g., "90 days", "6 months")

**Example**:
```
Use Gmail MCP tools to find emails from client@example.com from the last 90 days and extract the following information into structured JSON:

1. Contact Information:
   - Name: Full name from email signature or content
   - Email: Email address
   - Phone: Phone number (if mentioned)
   - Company: Company name (if mentioned)

2. Project Details:
   - Current projects: List of active projects mentioned
   - Project status: Status of projects (if mentioned)
   - Key milestones: Important dates or milestones

3. Recent Communications:
   - Last contact date: Date of most recent email
   - Communication frequency: How often emails are received
   - Topics discussed: Main topics from recent emails

Use listMessages to find matching emails, then getMessage to read content for extraction.
```

**Expected Output Format**:
```json
{
  "contactInformation": {
    "name": "John Doe",
    "email": "client@example.com",
    "phone": "+1-555-123-4567",
    "company": "Example Corp"
  },
  "projectDetails": {
    "currentProjects": ["Website Redesign", "Mobile App"],
    "projectStatus": {
      "Website Redesign": "In Progress",
      "Mobile App": "Planning"
    },
    "keyMilestones": [
      {
        "project": "Website Redesign",
        "milestone": "Design Review",
        "date": "2024-12-20"
      }
    ]
  },
  "recentCommunications": {
    "lastContactDate": "2024-12-18T14:30:00Z",
    "communicationFrequency": "2-3 times per week",
    "topicsDiscussed": ["Project updates", "Timeline questions", "Budget approval"]
  }
}
```

**Gmail MCP Tool Calls**:
1. `listMessages` with filter: `from:client@example.com`, `after:YYYY-MM-DD`
2. For each message ID: `getMessage(messageId)`

---

## 3. Best Practices

### 3.1 Always Use Gmail MCP Tools

**CRITICAL**: Always use Gmail MCP tools (`listMessages`, `getMessage`, `sendReply`, etc.) rather than making direct Gmail API calls.

**Correct**:
```
Use the Gmail MCP tools to list unread messages...
```

**Incorrect**:
```
Make a GET request to https://gmail.googleapis.com/gmail/v1/users/me/messages...
```

### 3.2 Explicit Tool References

Always explicitly reference Gmail MCP tools by name in prompts:
- "Use the `listMessages` Gmail MCP tool to..."
- "Call the `getMessage` Gmail MCP tool with..."
- "Use Gmail MCP tools to..."

### 3.3 Error Handling

Prompts should instruct agents to handle errors gracefully:
- If no messages found, return empty result (don't fail)
- If message not found, report clearly
- If authentication fails, report the error

### 3.4 Security Considerations

- Never include full email content in logs (truncate if needed)
- Don't expose sensitive information in prompt outputs
- Respect user privacy when processing emails

---

## 4. Compatibility with System Instructions

These templates are designed to work with the system instructions appended by `cursor-runner` (see `SYSTEM_SETTINGS_MCP_INSTRUCTIONS` in `cursor-execution-service.ts`).

The system instructions already reference MCP connections, so Gmail MCP tools will be available when these prompts are used.

**Note**: When using these templates, the agent will automatically have access to Gmail MCP tools through the MCP configuration in `mcp.json`.

---

## 5. Usage Examples

### Example 1: Daily Email Summary

```
Use the Gmail MCP tools to summarize all unread messages from the last 24 hours. 
For each message, provide sender, subject, and a 2-sentence summary.
Group by label if possible.
```

### Example 2: Quick Reply

```
Use Gmail MCP tools to read the email with thread ID xyz789 and draft a brief, 
professional reply acknowledging receipt and confirming next steps.
```

### Example 3: Expense Tracking

```
Extract all receipt emails from the last month and create a JSON summary with 
merchant names and total amounts for expense reporting.
```

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19  
**Next Steps**: Use these templates in TASK-EML-007 (flow scenarios) and TASK-EML-008 (integration tests)

