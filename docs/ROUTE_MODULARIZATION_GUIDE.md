# Route Modularization Guide

## Status

Phase 2 of the architecture overhaul is in progress. The route modularization requires careful extraction of routes from the 12,444-line `server/routes.ts` file.

## Approach

Due to the massive size of `routes.ts`, modularization will be done incrementally:

1. **Create module structure** - ✅ Done
2. **Extract routes by category** - In progress
3. **Update routes.ts to import from modules** - Pending
4. **Test each module** - Pending
5. **Remove old routes from routes.ts** - Pending

## Module Structure

```
server/routes/
├── index.ts              (orchestrator - imports all modules)
├── auth.routes.ts        (authentication routes)
├── applications.routes.ts (application management)
├── users.routes.ts       (user management)
├── bookings.routes.ts    (booking system)
├── kitchens.routes.ts    (kitchen management)
├── payments.routes.ts    (payment processing)
├── admin.routes.ts       (admin endpoints)
├── manager.routes.ts     (manager endpoints)
├── chef.routes.ts        (chef endpoints)
├── files.routes.ts       (file uploads/downloads)
├── storage.routes.ts     (storage bookings)
├── equipment.routes.ts   (equipment bookings)
└── public.routes.ts      (public endpoints)
```

## Extraction Process

For each module:

1. Identify routes by URL pattern (e.g., `/api/applications/*`)
2. Extract route handlers and their dependencies
3. Create module file with proper imports
4. Export router from module
5. Import and mount in `routes/index.ts`
6. Test module works independently
7. Remove routes from original `routes.ts`

## Route Categories (from audit)

- **auth**: 9 routes (lines 116-1967)
- **applications**: 9 routes (lines 199-1393)
- **users**: 2 routes (lines 927-1017)
- **files**: 3 routes (lines 1024-1200)
- **admin**: 21 routes (lines 1974-10889)
- **public**: 11 routes (lines 2387-12107)
- **manager**: 59 routes (lines 3222-7205)
- **payments**: 6 routes (lines 3921+)
- **chef**: 16 routes
- **bookings**: 2 routes
- **kitchens**: 2 routes
- **other**: 17 routes (portal, microlearning, etc.)

## Next Steps

1. Extract `applications.routes.ts` (smallest, well-defined)
2. Extract `users.routes.ts` (simple)
3. Extract `files.routes.ts` (moderate complexity)
4. Continue with larger modules incrementally
5. Test after each extraction

## Notes

- Keep original `routes.ts` as backup until all modules extracted
- Test each module independently before removing from original
- Ensure middleware order is preserved
- Watch for shared helper functions that need to be extracted
