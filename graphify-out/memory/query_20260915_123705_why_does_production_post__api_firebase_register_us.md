---
type: "query"
date: "2026-09-15T12:37:05.929452+00:00"
question: "Why does production POST /api/firebase-register-user return 401 Invalid token while /api/user/profile returns 404?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["server_firebase_setup_verifyfirebasetoken", "server_firebase_setup_initializefirebaseadmin", "server_firebase_auth_middleware_requirefirebaseauthwithuser", "server_routes_registerroutes"]
---

# Q: Why does production POST /api/firebase-register-user return 401 Invalid token while /api/user/profile returns 404?

## Answer

Expanded from original query via graph vocab: [auth, firebase, invalid, profile, register, registration, route, server, token, verify, verification]. The registration route calls verifyFirebaseToken(token, true). The dedicated firebase-token-verifier app is initialized only with projectId, not the configured service-account credential. Firebase Admin first verifies the JWT, then checkRevoked=true calls getUser(), which requires authenticated Admin API credentials. On Vercel the named verifier cannot use FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY merely because the default app has them, so verification throws and the wrapper returns null, producing 401 Invalid token before any SQL write. /api/user/profile calls verifyFirebaseToken(token) with checkRevoked=false, so signature verification succeeds, after which the missing SQL user correctly produces 404. Regression introduced by commit 1a38e22d.

## Outcome

- Signal: useful

## Source Nodes

- server_firebase_setup_verifyfirebasetoken
- server_firebase_setup_initializefirebaseadmin
- server_firebase_auth_middleware_requirefirebaseauthwithuser
- server_routes_registerroutes