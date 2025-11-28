# Gmail MCP Configuration Contract

This document defines the complete configuration contract for Gmail MCP integration in the `cursor-runner` system, including environment variables, OAuth scopes, security constraints, and credential management.

**Date**: 2024-12-19  
**Task**: TASK-EML-002

---

## 1. Credential Mechanism

### 1.1 Chosen Approach: OAuth 2.0 Refresh Token

**Decision**: Use OAuth 2.0 with refresh tokens for Gmail authentication.

**Rationale**:
- **User Consent**: OAuth allows users to grant specific permissions (scopes) to the application
- **Token Refresh**: Refresh tokens enable long-lived access without re-authentication
- **Revocable**: Users can revoke access at any time via Google Account settings
- **Standard**: OAuth 2.0 is the standard authentication method for Gmail API
- **Flexibility**: Supports both personal and workspace Gmail accounts

### 1.2 Alternative: Service Account (Not Chosen)

Service accounts are an alternative approach but were not chosen because:
- **Domain-Wide Delegation Required**: Service accounts require domain-wide delegation for Gmail access, which is complex to set up
- **Workspace-Only**: Service accounts work best with Google Workspace, not personal Gmail accounts
- **Less Flexible**: Cannot easily switch between different Gmail accounts

**Note**: Service account support can be added later if needed for enterprise deployments.

---

## 2. Environment Variables

### 2.1 Required Environment Variables

The following environment variables are **required** for Gmail MCP integration:

#### `GMAIL_CLIENT_ID`
- **Type**: String
- **Required**: Yes
- **Description**: OAuth 2.0 client ID from Google Cloud Console
- **Format**: String (e.g., `123456789-abcdefghijklmnop.apps.googleusercontent.com`)
- **Example**: `GMAIL_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com`
- **Where to Get**: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
- **Security**: Must not be hard-coded in source code; store in `.env` or secret manager

#### `GMAIL_CLIENT_SECRET`
- **Type**: String
- **Required**: Yes
- **Description**: OAuth 2.0 client secret from Google Cloud Console
- **Format**: String (e.g., `GOCSPX-abcdefghijklmnopqrstuvwxyz`)
- **Example**: `GMAIL_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz`
- **Where to Get**: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID → Download JSON or copy secret
- **Security**: **CRITICAL SECRET** - Must not be hard-coded, logged, or committed to version control

#### `GMAIL_REFRESH_TOKEN`
- **Type**: String
- **Required**: Yes
- **Description**: OAuth 2.0 refresh token obtained after initial user consent
- **Format**: String (long random token)
- **Example**: `GMAIL_REFRESH_TOKEN=1//0abcdefghijklmnopqrstuvwxyz-1234567890`
- **Where to Get**: Generated during OAuth consent flow (see Section 5: Obtaining Credentials)
- **Security**: **CRITICAL SECRET** - Must not be hard-coded, logged, or committed to version control
- **Rotation**: Refresh tokens can be revoked and regenerated; see Section 6.3 for rotation procedures

### 2.2 Optional Environment Variables

The following environment variables are **optional** and provide additional configuration:

#### `GMAIL_USER_EMAIL`
- **Type**: String
- **Required**: No
- **Description**: Target Gmail account email address (useful when multiple accounts are configured)
- **Format**: Valid email address
- **Example**: `GMAIL_USER_EMAIL=user@example.com`
- **Use Case**: When OAuth credentials are configured for a specific account, this helps identify which account is being accessed
- **Default**: If not set, Gmail MCP server will use the account associated with the refresh token

#### `GMAIL_ALLOWED_LABELS`
- **Type**: Comma-separated string
- **Required**: No
- **Description**: Restrict Gmail MCP operations to specific labels (for security/scope limiting)
- **Format**: Comma-separated list of Gmail labels
- **Example**: `GMAIL_ALLOWED_LABELS=INBOX,SENT,IMPORTANT`
- **Use Case**: Limit access to specific labels to reduce risk of accessing sensitive emails
- **Default**: If not set, all labels are accessible (subject to OAuth scope permissions)
- **Note**: This is a Gmail MCP server feature; verify the chosen MCP server supports this option

---

## 3. OAuth Scopes

### 3.1 Required Scopes

The following OAuth scopes are required for Gmail MCP operations:

#### `https://www.googleapis.com/auth/gmail.readonly`
- **Purpose**: Read-only access to Gmail messages and metadata
- **Operations Enabled**:
  - List messages
  - Read message content
  - Read message metadata (headers, labels, etc.)
  - Search messages
- **Rationale**: Essential for reading and summarizing emails
- **Security**: Read-only scope minimizes risk of accidental modifications

#### `https://www.googleapis.com/auth/gmail.send`
- **Purpose**: Send emails on behalf of the user
- **Operations Enabled**:
  - Send emails
  - Draft emails (if supported by MCP server)
- **Rationale**: Required for drafting and sending email replies
- **Security**: Allows sending emails; use with caution

### 3.2 Optional Scopes

The following scopes are optional and may be needed for advanced features:

#### `https://www.googleapis.com/auth/gmail.modify`
- **Purpose**: Modify Gmail messages (label, archive, delete)
- **Operations Enabled**:
  - Add/remove labels
  - Archive messages
  - Delete messages
  - Mark as read/unread
- **Rationale**: Needed for auto-categorization and tagging features
- **Security**: **Higher Risk** - Allows modification of emails; only enable if needed
- **Recommendation**: Start with read-only and send scopes; add modify scope only if auto-categorization is required

### 3.3 Least-Privilege Approach

**Principle**: Request only the minimum scopes required for the intended functionality.

**Recommended Scope Set** (for initial implementation):
- `gmail.readonly` - Required for reading emails
- `gmail.send` - Required for sending replies

**Extended Scope Set** (if auto-categorization is needed):
- `gmail.readonly` - Required for reading emails
- `gmail.send` - Required for sending replies
- `gmail.modify` - Required for labeling and archiving

**Security Best Practice**: Start with the minimal scope set and add additional scopes only when specific features require them.

---

## 4. Where Environment Variables Must Be Set

### 4.1 Local Development

**Location**: `.env` file in `cursor-runner` directory

**Setup Steps**:
1. Copy `.env.example` to `.env`: `cp .env.example .env`
2. Add Gmail environment variables to `.env`:
   ```bash
   GMAIL_CLIENT_ID=your-client-id
   GMAIL_CLIENT_SECRET=your-client-secret
   GMAIL_REFRESH_TOKEN=your-refresh-token
   ```
3. Ensure `.env` is in `.gitignore` (should already be ignored)

**Reference**: `cursor-runner/.env.example` (will be updated in this task)

### 4.2 Docker Compose

**Location**: `cursor-runner/docker-compose.yml` (environment section)

**Setup Steps**:
1. Add Gmail environment variables to `docker-compose.yml`:
   ```yaml
   environment:
     - GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID:-}
     - GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET:-}
     - GMAIL_REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN:-}
   ```
2. Set variables in `.env` file (same as local development)
3. Docker Compose will read from `.env` and pass to container

**Reference**: `cursor-runner/docker-compose.yml` (will be updated in TASK-EML-005)

### 4.3 Production

**Location**: Secret manager or environment variable configuration system

**Options**:
1. **Docker Secrets**: If using Docker Swarm, use Docker secrets
2. **Kubernetes Secrets**: If using Kubernetes, use Kubernetes secrets
3. **Cloud Secret Managers**: AWS Secrets Manager, Google Secret Manager, Azure Key Vault
4. **Environment Variables**: Set in container orchestration platform (e.g., Docker Compose production config)

**Security Requirements**:
- **Never commit secrets to version control**
- **Use secret managers for production**
- **Rotate secrets regularly** (see Section 6.3)
- **Limit access** to secrets (principle of least privilege)

---

## 5. Obtaining Credentials

### 5.1 Google Cloud Console Setup

1. **Create/Select Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Gmail API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Gmail API"
   - Click "Enable"

3. **Create OAuth 2.0 Credentials**:
   - Navigate to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Select "Web application" as application type
   - Configure OAuth consent screen (if not already done):
     - User Type: External (for personal Gmail) or Internal (for Workspace)
     - App name, support email, developer contact
   - Add authorized redirect URIs (if using OAuth flow):
     - For MCP server: typically `http://localhost:PORT/callback` or similar
     - Check Gmail MCP server documentation for exact redirect URI

4. **Download Credentials**:
   - After creating OAuth client, download the JSON file or copy:
     - Client ID
     - Client Secret

### 5.2 Obtaining Refresh Token

The refresh token is obtained through the OAuth consent flow:

1. **OAuth Consent Flow**:
   - Use Google OAuth 2.0 Playground or implement OAuth flow
   - Request the required scopes (see Section 3)
   - Complete user consent
   - Exchange authorization code for access token and refresh token

2. **Using OAuth 2.0 Playground** (easiest method):
   - Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
   - Click gear icon → Check "Use your own OAuth credentials"
   - Enter Client ID and Client Secret
   - Select Gmail API scopes (see Section 3)
   - Click "Authorize APIs"
   - Complete consent flow
   - Click "Exchange authorization code for tokens"
   - Copy the "Refresh token" value

3. **Alternative: Gmail MCP Server Tools**:
   - Some Gmail MCP servers provide tools to obtain refresh tokens
   - Check Gmail MCP server documentation for specific instructions

### 5.3 Service Account Setup (Alternative - Not Recommended for Initial Implementation)

If using service accounts (not recommended for initial implementation):

1. **Create Service Account**:
   - Google Cloud Console → IAM & Admin → Service Accounts
   - Create service account
   - Download JSON key file

2. **Enable Domain-Wide Delegation** (Workspace only):
   - Enable domain-wide delegation in service account
   - Configure OAuth scopes in Google Workspace Admin Console

3. **Set Environment Variable**:
   - `GMAIL_SERVICE_ACCOUNT_KEY`: Path to service account JSON file or JSON content

**Note**: Service account setup is complex and workspace-specific. OAuth refresh token is recommended for initial implementation.

---

## 6. Security Constraints

### 6.1 Secret Management

**CRITICAL RULES**:
1. **Never hard-code secrets** in source code
2. **Never commit secrets** to version control
3. **Never log secrets** in application logs
4. **Use environment variables** or secret managers
5. **Rotate secrets regularly** (see Section 6.3)

### 6.2 Least-Privilege Principle

**OAuth Scopes**:
- Request only the minimum scopes required
- Start with `gmail.readonly` and `gmail.send`
- Add `gmail.modify` only if auto-categorization is needed

**Gmail Labels** (if supported):
- Use `GMAIL_ALLOWED_LABELS` to restrict access to specific labels
- Limit access to non-sensitive labels when possible

**Access Control**:
- Limit who can configure Gmail credentials
- Use secret managers with access controls in production
- Audit access to Gmail credentials

### 6.3 Token Rotation

**Refresh Token Rotation**:
1. **When to Rotate**:
   - If refresh token is compromised
   - Periodically (e.g., every 90 days) as security best practice
   - If user revokes access and re-grants

2. **How to Rotate**:
   - Revoke old refresh token (via Google Account settings or API)
   - Complete OAuth consent flow again (see Section 5.2)
   - Update `GMAIL_REFRESH_TOKEN` environment variable
   - Restart cursor-runner service

3. **Automation** (Future Enhancement):
   - Monitor refresh token expiration
   - Automatically prompt for re-authentication
   - Update credentials without service interruption

### 6.4 Revocation Procedures

**User Revocation**:
- Users can revoke access via [Google Account Settings](https://myaccount.google.com/permissions)
- Revocation takes effect immediately
- Gmail MCP operations will fail with authentication errors

**Emergency Revocation**:
1. **Remove Environment Variables**:
   - Remove `GMAIL_*` environment variables from `.env` or secret manager
   - Restart cursor-runner service

2. **Disable Gmail MCP** (if feature flag exists):
   - Set `ENABLE_GMAIL_MCP=false`
   - Restart cursor-runner service

3. **Remove MCP Config** (if needed):
   - Remove `gmail` entry from `mcp.json`
   - Restart cursor-runner service

4. **Verify Revocation**:
   - Check that Gmail MCP tools are no longer available
   - Verify no Gmail operations are being performed

**Reference**: See TASK-EML-011 for feature flag implementation.

---

## 7. Validation Rules

### 7.1 Environment Variable Validation

**Client ID**:
- Format: Should match pattern `*.apps.googleusercontent.com` or be a valid OAuth client ID
- Length: Typically 50-100 characters
- Validation: Check that it's not empty and contains valid characters

**Client Secret**:
- Format: Should match pattern `GOCSPX-*` (for Google OAuth) or be a valid OAuth client secret
- Length: Typically 20-50 characters
- Validation: Check that it's not empty

**Refresh Token**:
- Format: Long random string, typically starts with `1//` or similar
- Length: Typically 50-200 characters
- Validation: Check that it's not empty

**User Email** (if provided):
- Format: Valid email address format
- Validation: Use email regex validation

**Allowed Labels** (if provided):
- Format: Comma-separated list of valid Gmail label names
- Validation: Check that labels don't contain invalid characters

### 7.2 Implementation in system-settings.ts

If validation is needed, add to `cursor-runner/src/system-settings.ts`:

```typescript
/**
 * Get Gmail client ID from environment
 */
export function getGmailClientId(): string | undefined {
  return process.env.GMAIL_CLIENT_ID;
}

/**
 * Get Gmail client secret from environment
 */
export function getGmailClientSecret(): string | undefined {
  return process.env.GMAIL_CLIENT_SECRET;
}

/**
 * Get Gmail refresh token from environment
 */
export function getGmailRefreshToken(): string | undefined {
  return process.env.GMAIL_REFRESH_TOKEN;
}

/**
 * Validate Gmail configuration
 * @returns Object with validation result and missing variables
 */
export function validateGmailConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  
  if (!process.env.GMAIL_CLIENT_ID) {
    missing.push('GMAIL_CLIENT_ID');
  }
  if (!process.env.GMAIL_CLIENT_SECRET) {
    missing.push('GMAIL_CLIENT_SECRET');
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    missing.push('GMAIL_REFRESH_TOKEN');
  }
  
  return {
    valid: missing.length === 0,
    missing,
  };
}
```

**Note**: Validation in `system-settings.ts` is optional. The Gmail MCP server will validate credentials when it attempts to connect. However, startup validation can provide early feedback if credentials are missing.

---

## 8. Summary

### 8.1 Required Configuration

**Environment Variables** (Required):
- `GMAIL_CLIENT_ID` - OAuth client ID
- `GMAIL_CLIENT_SECRET` - OAuth client secret
- `GMAIL_REFRESH_TOKEN` - OAuth refresh token

**OAuth Scopes** (Minimum):
- `https://www.googleapis.com/auth/gmail.readonly` - Read emails
- `https://www.googleapis.com/auth/gmail.send` - Send emails

**Optional**:
- `GMAIL_USER_EMAIL` - Target account email
- `GMAIL_ALLOWED_LABELS` - Label restrictions

### 8.2 Security Checklist

- [ ] Secrets are stored in `.env` (local) or secret manager (production)
- [ ] Secrets are never committed to version control
- [ ] Secrets are never logged
- [ ] OAuth scopes follow least-privilege principle
- [ ] Token rotation procedures are documented
- [ ] Revocation procedures are documented
- [ ] Access to secrets is limited (principle of least privilege)

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19  
**Next Steps**: 
- TASK-EML-003: Add Gmail MCP dependency
- TASK-EML-005: Wire Gmail env vars into cursor-runner

