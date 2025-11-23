# Test Completion Checklist

Use this checklist to verify test completion for each development task.

## Pre-Implementation Checklist

- [ ] Test requirements identified
- [ ] Test strategy planned (unit, integration, API, etc.)
- [ ] Test data/fixtures identified
- [ ] Mocking strategy defined

## Test Implementation Checklist

### Unit Tests
- [ ] All new functions have unit tests
- [ ] All new classes have unit tests
- [ ] All public methods are tested
- [ ] Private methods tested indirectly or explicitly
- [ ] Test names are descriptive and follow naming conventions
- [ ] Tests follow AAA pattern (Arrange-Act-Assert)

### Integration Tests
- [ ] Service interactions have integration tests
- [ ] Database operations tested (if applicable)
- [ ] External API integrations tested with mocks
- [ ] Error scenarios covered in integration tests

### API Tests (if applicable)
- [ ] All new endpoints have API tests
- [ ] Request validation tested
- [ ] Response format tested
- [ ] Error responses tested
- [ ] Authentication/authorization tested (if applicable)

### Error Handling
- [ ] Error conditions tested
- [ ] Exception handling tested
- [ ] Error messages validated
- [ ] Edge cases covered

### Test Quality
- [ ] Tests are independent and isolated
- [ ] Tests use proper mocking for external dependencies
- [ ] Test data setup is clean and reusable
- [ ] No hardcoded values that should be configurable
- [ ] Tests are maintainable and readable

## Post-Implementation Checklist

- [ ] All tests passing (`npm test`)
- [ ] Test coverage meets minimum (80%)
- [ ] Coverage report reviewed
- [ ] Test files follow project structure
- [ ] Tests documented if complex
- [ ] CI tests passing (`npm run ci`)

## Coverage Analysis

- [ ] Coverage percentage: _____%
- [ ] Coverage meets minimum requirement (80%)
- [ ] Critical paths have 100% coverage
- [ ] Coverage gaps identified and documented
- [ ] Coverage report reviewed and approved

## Final Verification

- [ ] All checklist items completed
- [ ] Code review completed (if applicable)
- [ ] Tests reviewed by team (if applicable)
- [ ] Status updated in status.json
- [ ] Ready for deployment

---

**Notes:**
- Mark items as complete by checking the box: `[x]`
- Add notes for any items that need clarification
- Update status.json after completing checklist

