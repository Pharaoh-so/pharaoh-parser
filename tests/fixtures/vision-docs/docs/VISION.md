<!-- vision-format: 1 -->

# Test Vision

## Routing

### Requests are validated before routing

All incoming requests pass through validation before being dispatched.

- MUST: Request bodies are validated
- TEST: tests/router/router.test.ts
