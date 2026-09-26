# Chef Application — Intended Rules

> Short spec for the chef application flow, written so the rules stop being tribal
> knowledge. Scope: step 1 (initial request), step 2 (kitchen documents), the custom
> questions on both, and where a chef can see what they submitted.
>
> Status: **agreed rules** below are confirmed by the product owner. The three items in
> "Open questions" are still unresolved and must not be assumed either way.

## 1. Ownership

| Stage | Owner | What they control |
| --- | --- | --- |
| **Step 1 — Initial request** | **Local Cooks admin** | Which questions are asked, which are required, and any custom questions |
| **Step 2 — Chef Application Requirements** (kitchen documents) | **Kitchen manager** | Which uploads are compulsory, and any custom questions |

There is no overlap. The admin's set drives step 1 only; the kitchen's set drives step 2
only. A question is never configured in both places, so no precedence rule is needed.

Step 1 is reviewed by Local Cooks admins. Step 2 is reviewed by the kitchen.

## 2. Where answers are stored

| What | Where |
| --- | --- |
| Step 1 built-in answers | Columns on `chef_kitchen_applications`; free text grouped into `business_description` as JSON |
| Step 1 custom answers | `custom_fields_data` (jsonb), keyed by the field's **id** |
| Step 2 built-in documents | Columns, plus `tier_data.tierFiles` for the insurance document |
| Step 2 custom answers | `tier_data.tier2_custom_fields_data` (jsonb), keyed by the field's **id** |

A custom question of type file/large-file stores the **uploaded URL** in place of the
answer, so the stored value is a link, not a filename.

## 3. Custom questions

Available types: text, textarea, number, dropdown, checkbox group, single checkbox,
date, file, large file.

- **Required** — the chef cannot submit until it is answered.
- **Optional** — never blocks submission.
- **Single checkbox** — the value is `true` when checked and `false` when unchecked.
- **File / large file** — when required, the upload must complete before submit is allowed.
- **No conditional rules** — there are no "required only if another answer is X" rules.
- A chef **cannot edit** an application after submitting it.
- A question added **after** a chef submitted does not affect that chef's application.
- **Answers are never deleted** when a question is removed from the configuration.
- Required-ness is enforced **in the browser and on the server**. A required question
  cannot be submitted empty even if the browser check is bypassed.
- On failure the chef sees an **inline error under the field** and the page **scrolls to
  that field**.

## 4. What a chef can see in their own application

Every document the chef uploaded must be visible **and openable** from their own
application details — including:

- the food safety certificate,
- the food establishment licence,
- the **insurance document**,
- any file uploaded through a custom question.

Read-only: the chef cannot edit anything from the details view.

## 5. Navigation

- "View details" for a kitchen application opens the **My Kitchen Applications** tab.
- The details **Sheet** in the My Application tab is removed.
- "View details" continues to appear in exactly the same places as today — when it shows
  does not change.
- Inside the My Kitchen Applications tab the existing inline expand is unchanged.

## 6. Open questions (do not assume)

1. **Does the "My Application" nav item remain?** Only its details Sheet is being removed;
   it is unclear whether the item itself stays.
2. **Required single checkbox** — does required mean it *must be checked*, or does a
   checkbox always have a valid value and therefore never block?
3. **Answers to a deleted question.** Stored answers are keyed by field id and carry no
   label, so a question removed from the configuration can no longer be named in the
   details view. Options: (a) show answers only for questions still configured, (b) store
   the label alongside the answer from now on and humanise the id for older rows,
   (c) show the raw field id.
