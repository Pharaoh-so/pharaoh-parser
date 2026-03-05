# Project Overview

This is a test project for the Pharaoh auto-vision system.

## Router Module

The router handles incoming requests and dispatches them to the correct handler.
Routes are defined as Express middleware.

### Acceptance Criteria

- Must support GET, POST, PUT, DELETE methods
- Should validate request bodies before routing
- Must return 404 for unknown routes

## Services Layer

The services module contains business logic for data processing and validation.

### Requirements

- Must handle async operations
- Should implement retry logic for external calls

## Table of Contents

This section should be skipped by the parser.
