# Jibble API docs lookup notes

## Access attempt

Attempted to fetch `https://docs.api.jibble.io/#1a15bb81-b2a0-41d3-bfee-bf52382d6988` with curl, but the request failed with a `403` CONNECT tunnel error. This prevented directly reading the linked documentation in this environment.

## Likely issue based on current behavior

Given the UI is returning `unauthorized`, the most probable causes are:
- The API key ID/secret pair is incorrect, swapped, or includes whitespace.
- The key exists but lacks permissions to list people (admin scope required in many systems).
- The Jibble API expects a specific authorization header format for the API key that differs by account/region.

Because the documentation could not be fetched from this environment, these are informed inferences rather than confirmed by the docs.
