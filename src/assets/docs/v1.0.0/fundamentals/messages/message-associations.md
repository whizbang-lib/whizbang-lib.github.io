---
title: Message Associations
version: 1.0.0
category: Core Concepts
order: 24
description: >-
  MessageAssociationRecord and MessageAssociationsSchema for tracking message-to-consumer mappings in Whizbang.
tags: 'message-associations, perspectives, receptors, discovery'
codeReferences:
  - src/Whizbang.Core/Messaging/MessageAssociationRecord.cs
  - src/Whizbang.Data.Schema/Schemas/MessageAssociationsSchema.cs
---

# Message Associations

Message associations track the relationships between message types and their consumers (perspectives, receptors, handlers). This enables auto-creation of perspective checkpoints and runtime discovery of message routing.

## Overview

When a service starts, it **reconciles** its message associations with the database:

- **Discovers** which message types are handled by perspectives and receptors
- **Stores** these associations in the `message_associations` table
- **Enables** auto-creation of checkpoints when new perspectives are deployed
- **Supports** runtime inspection of message flow

## MessageAssociationRecord {#messageassociationrecord}

```csharp{title="MessageAssociationRecord" description="Demonstrates messageAssociationRecord" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Messages", "MessageAssociationRecord", "Messageassociationrecord"]}
namespace Whizbang.Core.Messaging;

/// <summary>
/// Database entity for message_associations table.
/// Stores associations between message types and their consumers (perspectives, handlers, receptors).
/// Populated during startup via reconciliation to enable auto-creation of perspective checkpoints.
/// </summary>
public sealed class MessageAssociationRecord {
  /// <summary>
  /// Unique identifier for this association.
  /// </summary>
  public required Guid Id { get; set; }

  /// <summary>
  /// Fully-qualified message type name (e.g., "MyApp.Events.ProductCreated").
  /// </summary>
  public required string MessageType { get; set; }

  /// <summary>
  /// Type of association: "perspective", "receptor", or "handler".
  /// </summary>
  public required string AssociationType { get; set; }

  /// <summary>
  /// Name of the target consumer (perspective name, receptor name, or handler name).
  /// </summary>
  public required string TargetName { get; set; }

  /// <summary>
  /// Name of the service that owns this consumer.
  /// </summary>
  public required string ServiceName { get; set; }

  /// <summary>
  /// UTC timestamp when this association was created.
  /// </summary>
  public DateTimeOffset CreatedAt { get; set; }

  /// <summary>
  /// UTC timestamp when this association was last updated.
  /// </summary>
  public DateTimeOffset UpdatedAt { get; set; }
}
```

## MessageAssociationsSchema {#messageassociationsschema}

```csharp{title="MessageAssociationsSchema" description="Demonstrates messageAssociationsSchema" category="Architecture" difficulty="ADVANCED" tags=["Fundamentals", "Messages", "MessageAssociationsSchema", "Messageassociationsschema"]}
namespace Whizbang.Data.Schema.Schemas;

/// <summary>
/// Schema definition for the message_associations table.
/// Table name: {prefix}message_associations (e.g., wb_message_associations)
/// </summary>
public static class MessageAssociationsSchema {
  public static class Columns {
    public const string ID = "id";
    public const string MESSAGE_TYPE = "message_type";
    public const string ASSOCIATION_TYPE = "association_type";
    public const string TARGET_NAME = "target_name";
    public const string SERVICE_NAME = "service_name";
    public const string CREATED_AT = "created_at";
    public const string UPDATED_AT = "updated_at";
  }

  public static readonly TableDefinition Table = new(
    Name: "message_associations",
    Columns: [
      new("id", WhizbangDataType.UUID, PrimaryKey: true),
      new(Columns.MESSAGE_TYPE, WhizbangDataType.STRING, MaxLength: 500),
      new(Columns.ASSOCIATION_TYPE, WhizbangDataType.STRING, MaxLength: 50),
      new(Columns.TARGET_NAME, WhizbangDataType.STRING, MaxLength: 500),
      new(Columns.SERVICE_NAME, WhizbangDataType.STRING, MaxLength: 500),
      new("created_at", WhizbangDataType.TIMESTAMP_TZ),
      new("updated_at", WhizbangDataType.TIMESTAMP_TZ)
    ],
    Indexes: [
      new("idx_message_associations_message_type", [Columns.MESSAGE_TYPE]),
      new("idx_message_associations_target_lookup",
          [Columns.ASSOCIATION_TYPE, Columns.TARGET_NAME, Columns.SERVICE_NAME])
    ],
    UniqueConstraints: [
      new("uq_message_association",
          [Columns.MESSAGE_TYPE, Columns.ASSOCIATION_TYPE, Columns.TARGET_NAME, Columns.SERVICE_NAME])
    ]
  );
}
```

## Association Types

| Type | Description | Example |
|------|-------------|---------|
| `perspective` | Perspective that projects the message | `OrderSummaryPerspective` |
| `receptor` | Receptor that handles the message | `CreateOrderReceptor` |
| `handler` | Generic message handler | `AuditLogHandler` |

## Reconciliation Flow

At startup, services reconcile their associations:

```
1. Service starts
   └─> Scan assemblies for perspectives and receptors

2. Discover associations
   └─> OrderSummaryPerspective handles OrderCreated, OrderShipped
   └─> InventoryReceptor handles OrderCreated

3. Reconcile with database
   └─> Upsert new associations
   └─> Remove stale associations (optional)

4. Auto-create checkpoints
   └─> New perspectives get checkpoints initialized
```

### Implementation Example

```csharp{title="Implementation Example" description="Demonstrates implementation Example" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Implementation", "Example"]}
public class MessageAssociationReconciler {
  private readonly IDbConnection _db;
  private readonly string _serviceName;

  public async Task ReconcileAsync(
      IEnumerable<DiscoveredAssociation> associations,
      CancellationToken ct = default) {

    foreach (var association in associations) {
      await _db.ExecuteAsync(
          """
          INSERT INTO wb_message_associations
              (id, message_type, association_type, target_name, service_name, created_at, updated_at)
          VALUES
              (@Id, @MessageType, @AssociationType, @TargetName, @ServiceName, @Now, @Now)
          ON CONFLICT (message_type, association_type, target_name, service_name)
          DO UPDATE SET updated_at = @Now
          """,
          new {
            Id = Guid.CreateVersion7(),
            association.MessageType,
            association.AssociationType,
            association.TargetName,
            ServiceName = _serviceName,
            Now = DateTimeOffset.UtcNow
          },
          ct);
    }
  }
}
```

## Use Cases

### Auto-Creating Perspective Checkpoints

When a new perspective is deployed, associations enable automatic checkpoint creation:

```csharp{title="Auto-Creating Perspective Checkpoints" description="When a new perspective is deployed, associations enable automatic checkpoint creation:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Auto-Creating", "Perspective"]}
public async Task EnsureCheckpointsAsync(CancellationToken ct = default) {
  // Find perspectives without checkpoints
  var missingCheckpoints = await _db.QueryAsync<string>(
      """
      SELECT DISTINCT ma.target_name
      FROM wb_message_associations ma
      WHERE ma.association_type = 'perspective'
        AND ma.service_name = @ServiceName
        AND NOT EXISTS (
          SELECT 1 FROM wb_perspective_checkpoints pc
          WHERE pc.perspective_name = ma.target_name
        )
      """,
      new { ServiceName = _serviceName },
      ct);

  // Create checkpoints for new perspectives
  foreach (var perspectiveName in missingCheckpoints) {
    await CreateCheckpointAsync(perspectiveName, ct);
  }
}
```

### Runtime Message Flow Inspection

Query which consumers handle a message type:

```csharp{title="Runtime Message Flow Inspection" description="Query which consumers handle a message type:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Runtime", "Message"]}
public async Task<IEnumerable<ConsumerInfo>> GetConsumersAsync(
    string messageType,
    CancellationToken ct = default) {

  return await _db.QueryAsync<ConsumerInfo>(
      """
      SELECT association_type, target_name, service_name
      FROM wb_message_associations
      WHERE message_type = @MessageType
      """,
      new { MessageType = messageType },
      ct);
}
```

### Service Dependency Analysis

Find all message types consumed by a service:

```csharp{title="Service Dependency Analysis" description="Find all message types consumed by a service:" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Service", "Dependency"]}
public async Task<IEnumerable<string>> GetConsumedTypesAsync(
    string serviceName,
    CancellationToken ct = default) {

  return await _db.QueryAsync<string>(
      """
      SELECT DISTINCT message_type
      FROM wb_message_associations
      WHERE service_name = @ServiceName
      """,
      new { ServiceName = serviceName },
      ct);
}
```

## Database Schema

```sql{title="Database Schema" description="Demonstrates database Schema" category="Architecture" difficulty="INTERMEDIATE" tags=["Fundamentals", "Messages", "Database", "Schema"]}
CREATE TABLE wb_message_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type VARCHAR(500) NOT NULL,
  association_type VARCHAR(50) NOT NULL,
  target_name VARCHAR(500) NOT NULL,
  service_name VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_type, association_type, target_name, service_name)
);

CREATE INDEX idx_message_associations_message_type
  ON wb_message_associations (message_type);

CREATE INDEX idx_message_associations_target_lookup
  ON wb_message_associations (association_type, target_name, service_name);
```

## Example Data

| message_type | association_type | target_name | service_name |
|--------------|------------------|-------------|--------------|
| MyApp.Events.OrderCreated | perspective | OrderSummaryPerspective | OrderService |
| MyApp.Events.OrderCreated | receptor | InventoryReceptor | InventoryService |
| MyApp.Events.OrderShipped | perspective | OrderSummaryPerspective | OrderService |
| MyApp.Events.PaymentProcessed | receptor | FulfillmentReceptor | FulfillmentService |

## Best Practices

### DO

- **Run reconciliation at startup** to keep associations current
- **Use consistent service names** across deployments
- **Index message_type** for efficient lookups
- **Use unique constraint** to prevent duplicates

### DON'T

- **Don't hardcode associations** - discover them automatically
- **Don't delete stale associations immediately** - consider grace periods
- **Don't query during hot paths** - cache if needed
- **Don't store sensitive data** in message type names

## Related Documentation

- [Perspectives](../perspectives/perspectives.md) - Read model projections
- [Receptors](../receptors/receptors.md) - Message handlers
- [Database Schema](../../extending/extensibility/database-schema-framework.md) - Schema definitions

---

*Version 1.0.0 - Foundation Release*
