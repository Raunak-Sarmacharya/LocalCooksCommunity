# CP8: chef multi-day booking

Implementation in progress against the complete Oct 17 owner spec, build plan §7 and §8 CP8, and CP3/CP4 contracts.
The existing Date → Hours → Equipment → Confirm flow remains the composition root. The platform creation gate and
kitchen multi-day rule must both permit multiple selection. A single selected date retains the scalar checkout contract.

Scope: chef booking picker, dated confirmation and booking day list; kitchen/admin screens remain CP9. No push,
deployment, database migration or provider operation is authorized. Final verification is reserved until implementation
and tests are complete: the requested client suites, i18n lint, and one foreground full TypeScript invocation.
