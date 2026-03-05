# Feature: User Authentication

Implement secure user authentication using JWT tokens.

## Auth Flow

Users authenticate via username/password and receive a JWT token.
The token is validated on each subsequent request by the auth middleware.

### Acceptance Criteria

- Must validate JWT token signature
- Should expire tokens after 24 hours
- Must hash passwords with bcrypt

## Token Refresh

Allow users to refresh expired tokens without re-authenticating.
