---
folderType: "draft"
state: "drafts"
description: "Architecture decision records for the work-pump decomposition"
---

# Work-Pump Decomposition Decisions

Records the major architectural decisions behind splitting the monolithic `process_work_batch` SQL function and `WorkCoordinatorPublisherWorker` C# poller into focused per-operation functions, workers, and channels.

The decomposition is complete. `process_work_batch` no longer exists: migration 029 drops it (`DROP FUNCTION IF EXISTS ... process_work_batch CASCADE`), and nothing calls it. These records are kept as history; for the current functions see the work coordinator pages.

These decisions were made together as one design — they reference each other and shouldn't be evaluated in isolation.
