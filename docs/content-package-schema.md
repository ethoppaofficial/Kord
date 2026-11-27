# Kord Course Content Package Schema (`v1.0`)

Version: `1.0`  
Package Type: `kord-course-content`  
Max Package Size: `5 MB`  
Max Lessons Per Import: `200`

This document defines the canonical JSON package format used by **Admin Content Management → Import / Export** for bulk lesson validation, dry-run preview, atomic import, course curriculum export, and snapshot recovery.

---

## 1. Root Package Envelope

```json
{
  "schemaVersion": "1.0",
  "packageType": "kord-course-content",
  "exportedAt": "2026-11-27T00:00:00.000Z",
  "course": {
    "id": "course-uuid-or-id",
    "slug": "course-slug",
    "title": "Course Title",
    "difficulty": "Beginner",
    "version": 1
  },
  "phases": [
    {
      "id": "phase-uuid-or-id",
      "position": 1,
      "title": "Module 1",
      "lessons": []
    }
  ]
}
```

### Root Field Rules
- **`schemaVersion`** *(required)*: Must equal `"1.0"`.
- **`packageType`** *(required)*: Must equal `"kord-course-content"`.
- **`course`** *(required)*: Must include `id` and/or `slug` matching the currently selected target course. Mismatches are strictly rejected during dry-run validation.
- **`phases`** *(required, or top-level `lessons` with per-lesson `phaseId`)*: Array of module sections targeting **existing** modules (`phases.id`) inside the target course. Bulk lesson import never silently creates modules or moves existing lessons across modules.

---

## 2. Lesson Matching & Safety Rules

Each entry in `phases[i].lessons` must satisfy **one** of two explicit intents:

1. **Update an existing lesson in place**:
   - Provide `id` matching an existing lesson inside that exact `phaseId`.
   - Preserves the lesson UUID/ID so all learner `lesson_progress`, quiz links, and activity references remain intact.
   - Preserves `published` status on already-published lessons (so enrolled learners are never locked out mid-course) and keeps existing drafts as `draft`.

2. **Create a new lesson**:
   - Omit `id` and explicitly set `"isNew": true` (or `"action": "create"`).
   - **Matching by title alone is rejected.**
   - **Never auto-published:** Newly imported lessons are always created with `publicationStatus: "draft"`, even if `"publicationStatus": "published"` is supplied in the JSON payload.

---

## 3. Lesson Schema & Instructional Validation

| Field | Type | Constraints |
|---|---|---|
| `id` | `string` | Existing lesson ID (required for updates; forbidden when `isNew: true`) |
| `isNew` | `boolean` | `true` for new draft lessons when `id` is omitted |
| `phaseId` | `string` | Existing module/phase ID belonging to target course (inherits enclosing phase `id` if omitted) |
| `position` | `integer >= 1` | Target ordering within phase (auto-appended for new lessons if omitted; conflicts fail validation) |
| `title` | `string` | Required, 3–200 characters, XSS-safe |
| `introduction` | `string` | XSS-safe plain text framing lesson purpose |
| `objectives` | `string[]` | Array of XSS-safe plain strings |
| `estMinutes` | `integer` | `1` to `600` (default `25`) |
| `blocks` | `LessonBlock[]` | Required non-empty array of supported block objects (see §4) |
| `videos` | `VideoEntry[]` | Optional YouTube metadata entries (`https://...`) |
| `summary` | `string` | Optional closing recap |
| `takeaways` | `string[]` | Optional array of key takeaways |
| `furtherReading` | `FurtherReadingItem[]` | Optional list of `{ title, source, url, resourceType }` (`https://` or `http://` URLs only) |
| `isRequired` | `boolean` | Defaults to `true` |
| `completionCriteria` | `string` | Optional completion instruction |

### Meaningful Instructional Content Guard
- Lessons must include at least one substantive instructional block (or video) totaling **at least 35 instructional characters** across `introduction` and block content.
- Headings alone (or blank shell blocks) are rejected rather than enforcing an arbitrary minimum block count.

### Security & URL Validation
- Raw HTML tags (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<svg>`, `<style>`, `<link>`, `<meta>`, `<form>`, `<input>`, `<img>`, `<a href>`), inline event handlers (`onclick=`, `onerror=`), `srcdoc=`, and `javascript:` / `vbscript:` / `data:text/html` URIs are rejected in all non-code fields.
- Code blocks (`type: "code"`) allow programming syntax and are always rendered safely via HTML escaping (`escapeHtml`).
- URLs must use `https://` or `http://` (image blocks also allow safe root-relative `/assets/...` paths, rejecting protocol-relative `//...` and control characters).

---

## 4. Supported Content Block Types (`15` types)

Every block must be an object with a valid `type` from `BLOCK_TYPE_CATALOG`:

1. `heading` — `{ type: "heading", text, level? }`
2. `paragraph` — `{ type: "paragraph", text }`
3. `steps` — `{ type: "steps", title?, items: string[] }` (at least 1 item)
4. `bullets` — `{ type: "bullets", title?, items: string[] }` (at least 1 item)
5. `definition` — `{ type: "definition", term, meaning }` *(normalizes legacy seed `.text` -> `.meaning`)*
6. `example` — `{ type: "example", title?, body }`
7. `case_study` — `{ type: "case_study", title?, scenario, takeaway? }` *(normalizes legacy seed `.text` -> `.scenario`)*
8. `table` — `{ type: "table", title?, headers: string[], rows: string[][] }` (non-empty headers, matching row widths)
9. `callout` — `{ type: "callout", variant?, title?, text }`
10. `demonstration` — `{ type: "demonstration", title?, instructions, expectedOutcome? }`
11. `code` — `{ type: "code", title?, language?, code }`
12. `image` — `{ type: "image", title?, url?, alt?, caption? }` (`alt` or `title` required; URL validated)
13. `video` — `{ type: "video", provider?, url, title?, description?, duration?, transcript?, viewingInstructions? }` (validated via `normalizeVideoEntry`)
14. `resource_download` — `{ type: "resource_download", title, description?, url?, formatLabel? }` (`https://` / `http://` URL if provided)
15. `knowledge_check` — `{ type: "knowledge_check", prompt, options: string[], correctIndex: number, explanation? }` (at least 2 options; valid 0-based `correctIndex`)

---

## 5. Versioning, Transactional Atomicity & Snapshot Recovery

- **Dry-Run First**: Validation runs completely read-only and produces per-lesson classifications (`new`, `updated`, `unchanged`, `rejected`), field diffs, and downloadable error reports.
- **Transactional Commit**: Either the entire validated batch commits inside a PostgreSQL transaction (`admin_bulk_import_course_content`) or rolls back completely. Rejected/failed attempts are audited in `content_imports` and `admin_audit_logs`.
- **Automatic `pre_import` Snapshot**: Every commit first captures a full `snapshot_data` JSON curriculum snapshot into `course_versions`.
- **One-Click Recovery**: `admin_restore_course_snapshot` automatically saves a `pre_restore` safety backup first, restores course metadata, phases, lessons, and normalized `lesson_resources`, and preserves post-snapshot lessons referenced by learner records as `archived` — **never** deleting or resetting `lesson_progress`, `course_enrollments`, `course_completions`, `quiz_attempts`, or `submissions`.
