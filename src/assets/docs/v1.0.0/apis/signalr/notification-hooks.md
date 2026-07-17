---
title: SignalR Notification Hooks
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: SignalR
order: 1
description: >-
  Push real-time notifications via SignalR using Whizbang's message tag system -
  automatic group routing with placeholder support
tags: 'signalr, notifications, tags, hooks, real-time, groups, signaltag'
codeReferences:
  - src/Whizbang.SignalR/Hooks/SignalRNotificationHook.cs
  - src/Whizbang.SignalR/DependencyInjection/SignalRTagExtensions.cs
  - src/Whizbang.Core/Attributes/SignalTagAttribute.cs
  - src/Whizbang.Core/Attributes/MessageTagAttribute.cs
  - src/Whizbang.Core/Tags/SignalPriority.cs
  - src/Whizbang.Core/Tags/IMessageTagHook.cs
testReferences:
  - tests/Whizbang.SignalR.Tests/Hooks/SignalRNotificationHookTests.cs
  - tests/Whizbang.SignalR.Tests/DependencyInjection/SignalRTagExtensionsTests.cs
lastMaintainedCommit: '01f07906'
---

# SignalR Notification Hooks

The `SignalRNotificationHook<THub>` enables automatic real-time notifications via SignalR when messages are tagged with `[SignalTag]`.

## Overview

Notification hooks integrate Whizbang's message tag system with SignalR to:

- **Push Automatically** - Tagged messages trigger SignalR notifications after successful handling
- **Route to Groups** - Dynamic group routing with placeholder substitution
- **Include Metadata** - Notifications contain tag, priority, type, and payload
- **Support Broadcast** - Send to all clients when no group specified

## Installation

```bash{title="Installation" description="Installation" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Installation"]}
dotnet add package Whizbang.SignalR
```

## Registration

Use the `UseSignalR<THub>()` convenience extension from `Whizbang.SignalR.DependencyInjection`:

```csharp{title="Registration" description="Registration" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Registration"]}
builder.Services.AddWhizbang(options => {
    options.Tags.UseSignalR<NotificationHub>();
});

builder.Services.AddWhizbangSignalR();
```

`UseSignalR<THub>()` is shorthand for `options.Tags.UseHook<SignalTagAttribute, SignalRNotificationHook<THub>>()`. An overload `UseSignalR<THub>(int priority)` controls hook ordering (lower values execute first).

## Tagging Messages

### Basic Notification

```csharp{title="Basic Notification" description="Basic Notification" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Basic", "Notification"]}
[SignalTag(Tag = "system-announcement", Properties = ["Message"])]
public record SystemAnnouncementEvent(string Message) : IEvent;
```

This sends a broadcast notification to all connected clients (no `Group` specified).

### Group-Targeted Notification

```csharp{title="Group-Targeted Notification" description="Group-Targeted Notification" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Group-Targeted", "Notification"]}
[SignalTag(
    Tag = "order-shipped",
    Properties = ["OrderId", "CustomerId", "TrackingNumber"],
    Group = "customer-{CustomerId}",
    Priority = SignalPriority.High)]
public record OrderShippedEvent(
    Guid OrderId,
    Guid CustomerId,
    string TrackingNumber) : IEvent;
```

The `{CustomerId}` placeholder is replaced with the actual value from the notification payload.

### Priority Levels

`SignalPriority` has four values: `Low = 0`, `Normal = 1` (default), `High = 2`, `Critical = 3`.

```csharp{title="Priority Levels" description="Priority Levels" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Priority", "Levels"]}
[SignalTag(Tag = "new-message", Properties = ["ConversationId", "Preview"], Priority = SignalPriority.Normal)]
public record NewMessageEvent(Guid ConversationId, string Preview) : IEvent;

[SignalTag(Tag = "payment-failed", Properties = ["OrderId", "Reason"], Priority = SignalPriority.Critical)]
public record PaymentFailedEvent(Guid OrderId, string Reason) : IEvent;
```

## SignalTagAttribute Properties

| Property | Type | Description |
|----------|------|-------------|
| `Tag` | `string` (required) | Notification identifier sent to clients |
| `Properties` | `string[]?` | Message property names extracted into the notification payload |
| `ExtraJson` | `string?` | Arbitrary JSON merged into the payload (supports `{PropertyName}` templates) |
| `Group` | `string?` | SignalR group name (supports placeholders); null/empty broadcasts to all clients |
| `Priority` | `SignalPriority` | Signal priority level (default: `SignalPriority.Normal`) |

`Tag`, `Properties`, and `ExtraJson` are inherited from the `MessageTagAttribute` base class. The notification payload is built from the extracted `Properties` values merged with `ExtraJson` - it is not the whole event.

## Group Placeholders

Placeholders are replaced from the notification payload or scope:

```csharp{title="Group Placeholders" description="Placeholders are replaced from the message payload or scope:" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Group", "Placeholders"]}
// From payload properties (extracted via Properties)
[SignalTag(Tag = "order-update", Properties = ["OrderId", "CustomerId"], Group = "customer-{CustomerId}")]
public record OrderUpdatedEvent(Guid OrderId, Guid CustomerId) : IEvent;

// From scope values
[SignalTag(Tag = "tenant-alert", Properties = ["Message"], Group = "tenant-{TenantId}")]
public record TenantAlertEvent(string Message) : IEvent;
```

Placeholder resolution order:
1. Notification payload properties (exact property-name match on the payload JSON object)
2. Scope context values - only `TenantId`, `UserId`, `CustomerId`, and `OrganizationId` are supported from scope

## NotificationMessage Format

The notification sent to clients includes:

```csharp{title="NotificationMessage Format" description="The notification sent to clients includes:" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "NotificationMessage", "Format"]}
public sealed record NotificationMessage {
    public required string Tag { get; init; }
    public required string Priority { get; init; }
    public required string MessageType { get; init; }
    public required JsonElement Payload { get; init; }
    public required DateTimeOffset Timestamp { get; init; }
}
```

`Priority` is the enum value name (e.g. `"High"`), `MessageType` is the message type's short name, and `Timestamp` is set to `DateTimeOffset.UtcNow` when the notification is created. The notification is sent to clients via the `"ReceiveNotification"` method.

### Example Payload

```json{title="Example Payload" description="Example Payload" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "Example", "Payload"]}
{
  "Tag": "order-shipped",
  "Priority": "High",
  "MessageType": "OrderShippedEvent",
  "Payload": {
    "OrderId": "550e8400-e29b-41d4-a716-446655440000",
    "CustomerId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "TrackingNumber": "1Z999AA10123456784"
  },
  "Timestamp": "2024-01-15T10:30:00Z"
}
```

Property names are PascalCase: Whizbang's combined serializer options do not apply a camelCase naming policy, and payload keys mirror the `Properties` names as declared.

## Client Handling

### JavaScript

```typescript{title="JavaScript" description="JavaScript" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "JavaScript"]}
connection.on("ReceiveNotification", (notification: NotificationMessage) => {
    switch (notification.Tag) {
        case "order-shipped":
            showShippingToast(notification.Payload);
            break;
        case "payment-failed":
            showPaymentAlert(notification.Payload, notification.Priority);
            break;
    }
});
```

### React Example

```tsx
useEffect(() => {
    connection.on("ReceiveNotification", (notification) => {
        if (notification.Priority === "Critical") {
            toast.error(notification.Payload.Message);
        } else {
            toast.info(notification.Payload.Message);
        }
    });
}, [connection]);
```

## Complete Example

### Server Setup

```csharp{title="Server Setup" description="Server Setup" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Server", "Setup"]}
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWhizbang(options => {
    options.Tags.UseSignalR<NotificationHub>();
});

builder.Services.AddWhizbangSignalR();

var app = builder.Build();
app.MapHub<NotificationHub>("/notifications");
app.Run();
```

### Hub Definition

```csharp{title="Hub Definition" description="Hub Definition" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Hub", "Definition"]}
public class NotificationHub : Hub {
    public async Task JoinCustomerGroup(Guid customerId) {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"customer-{customerId}");
    }

    public async Task JoinTenantGroup(string tenantId) {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"tenant-{tenantId}");
    }
}
```

### Event Definition

```csharp{title="Event Definition" description="Event Definition" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "Event", "Definition"]}
[SignalTag(
    Tag = "order-status-changed",
    Properties = ["OrderId", "CustomerId", "OldStatus", "NewStatus", "ChangedAt"],
    Group = "customer-{CustomerId}",
    Priority = SignalPriority.Normal)]
public record OrderStatusChangedEvent(
    Guid OrderId,
    Guid CustomerId,
    string OldStatus,
    string NewStatus,
    DateTimeOffset ChangedAt) : IEvent;
```

### Publishing Events

```csharp{title="Publishing Events" description="Publishing Events" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "Publishing", "Events"]}
public class OrderService {
    private readonly IDispatcher _dispatcher;

    public async Task UpdateOrderStatus(Guid orderId, string newStatus) {
        var order = await _repository.GetAsync(orderId);

        var evt = new OrderStatusChangedEvent(
            orderId,
            order.CustomerId,
            order.Status,
            newStatus,
            DateTimeOffset.UtcNow);

        // Publishing triggers the SignalR notification automatically
        await _dispatcher.PublishAsync(evt);
    }
}
```

## Related Documentation

- [SignalR Integration](./signalr.md) - Setup and configuration
- [Message Tags](../../fundamentals/messages/message-tags.md) - Tag processing overview
- [Dispatcher](../../fundamentals/dispatcher/dispatcher.md) - Publishing events
