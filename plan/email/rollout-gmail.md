# Gmail MCP Rollout Plan

This document describes the rollout plan for Gmail MCP integration in the cursor-runner system, including phased deployment, feature flagging, and rollback procedures.

**Date**: 2024-12-19  
**Task**: TASK-EML-011

---

## 1. Feature Flag

### 1.1 Feature Flag Configuration

**Environment Variable**: `ENABLE_GMAIL_MCP`

**Default Value**: `false` (Gmail MCP disabled by default for safety)

**Accepted Values**:
- `true`, `1`, `yes`, `on` → Gmail MCP enabled
- `false`, `0`, `no`, `off`, or unset → Gmail MCP disabled

**Location**: 
- `.env` file (local development)
- `docker-compose.yml` (Docker environments)
- Secret manager (production)

### 1.2 How Feature Flag Works

The feature flag controls whether the Gmail MCP server entry is included in the merged MCP configuration:

1. **At Startup**: `merge-mcp-config.js` runs (via Docker entrypoint)
2. **Flag Check**: Script checks `ENABLE_GMAIL_MCP` environment variable
3. **Conditional Inclusion**: 
   - If `ENABLE_GMAIL_MCP=true` → Gmail entry is included in merged config
   - If `ENABLE_GMAIL_MCP=false` or unset → Gmail entry is excluded from merged config
4. **Config Location**: Merged config is written to `/root/.cursor/mcp.json` for cursor-cli

**Reference**: `merge-mcp-config.js` (lines 132-148)

---

## 2. Rollout Phases

### Phase 1: Development Environment

**Goal**: Enable Gmail MCP in development for testing and validation.

**Steps**:
1. **Set Feature Flag**:
   ```bash
   # In .env file
   ENAIL_GMAIL_MCP=true
   ```

2. **Configure Gmail Credentials**:
   ```bash
   # In .env file
   GMAIL_CLIENT_ID=your-dev-client-id
   GMAIL_CLIENT_SECRET=your-dev-client-secret
   GMAIL_REFRESH_TOKEN=your-dev-refresh-token
   ```

3. **Restart Service**:
   ```bash
   docker-compose restart cursor-runner
   ```

4. **Verify**:
   - Check logs for "Gmail MCP is enabled" message
   - Verify MCP config includes Gmail entry: `docker exec cursor-runner cat /root/.cursor/mcp.json | grep -A 10 gmail`
   - Run manual test with Gmail prompt

5. **Validation**:
   - ✅ Gmail MCP tools are available to cursor CLI
   - ✅ Gmail operations work correctly
   - ✅ No errors in logs

**Timeline**: 1-2 days for initial testing

**Success Criteria**:
- Gmail MCP is accessible
- Basic Gmail operations (list, read) work
- No critical errors

---

### Phase 2: Staging Environment

**Goal**: Validate Gmail MCP in staging environment with test Gmail account.

**Prerequisites**:
- ✅ Phase 1 completed successfully
- ✅ Test Gmail account configured with OAuth credentials

**Steps**:
1. **Set Feature Flag in Staging**:
   ```bash
   # In staging .env or docker-compose override
   ENABLE_GMAIL_MCP=true
   ```

2. **Configure Test Gmail Credentials**:
   - Use dedicated test Gmail account (not production)
   - Configure OAuth credentials for test account
   - Set `GMAIL_*` environment variables

3. **Deploy to Staging**:
   ```bash
   # Deploy updated cursor-runner with feature flag enabled
   docker-compose up -d cursor-runner
   ```

4. **Run Integration Tests**:
   - Run automated integration tests (TASK-EML-008)
   - Run smoke test (TASK-EML-009) if available
   - Manual testing of Gmail flows

5. **Monitor**:
   - Check logs for errors
   - Monitor Gmail API usage
   - Verify authentication works

6. **Validation**:
   - ✅ All integration tests pass
   - ✅ Smoke test passes
   - ✅ Gmail flows work end-to-end
   - ✅ No authentication errors
   - ✅ Performance is acceptable

**Timeline**: 3-5 days for thorough testing

**Success Criteria**:
- All tests pass
- Gmail operations are reliable
- No security or privacy issues
- Performance is acceptable

---

### Phase 3: Production Deployment

**Goal**: Enable Gmail MCP in production with controlled rollout.

**Prerequisites**:
- ✅ Phase 2 completed successfully
- ✅ Production Gmail account configured
- ✅ Monitoring and alerting configured
- ✅ Rollback plan ready

**Steps**:

#### 3.1 Initial Production Deployment (Feature Flag Off)

1. **Deploy with Feature Flag Disabled**:
   ```bash
   # In production .env or secret manager
   ENABLE_GMAIL_MCP=false  # Default, explicitly set for clarity
   ```

2. **Deploy Updated Code**:
   - Deploy cursor-runner with Gmail MCP code (but disabled)
   - Verify service starts successfully
   - Verify no Gmail MCP entry in config

3. **Verify Deployment**:
   - Check logs for successful startup
   - Verify Gmail MCP is not in MCP config
   - Verify no Gmail-related errors

#### 3.2 Enable Gmail MCP (When Ready)

1. **Set Feature Flag to Enabled**:
   ```bash
   # In production .env or secret manager
   ENABLE_GMAIL_MCP=true
   ```

2. **Configure Production Gmail Credentials**:
   - Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
   - Use production Gmail account
   - Verify credentials are correct

3. **Restart Service**:
   ```bash
   # Restart to pick up new env vars
   docker-compose restart cursor-runner
   # or
   systemctl restart cursor-runner
   ```

4. **Verify**:
   - Check logs for "Gmail MCP is enabled" message
   - Verify MCP config includes Gmail entry
   - Run smoke test (if available)

5. **Monitor**:
   - Monitor logs for errors
   - Monitor Gmail API usage
   - Watch for authentication failures
   - Track Gmail MCP operation success rate

6. **Gradual Rollout** (Optional):
   - Start with limited usage
   - Monitor for issues
   - Gradually increase usage
   - Full rollout when stable

**Timeline**: 1-2 weeks for production validation

**Success Criteria**:
- Gmail MCP is stable in production
- No critical errors
- Performance is acceptable
- User satisfaction

---

## 3. Per-Environment Configuration

### 3.1 Development Environment

**Configuration**:
```yaml
# docker-compose.yml or .env
ENABLE_GMAIL_MCP=true  # Enabled by default for developers
GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID:-}
GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET:-}
GMAIL_REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN:-}
```

**Rationale**: Developers need Gmail MCP enabled for testing and development.

### 3.2 Staging Environment

**Configuration**:
```yaml
# docker-compose.yml or .env
ENABLE_GMAIL_MCP=true  # Enabled with test credentials
GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID:-}  # Test account credentials
GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET:-}
GMAIL_REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN:-}
```

**Rationale**: Staging should mirror production but use test Gmail account.

### 3.3 Production Environment

**Configuration**:
```yaml
# docker-compose.yml or secret manager
ENABLE_GMAIL_MCP=false  # Default: disabled until ready
GMAIL_CLIENT_ID=${GMAIL_CLIENT_ID:-}  # Production credentials (when enabled)
GMAIL_CLIENT_SECRET=${GMAIL_CLIENT_SECRET:-}
GMAIL_REFRESH_TOKEN=${GMAIL_REFRESH_TOKEN:-}
```

**Rationale**: Production starts with feature disabled for safety. Enable when ready.

---

## 4. Rollback Procedures

### 4.1 Quick Rollback (Feature Flag)

**Method**: Disable feature flag

**Steps**:
1. **Set Feature Flag to Disabled**:
   ```bash
   # In .env or secret manager
   ENABLE_GMAIL_MCP=false
   ```

2. **Restart Service**:
   ```bash
   docker-compose restart cursor-runner
   # or
   systemctl restart cursor-runner
   ```

3. **Verify**:
   - Check logs for "Gmail MCP is disabled" message
   - Verify Gmail entry is removed from MCP config
   - Verify no Gmail operations are being performed

**Time to Rollback**: < 5 minutes

**Effect**: 
- ✅ Gmail MCP is immediately disabled
- ✅ Gmail tools are no longer available
- ✅ No code changes needed

### 4.2 Complete Rollback (Remove Credentials)

**Method**: Remove Gmail environment variables

**Steps**:
1. **Remove Gmail Environment Variables**:
   ```bash
   # Remove from .env or secret manager
   # GMAIL_CLIENT_ID=...
   # GMAIL_CLIENT_SECRET=...
   # GMAIL_REFRESH_TOKEN=...
   ```

2. **Restart Service**:
   ```bash
   docker-compose restart cursor-runner
   ```

3. **Verify**:
   - Check logs for Gmail config warnings
   - Verify Gmail MCP cannot authenticate
   - Verify no Gmail operations succeed

**Time to Rollback**: < 5 minutes

**Effect**: 
- ✅ Gmail MCP cannot authenticate
- ✅ All Gmail operations fail
- ✅ Complete removal of Gmail access

### 4.3 Code Rollback (If Needed)

**Method**: Revert to previous code version

**Steps**:
1. **Revert Code**:
   ```bash
   git revert <commit-hash>
   # or
   git checkout <previous-version>
   ```

2. **Rebuild and Redeploy**:
   ```bash
   docker-compose build cursor-runner
   docker-compose up -d cursor-runner
   ```

3. **Verify**:
   - Check logs for successful startup
   - Verify Gmail MCP code is removed
   - Verify system works without Gmail MCP

**Time to Rollback**: 10-15 minutes

**Effect**: 
- ✅ Complete removal of Gmail MCP code
- ✅ System returns to pre-Gmail state

---

## 5. Verification Steps

### 5.1 Verify Feature Flag is Working

**Check Feature Flag Value**:
```bash
# In container
docker exec cursor-runner env | grep ENABLE_GMAIL_MCP

# Expected: ENABLE_GMAIL_MCP=true (if enabled) or not set (if disabled)
```

**Check MCP Config**:
```bash
# In container
docker exec cursor-runner cat /root/.cursor/mcp.json | grep -A 10 gmail

# If enabled: Should show gmail entry
# If disabled: Should not show gmail entry (or entry is absent)
```

**Check Logs**:
```bash
# Check startup logs
docker logs cursor-runner | grep -i gmail

# Expected messages:
# - "Gmail MCP is enabled" (if enabled)
# - "Gmail MCP is disabled" (if disabled)
# - "Gmail MCP configuration is complete" (if enabled and configured)
```

### 5.2 Verify Gmail MCP is Accessible

**Test Gmail MCP Tools** (if enabled):
```bash
# This would require cursor CLI to list tools
# In practice, test via integration tests or manual prompts
```

**Check for Errors**:
```bash
# Check logs for Gmail-related errors
docker logs cursor-runner | grep -i "gmail.*error\|gmail.*fail"
```

---

## 6. Monitoring Recommendations

### 6.1 Key Metrics to Monitor

**Gmail MCP Availability**:
- Gmail MCP server connection status
- Gmail MCP tool availability
- MCP config includes/excludes Gmail entry

**Gmail API Usage**:
- Gmail API request count
- Gmail API error rate
- Gmail API response times

**Authentication**:
- Gmail authentication success rate
- Refresh token expiration warnings
- OAuth token refresh failures

**Operations**:
- Gmail operation success rate
- Gmail operation latency
- Error types and frequencies

### 6.2 Recommended Alerts

**Critical Alerts**:
- Multiple consecutive Gmail authentication failures
- Gmail MCP server unavailable
- Gmail API rate limit exceeded

**Warning Alerts**:
- Gmail MCP configuration incomplete (when enabled)
- Gmail operation errors increasing
- Gmail API response times increasing

### 6.3 Monitoring Tools

**Logs**:
- Application logs: `logs/cursor-runner.log`
- Docker logs: `docker logs cursor-runner`
- System logs: `/var/log/syslog` (if applicable)

**Metrics** (if available):
- Prometheus metrics (if instrumented)
- Application performance monitoring (APM)
- Gmail API usage dashboard

---

## 7. Troubleshooting

### 7.1 Gmail MCP Not Available

**Symptoms**: Gmail tools are not available to cursor CLI

**Possible Causes**:
1. Feature flag is disabled (`ENABLE_GMAIL_MCP=false` or unset)
2. MCP config merge failed
3. Gmail MCP server not installed

**Solutions**:
1. Check feature flag: `env | grep ENABLE_GMAIL_MCP`
2. Check MCP config: `cat /root/.cursor/mcp.json | grep gmail`
3. Check Gmail MCP installation: `mcp-server-gmail --version`
4. Check merge script logs: `docker logs cursor-runner | grep -i mcp`

### 7.2 Gmail Authentication Failures

**Symptoms**: Gmail operations fail with authentication errors

**Possible Causes**:
1. Missing or invalid Gmail credentials
2. Refresh token expired or revoked
3. OAuth scopes insufficient

**Solutions**:
1. Verify credentials are set: `env | grep GMAIL`
2. Check credential validity
3. Regenerate refresh token if needed
4. Verify OAuth scopes in Google Cloud Console

### 7.3 Gmail MCP Enabled But Not Working

**Symptoms**: Feature flag is enabled but Gmail operations fail

**Possible Causes**:
1. Gmail credentials not configured
2. Gmail MCP server not accessible
3. Network issues

**Solutions**:
1. Check Gmail config validation: Look for warnings in logs
2. Verify Gmail MCP server is installed and on PATH
3. Check network connectivity to Gmail API
4. Review error logs for specific failure reasons

---

## 8. Summary

### 8.1 Rollout Checklist

**Before Production**:
- [ ] Phase 1 (Development) completed successfully
- [ ] Phase 2 (Staging) completed successfully
- [ ] Integration tests pass
- [ ] Security review completed
- [ ] Monitoring configured
- [ ] Rollback plan tested
- [ ] Documentation complete

**Production Deployment**:
- [ ] Deploy with feature flag disabled
- [ ] Verify deployment successful
- [ ] Enable feature flag when ready
- [ ] Configure production Gmail credentials
- [ ] Restart service
- [ ] Verify Gmail MCP is working
- [ ] Monitor for issues
- [ ] Document any issues or learnings

### 8.2 Success Criteria

**Phase 1 (Development)**:
- ✅ Gmail MCP is accessible
- ✅ Basic Gmail operations work
- ✅ No critical errors

**Phase 2 (Staging)**:
- ✅ All tests pass
- ✅ Gmail flows work end-to-end
- ✅ Performance is acceptable

**Phase 3 (Production)**:
- ✅ Gmail MCP is stable
- ✅ No critical errors
- ✅ User satisfaction

---

**Document Status**: Complete  
**Last Updated**: 2024-12-19  
**Next Review**: After production deployment or significant changes

**Related Documents**:
- `config.md` - Gmail configuration contract
- `security-privacy-gmail.md` - Security and privacy review

