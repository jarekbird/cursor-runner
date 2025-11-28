# Security and Privacy Review for Gmail Integration

This document provides a comprehensive security and privacy review of the Gmail MCP integration in the cursor-runner system, covering OAuth scopes, logging practices, data retention, and credential revocation procedures.

**Date**: 2024-12-19  
**Task**: TASK-EML-010

---

## 1. OAuth Scope Review

### 1.1 Current Scope Configuration

The Gmail MCP integration uses the following OAuth scopes (as documented in `config.md`):

**Required Scopes**:
- `https://www.googleapis.com/auth/gmail.readonly` - Read-only access to Gmail messages
- `https://www.googleapis.com/auth/gmail.send` - Send emails on behalf of the user

**Optional Scope** (not currently used):
- `https://www.googleapis.com/auth/gmail.modify` - Modify Gmail messages (label, archive, delete)

### 1.2 Scope Rationale and Security Analysis

#### `gmail.readonly` Scope

**Purpose**: Read emails and metadata without modification capability.

**Security Implications**:
- ✅ **Low Risk**: Read-only access minimizes risk of accidental data modification
- ✅ **Least Privilege**: Only requests read access, not write/modify permissions
- ⚠️ **Data Access**: Can access all emails in the account (subject to label restrictions if `GMAIL_ALLOWED_LABELS` is configured)
- ⚠️ **Privacy**: Can read sensitive email content

**Recommendation**: ✅ **APPROVED** - This scope is necessary for core functionality and follows least-privilege principle.

#### `gmail.send` Scope

**Purpose**: Send emails on behalf of the user.

**Security Implications**:
- ⚠️ **Medium Risk**: Allows sending emails, which could be misused
- ⚠️ **Impersonation Risk**: Emails appear to come from the user's account
- ✅ **Controlled**: Only used when explicitly requested by user/agent prompts
- ✅ **No Draft Modification**: Cannot modify existing drafts (read-only + send only)

**Recommendation**: ✅ **APPROVED** - Required for reply functionality. Risk is mitigated by:
- Only sending when explicitly requested in prompts
- User can revoke access at any time
- All sent emails are visible in user's Sent folder

#### `gmail.modify` Scope (Not Currently Used)

**Purpose**: Modify Gmail messages (label, archive, delete).

**Security Implications**:
- 🔴 **Higher Risk**: Allows modification and deletion of emails
- 🔴 **Data Loss Risk**: Could accidentally delete important emails
- ⚠️ **Not Currently Needed**: Not required for initial implementation

**Recommendation**: ❌ **NOT RECOMMENDED** for initial implementation. Only add if auto-categorization features are required.

### 1.3 Least-Privilege Compliance

**Current Implementation**: ✅ **COMPLIANT**

The current scope set (`gmail.readonly` + `gmail.send`) follows the least-privilege principle:
- Requests only the minimum scopes needed for core functionality
- Does not request `gmail.modify` unless needed
- Can be further restricted using `GMAIL_ALLOWED_LABELS` environment variable

**Future Considerations**:
- If auto-categorization is needed, evaluate whether `gmail.modify` is truly necessary
- Consider using label-based restrictions (`GMAIL_ALLOWED_LABELS`) to limit access scope
- Document any scope additions with security rationale

---

## 2. Logging Practices and Data Protection

### 2.1 Current Logging Implementation

**Logger**: Winston logger (`src/logger.ts`)
- Logs to both console and file (`logs/cursor-runner.log`)
- Uses JSON format for structured logging
- Log level configurable via `LOG_LEVEL` environment variable

### 2.2 Gmail Data in Logs

**Current State**: No specific Gmail data truncation/redaction is implemented.

**Potential Gmail Data in Logs**:
1. **Email Bodies**: May appear in cursor CLI output logs if prompts include email content
2. **Email Addresses**: May appear in logs (sender, recipient addresses)
3. **Thread IDs**: May appear in logs (non-sensitive identifiers)
4. **OAuth Tokens**: **MUST NEVER** appear in logs (currently protected by env var usage)

### 2.3 Logging Security Measures

#### OAuth Tokens and Secrets

**Status**: ✅ **PROTECTED**

- OAuth tokens (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) are stored in environment variables
- Environment variables are not logged by default
- `CursorCLI` passes `process.env` to spawned processes but does not log env var values
- No code paths log OAuth tokens or secrets

**Verification**: 
- ✅ No `logger.*` calls include `GMAIL_CLIENT_SECRET` or `GMAIL_REFRESH_TOKEN`
- ✅ System settings getters return values but don't log them
- ✅ Startup validation logs presence/absence but not actual values

#### Email Bodies

**Status**: ⚠️ **POTENTIAL EXPOSURE**

- Email bodies may appear in cursor CLI output logs
- Cursor CLI output is logged via `logger.info('cursor-cli stdout chunk', ...)` in `cursor-cli.ts`
- Large outputs are truncated to 500 characters for logging preview, but full output is stored

**Recommendation**: 
- ✅ **Current truncation is acceptable** for preview logs
- ⚠️ **Full output logs may contain email bodies** - this is expected behavior for debugging
- 🔒 **Production logs should be secured** (access controls, encryption at rest)
- 📝 **Document**: Operators should be aware that logs may contain email content

#### Email Addresses

**Status**: ✅ **ACCEPTABLE**

- Email addresses (sender, recipient) may appear in logs
- These are not considered highly sensitive (publicly available information)
- No special redaction needed for email addresses

**Recommendation**: ✅ **No changes needed** - email addresses in logs are acceptable.

### 2.4 Logging Best Practices

**Current Practices**:
- ✅ OAuth tokens are never logged
- ✅ Large outputs are truncated in log previews (500 chars)
- ✅ Structured logging enables filtering/searching
- ⚠️ Full cursor CLI output may contain email bodies (stored in stdout)

**Recommendations**:
1. **Production Log Security**:
   - Secure log files with appropriate file permissions
   - Encrypt logs at rest if containing sensitive data
   - Limit log file access to authorized personnel only
   - Consider log rotation and retention policies

2. **Log Monitoring**:
   - Monitor logs for authentication failures
   - Alert on repeated Gmail API errors
   - Track Gmail MCP usage patterns

3. **Future Enhancements** (Optional):
   - Add configurable email body truncation in logs
   - Add option to redact email addresses in logs
   - Add log filtering to exclude Gmail-related logs if needed

---

## 3. Data Retention Policies

### 3.1 Gmail-Derived Data Storage

**Conversation History (Redis)**:
- **Location**: Redis (`cursor:conversation:{conversationId}`)
- **Content**: May include email summaries, extracted data, and conversation context
- **TTL**: 3600 seconds (1 hour) - automatically expires
- **Reference**: `src/conversation-service.ts` (line 29)

**Cursor CLI Output**:
- **Location**: Returned in HTTP responses, stored in callback webhooks
- **Content**: May include email summaries and extracted data
- **Retention**: Depends on downstream system (jarek-va, etc.)

**No Persistent Gmail Data**:
- ✅ No email bodies are permanently stored in cursor-runner
- ✅ No Gmail credentials are stored in databases
- ✅ Conversation history expires after 1 hour

### 3.2 Data Retention Periods

| Data Type | Location | Retention Period | Deletion Method |
|-----------|----------|------------------|-----------------|
| Conversation History | Redis | 1 hour | Automatic TTL expiration |
| Cursor CLI Output | HTTP Response | Transient | Not stored by cursor-runner |
| Gmail Credentials | Environment Variables | Until revoked | Manual removal |
| Log Files | `logs/cursor-runner.log` | 5 files × 5MB each | Automatic rotation |

### 3.3 Data Deletion Procedures

#### Conversation History

**Automatic Deletion**:
- Conversation history in Redis automatically expires after 1 hour (TTL)
- No manual deletion needed for normal operation

**Manual Deletion** (if needed):
```bash
# Connect to Redis
redis-cli

# Delete specific conversation
DEL cursor:conversation:{conversationId}

# Delete all conversations (use with caution)
KEYS cursor:conversation:* | xargs redis-cli DEL
```

#### Log Files

**Automatic Rotation**:
- Log files rotate when they reach 5MB
- Maximum 5 log files are kept
- Old log files are automatically deleted

**Manual Deletion**:
```bash
# Delete log files manually if needed
rm logs/cursor-runner.log*
```

#### Gmail Credentials

**Removal**:
- Remove `GMAIL_*` environment variables from `.env` or secret manager
- Restart cursor-runner service
- Credentials are removed from memory on service restart

### 3.4 GDPR and Privacy Compliance

**Right to Deletion**:
- Users can revoke Gmail access via Google Account settings (immediate effect)
- Conversation history expires automatically (1 hour)
- No persistent Gmail data is stored beyond conversation TTL

**Data Minimization**:
- ✅ Only stores email summaries, not full email bodies
- ✅ Conversation history has short TTL (1 hour)
- ✅ No Gmail data is stored in permanent databases

**Recommendation**: ✅ **Current implementation is compliant** with data minimization principles.

---

## 4. Credential Revocation Procedures

### 4.1 User Revocation (Google Account)

**Method**: Users can revoke access via Google Account settings.

**Steps**:
1. Go to [Google Account Settings](https://myaccount.google.com/permissions)
2. Find "Third-party apps with account access"
3. Locate the cursor-runner application
4. Click "Remove access" or "Revoke access"

**Effect**: 
- ✅ Immediate revocation
- ✅ Gmail MCP operations will fail with authentication errors
- ✅ No further Gmail access until re-authentication

### 4.2 Emergency Revocation (Operator)

**Method 1: Remove Environment Variables**

**Steps**:
1. Remove `GMAIL_*` environment variables from `.env` or secret manager:
   ```bash
   # Remove from .env file
   # GMAIL_CLIENT_ID=...
   # GMAIL_CLIENT_SECRET=...
   # GMAIL_REFRESH_TOKEN=...
   ```
2. Restart cursor-runner service:
   ```bash
   docker-compose restart cursor-runner
   # or
   systemctl restart cursor-runner
   ```

**Effect**: 
- ✅ Gmail MCP server cannot authenticate
- ✅ Gmail MCP operations will fail
- ✅ No Gmail access until credentials are restored

**Method 2: Disable Gmail MCP (Feature Flag)**

**Steps** (when TASK-EML-011 is implemented):
1. Set `ENABLE_GMAIL_MCP=false` in environment
2. Restart cursor-runner service

**Effect**: 
- ✅ Gmail MCP entry is removed from MCP config
- ✅ Gmail tools are not available to cursor CLI
- ✅ No Gmail operations can be performed

**Method 3: Remove MCP Config Entry**

**Steps**:
1. Remove `gmail` entry from `mcp.json`:
   ```json
   {
     "mcpServers": {
       "cursor-runner-shared-sqlite": { ... },
       "cursor-runner-shared-redis": { ... }
       // "gmail" entry removed
     }
   }
   ```
2. Restart cursor-runner service (MCP config is merged on startup)

**Effect**: 
- ✅ Gmail MCP server is not registered
- ✅ Gmail tools are not available
- ✅ No Gmail operations can be performed

### 4.3 Verification of Revocation

**Check Gmail MCP Status**:
```bash
# Check if Gmail env vars are set
env | grep GMAIL

# Check MCP config (in Docker)
docker exec cursor-runner cat /root/.cursor/mcp.json | grep -A 10 gmail

# Check logs for Gmail MCP errors
docker logs cursor-runner | grep -i gmail
```

**Expected Results After Revocation**:
- ❌ Gmail env vars are not set (or removed)
- ❌ Gmail MCP entry is not in MCP config (if feature flag disabled)
- ⚠️ Gmail MCP operations fail with authentication errors

### 4.4 Re-Authentication After Revocation

**Steps**:
1. Complete OAuth consent flow again (see `config.md` Section 5.2)
2. Obtain new refresh token
3. Update `GMAIL_REFRESH_TOKEN` environment variable
4. Restart cursor-runner service

**Note**: Client ID and secret typically don't change, only refresh token needs updating.

---

## 5. Security Best Practices

### 5.1 Secret Management

**✅ Current Practices**:
- Secrets stored in environment variables (not hard-coded)
- `.env` file is in `.gitignore` (not committed)
- Docker secrets or secret managers recommended for production

**Recommendations**:
- ✅ Use secret managers in production (AWS Secrets Manager, Google Secret Manager, etc.)
- ✅ Rotate refresh tokens periodically (every 90 days)
- ✅ Limit access to secrets (principle of least privilege)
- ✅ Audit secret access

### 5.2 Access Control

**Current Implementation**:
- Gmail MCP is available to all cursor CLI operations
- No per-user or per-request access control

**Recommendations**:
- ✅ Use `GMAIL_ALLOWED_LABELS` to restrict access to specific labels
- ✅ Monitor Gmail MCP usage patterns
- ✅ Consider adding per-request access control if needed
- ✅ Document who can configure Gmail credentials

### 5.3 Monitoring and Alerting

**Recommended Monitoring**:
- Gmail API authentication failures
- Gmail MCP connection errors
- Unusual Gmail access patterns
- Refresh token expiration warnings

**Recommended Alerts**:
- Multiple consecutive Gmail authentication failures
- Gmail MCP server unavailable
- Unauthorized Gmail access attempts

---

## 6. Privacy Considerations

### 6.1 Data Access

**What Gmail Data is Accessed**:
- Email messages (read via `gmail.readonly` scope)
- Email metadata (headers, labels, thread information)
- Email content (bodies, attachments if supported)

**What Gmail Data is Stored**:
- ✅ Email summaries (in Redis conversation history, 1 hour TTL)
- ✅ Extracted structured data (in conversation history or downstream systems)
- ❌ Full email bodies are NOT permanently stored
- ❌ Email attachments are NOT stored

### 6.2 User Consent

**OAuth Consent Flow**:
- Users must explicitly grant OAuth permissions
- Users can see what scopes are being requested
- Users can revoke access at any time

**Transparency**:
- ✅ Users know Gmail access is being used (OAuth consent screen)
- ✅ Users can see what permissions are granted
- ✅ Users can revoke access immediately

### 6.3 Data Sharing

**No Third-Party Sharing**:
- ✅ Gmail data is not shared with third parties
- ✅ Gmail data is only used within cursor-runner system
- ✅ Gmail data may be sent to jarek-va (downstream system) via callbacks, but this is user-initiated

**Recommendation**: Document data flow to downstream systems (jarek-va) in privacy policy.

---

## 7. Security Checklist

### 7.1 Implementation Checklist

- [x] OAuth scopes follow least-privilege principle
- [x] OAuth tokens are never logged
- [x] OAuth tokens are stored in environment variables (not hard-coded)
- [x] Conversation history has short TTL (1 hour)
- [x] No persistent Gmail data storage
- [x] Revocation procedures are documented
- [ ] Log encryption at rest (production recommendation)
- [ ] Access controls on log files (production recommendation)
- [ ] Monitoring and alerting configured (production recommendation)

### 7.2 Operational Checklist

- [ ] Gmail credentials stored in secret manager (production)
- [ ] Log files secured with appropriate permissions
- [ ] Monitoring configured for Gmail MCP operations
- [ ] Alerting configured for authentication failures
- [ ] Token rotation schedule established (recommended: every 90 days)
- [ ] Access to Gmail credentials is limited (principle of least privilege)

---

## 8. Summary

### 8.1 Security Status

**Overall Assessment**: ✅ **SECURE** for initial implementation

**Strengths**:
- ✅ Least-privilege OAuth scopes
- ✅ No persistent Gmail data storage
- ✅ Short conversation history TTL (1 hour)
- ✅ OAuth tokens never logged
- ✅ Clear revocation procedures

**Areas for Improvement** (Future Enhancements):
- ⚠️ Log encryption at rest (production)
- ⚠️ Enhanced monitoring and alerting
- ⚠️ Configurable email body truncation in logs (optional)

### 8.2 Privacy Status

**Overall Assessment**: ✅ **PRIVACY-COMPLIANT**

**Strengths**:
- ✅ User consent required (OAuth flow)
- ✅ User can revoke access immediately
- ✅ Data minimization (only summaries stored, short TTL)
- ✅ No third-party data sharing

**Recommendations**:
- 📝 Document data flow to downstream systems
- 📝 Consider adding privacy policy section for Gmail integration

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19  
**Next Review**: After production deployment or significant changes to Gmail integration

**Related Documents**:
- `config.md` - Gmail configuration contract
- `rollout-gmail.md` - Rollout and feature flagging (TASK-EML-011)

