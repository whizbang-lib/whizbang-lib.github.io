---
folderType: "draft"
state: "drafts"
description: "Architecture decision records for the work-pump decomposition"
---

# Work-Pump Decomposition Decisions

Records the major architectural decisions behind splitting the monolithic `process_work_batch` SQL function and `WorkCoordinatorPublisherWorker` C# poller into focused per-operation functions, workers, and channels.

These decisions were made together as one design — they reference each other and shouldn't be evaluated in isolation.
