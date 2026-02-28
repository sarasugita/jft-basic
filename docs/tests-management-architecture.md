# Tests Management Architecture

## Scope

This phase adds the backend data model for a global, multi-school test system without replacing the current legacy runtime tables (`tests`, `questions`, `test_sessions`) yet.

The current app still depends heavily on the legacy tables. Replacing them in-place would be a breaking migration. To keep Phase 2 safe, the new architecture is introduced as a parallel shared-library layer that can be adopted incrementally by later admin and student flows.

## Core Decisions

### 1. `test_type` is a first-class enum

New shared-library tables use a database enum:

- `daily`
- `model`

This enum is stored directly on:

- `question_sets`
- `test_instances`
- `attempts` (new nullable compatibility column for future runtime/result linking)

`test_instances.test_type` is intentionally duplicated from `question_sets.test_type`.

Reason:

- analytics queries should not have to join back to raw questions
- school metrics can aggregate directly from assigned tests and linked results
- historical reporting stays stable even if question content evolves

### 2. Question content is separated from school usage

Two layers are introduced:

- `question_sets`: super-admin-owned reusable content library
- `test_instances`: school-owned assignments/schedules using a `question_set`

This keeps content global and usage school-scoped.

### 3. Restricted visibility uses a join table

`question_sets.visibility_scope` supports:

- `global`
- `restricted`

When restricted, allowed schools are stored in `question_set_school_access`.

Reason:

- one question set can be visible to many schools
- avoids copying content per school
- keeps authorization enforceable in SQL/RLS

### 4. Non-breaking question table naming

The requested design uses a `questions` table, but `public.questions` already exists and is tied to the legacy school-scoped test model.

To avoid breaking current admin/student flows, this phase introduces:

- `question_set_questions`

instead of replacing `public.questions`.

If the team later decides to fully migrate the runtime to the new architecture, the legacy table can be renamed and the shared-library question table can take the canonical `questions` name in a dedicated migration.

### 5. Results are linked to `test_instances`

Metrics must come from student results linked to school assignments, not raw content.

This phase adds nullable compatibility columns to `attempts`:

- `test_instance_id`
- `question_set_id`
- `test_type`

New runtime flows should populate `attempts.test_instance_id`. The DB then derives `question_set_id`, `test_type`, and `school_id` from the linked `test_instance`.

Legacy attempts continue to work unchanged.

## Table Relationships

`question_sets`

- created by `super_admin`
- owns many `question_set_questions`
- may be visible to all schools or a restricted subset

`question_set_school_access`

- maps restricted `question_sets` to allowed `schools`

`test_instances`

- belongs to one `school`
- references one reusable `question_set`
- stores scheduling/publication state
- stores `test_type` for analytics and historical stability

`attempts`

- should reference `test_instances.id` for new flows
- can then be aggregated per school and `test_type`

## Role Model

### Super Admin

- creates and edits `question_sets`
- manages `question_set_questions`
- grants restricted school access when needed
- can view all `test_instances` and cross-school analytics

### School Admin

- can only read question sets available to their school
- can only create/update/delete `test_instances` for their own school
- cannot mutate shared library content

### Student

- should only access published school-level assignments/results through runtime flows
- should not have direct access to the shared question bank tables in this phase

## Metrics Rules

For each school:

- attendance average remains unchanged
- daily test average = average of linked student result scores where `attempts.test_instance_id` joins to `test_instances` and `test_instances.test_type = 'daily'`
- model test average = same pattern where `test_instances.test_type = 'model'`

Important:

- metrics do not read raw questions
- metrics do not infer test type from question content
- metrics should use `score_rate` when present, otherwise `correct / total`

## Migration Strategy

Phase 2 delivers:

1. new shared-library tables
2. school-assignment tables
3. RLS/policies for super-admin vs school-admin responsibilities
4. attempt linkage columns for analytics compatibility
5. a school metrics view based on `test_instances` + `attempts`

Not included in this phase:

- major admin UI rebuild
- student runtime migration off legacy `tests` / `test_sessions`
- data backfill from legacy problem sets into `question_sets`
