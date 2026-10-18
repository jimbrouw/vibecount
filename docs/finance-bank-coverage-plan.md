# Finance bank coverage V3 implementation plan

Continue the approved foreign-source sequence. Reuse existing finance V1/V2 scenario and coverage contracts without rewriting their bytes. Foreign admission stays closed.

1. Add explicit V3 pure evaluator/preparer around unchanged manual GBP scenario arithmetic. Freeze complete invoice and owner-wide bank coverage. Unsupported/invalid accounts (including empty foreign accounts), unsupported active observations and missing active source closure/Storage metadata withhold effective free cash/drawings. Retain exact original/valuation context without converting it into account cash.
2. Extend saved replay with exact input/result version pairing. Switch current context readers, preview/save, forms, saved readback and exports to V3. Bind both coverage stamps and reset review on either changing. Preserve deadline obligations as explicit retained facts regardless of source-plan incompleteness.
3. Add ordered migration 77: copy current private V2 context; replace current OID in place, extend snapshot check, bind full bank coverage into current context stamp. Recover exact prior requests before new bounds/checks. Freeze complete inherited financial-review sources, excluding capture destination tables. Independently require exact coverage/stamps and incomplete/null effective amounts when blocked.
4. Verify old requests/bytes/grants, current SQL optimistic attacks/source scope, source/valuation capture ordering, two-owner destination safety, current server/UI reset and exports/deadline replay. Add synthetic demo; run focused and full automated/browser checks, lint/TS/build and anonymous smoke.

No bank connection, provider action, hosted migration or real financial approval is needed for this local increment. Remaining event-only guards, dimensioned standalone exports and the complete foreign workflow follow it.
