# Cleanup Checklist

## Files to Remove After Successful Migration

**⚠️ IMPORTANT: Only delete these files AFTER successful production deployment and 24-hour monitoring period.**

### Deprecated Build Files

- [ ] `api-build.mjs` - Replaced by unified `vercel-build.mjs`
- [ ] `scripts/sync-routes.js` - No longer needed (single source of truth)

### Auto-Generated Directories

- [ ] `api/server/*` - TypeScript compiled files (auto-generated, can be regenerated)
- [ ] `api/shared/*` - Auto-generated shared files (can be regenerated)

### Backup Files (Optional)

- [ ] `api/index.js.backup` - If created during migration
- [ ] `server/routes.ts.backup` - If created during modularization

## Pre-Deletion Checklist

Before deleting any files:

1. [ ] Vercel preview deployment successful
2. [ ] All routes tested and working
3. [ ] Production deployment successful
4. [ ] 24-hour monitoring period completed
5. [ ] Error rates < 0.1%
6. [ ] All critical flows verified
7. [ ] Team signoff received

## Deletion Commands

```bash
# After validation, run these commands:
rm api-build.mjs
rm scripts/sync-routes.js
rm -rf api/server
rm -rf api/shared

# Optional: Remove backups
rm -f api/index.js.backup
rm -f server/routes.ts.backup
```

## Rollback Plan

If issues are discovered after cleanup:

1. Restore from git history: `git checkout HEAD~1 -- api-build.mjs scripts/sync-routes.js`
2. Rebuild using old process temporarily
3. Investigate and fix issues
4. Re-attempt migration

## Notes

- Keep `api/index.js` until migration is fully validated (it's the production entry point)
- The new build process generates `api/index.js` from `server/index.ts`
- All routes are now in TypeScript source, no manual sync needed
