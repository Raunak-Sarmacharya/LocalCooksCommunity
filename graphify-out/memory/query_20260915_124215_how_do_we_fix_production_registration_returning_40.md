---
type: "query"
date: "2026-09-15T12:42:15.357408+00:00"
question: "How do we fix production registration returning 401 Invalid token without changing correct Firebase environment variables?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["server_firebase_setup_verifyfirebasetoken", "server_firebase_setup_initializefirebaseadmin", "server_firebase_auth_middleware_requirefirebaseauthwithuser", "server_routes_registerroutes"]
---

# Q: How do we fix production registration returning 401 Invalid token without changing correct Firebase environment variables?

## Answer

Expanded from original query via graph vocab: [admin, auth, credential, firebase, register, registration, server, token, verify, verification]. Updated verifyFirebaseToken so checkRevoked=true uses initializeFirebaseAdmin(), whose service-account credential supports the Firebase Admin getUser call required for revocation checks. Signature-only checks continue using initializeFirebaseTokenVerifier(). Added server/firebase-setup.test.ts proving both branches. Focused auth tests: 12/12 passed; full server suite: 123 passed with six unrelated legacy files rejected for containing no Vitest suite.

## Outcome

- Signal: useful

## Source Nodes

- server_firebase_setup_verifyfirebasetoken
- server_firebase_setup_initializefirebaseadmin
- server_firebase_auth_middleware_requirefirebaseauthwithuser
- server_routes_registerroutes