---
title: Work coordinator
order: 11
---

# Work coordinator

Whizbang's work coordinator is the engine that pumps messages through the outbox/inbox/perspective
pipeline. It is decomposed into focused functions and workers — each does one thing.

## Pages

- [Overview](overview.md)
- [Claim loop](claim-loop.md)
- [Handler commit](handler-commit.md)
- [Commit sequence](commit-sequence.md)
- [Partition assignment](partition-assignment.md)
- [Batched flushers](batched-flushers.md)
- [Notifications and pgbouncer](notifications-and-pgbouncer.md)
- [App signals](app-signals.md)
- [Configuration reference](configuration-reference.md)
- [Performance tuning](performance-tuning.md)
- [Failure and recovery](failure-and-recovery.md)
