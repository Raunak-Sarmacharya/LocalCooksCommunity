---
type: "query"
date: "2026-09-15T12:09:36.947841+00:00"
question: "when i try registering with google, the firebase autheticated list gets created for a new user, but its not written on firestore and on neon database. there is an inconsistency with my register with google flow."
contributor: "graphify"
outcome: "useful"
source_nodes: ["syncUserWithBackend()", "EnhancedRegisterForm.tsx", "firebase-user-sync.ts"]
---

# Q: when i try registering with google, the firebase autheticated list gets created for a new user, but its not written on firestore and on neon database. there is an inconsistency with my register with google flow.

## Answer

Expanded from original query via graph vocab: [auth, firebase, firestore, google, neon, register, registration, sync, user, profile]. The Google registration path created Firebase Auth before mandatory phone verification, while Firestore mirroring lived only in two later client branches and the Google phone-link branch called only backend sync. Registration persistence is now centralized in syncUserWithBackend: Neon must accept POST /api/firebase-register-user before the Firestore users/{uid} mirror is written. New Google identities are marked while phone verification is pending and are deleted on cancel or provisioning failure; pre-existing interrupted identities are signed out for retry.

## Outcome

- Signal: useful

## Source Nodes

- syncUserWithBackend()
- EnhancedRegisterForm.tsx
- firebase-user-sync.ts