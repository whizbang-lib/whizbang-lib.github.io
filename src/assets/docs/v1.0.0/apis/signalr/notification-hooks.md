---
title: SignalR Notification Hooks
version: 1.0.0
category: SignalR
order: 1
description: >-
  Push real-time notifications via SignalR using Whizbang's message tag system -
  automatic group routing with placeholder support
tags: 'signalr, notifications, tags, hooks, real-time, groups'
codeReferences:
  - src/Whizbang.SignalR/Hooks/SignalRNotificationHook.cs
  - src/Whizbang.Core/Attributes/NotificationTagAttribute.cs
  - src/Whizbang.Core/Tags/IMessageTagHook.cs
testReferences:
  - tests/Whizbang.SignalR.Tests/Hooks/SignalRNotificationHookTests.cs
---

# SignalR Notification Hooks

The `SignalRNotificationHook<THub>` enables automatic real-time notifications via SignalR when messages are tagged with `[NotificationTag]`.

## Overview

Notification hooks integrate Whizbang's message tag system with SignalR to:

- **Push Automatically** - Tagged messages trigger SignalR notifications
- **Route to Groups** - Dynamic group routing with placeholder substitution
- **Include Metadata** - Notifications contain tag, priority, type, and payload
- **Support Broadcast** - Send to all clients when no group specified

## Installation

```bash{title="Installation" description="Installation" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Installation"]}
dotnet add package Whizbang.SignalR
```

## Registration

```csharp{title="Registration" description="Registration" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Registration"]}
builder.Services.AddWhizbang(options => {
    options.Tags.UseHook<NotificationTagAttribute, SignalRNotificationHook<NotificationHub>>();
});

builder.Services.AddWhizbangSignalR();
```

## Tagging Messages

### Basic Notification

```csharp{title="Basic Notification" description="Basic Notification" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Basic", "Notification"]}
[NotificationTag(Tag = "system-announcement")]
public record SystemAnnouncementEvent(string Message) : IEvent;
```

This sends a broadcast notification to all connected clients.

### Group-Targeted Notification

```csharp{title="Group-Targeted Notification" description="Group-Targeted Notification" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Group-Targeted", "Notification"]}
[NotificationTag(
    Tag = "order-shipped",
    Group = "customer-{CustomerId}",
    Priority = NotificationPriority.High)]
public record OrderShippedEvent(
    Guid OrderId,
    Guid CustomerId,
    string TrackingNumber) : IEvent;
```

The `{CustomerId}` placeholder is replaced with the actual value from the event payload.

### Priority Levels

```csharp{title="Priority Levels" description="Priority Levels" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Priority", "Levels"]}
[NotificationTag(Tag = "new-message", Priority = NotificationPriority.Normal)]
public record NewMessageEvent(Guid ConversationId, string Preview) : IEvent;

[NotificationTag(Tag = "payment-failed", Priority = NotificationPriority.Critical)]
public record PaymentFailedEvent(Guid OrderId, string Reason) : IEvent;
```

## NotificationTagAttribute Properties

| Property | Type | Description |
|----------|------|-------------|
| `Tag` | `string` | Notification identifier sent to clients |
| `Group` | `string?` | SignalR group name (supports placeholders) |
| `Priority` | `NotificationPriority` | Message priority level |

## Group Placeholders

Placeholders are replaced from the message payload or scope:

```csharp{title="Group Placeholders" description="Placeholders are replaced from the message payload or scope:" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Group", "Placeholders"]}
// From payload properties
[NotificationTag(Tag = "order-update", Group = "customer-{CustomerId}")]
public record OrderUpdatedEvent(Guid OrderId, Guid CustomerId) : IEvent;

// From scope values
[NotificationTag(Tag = "tenant-alert", Group = "tenant-{TenantId}")]
public record TenantAlertEvent(string Message) : IEvent;
```

Placeholder resolution order:
1. Message payload properties (JSON object)
2. Scope context values (`TenantId`, `UserId`, etc.)

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

### Example Payload

```json{title="Example Payload" description="Example Payload" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "Example", "Payload"]}
{
  "tag": "order-shipped",
  "priority": "High",
  "messageType": "OrderShippedEvent",
  "payload": {
    "orderId": "550e8400-e29b-41d4-a716-446655440000",
    "customerId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "trackingNumber": "1Z999AA10123456784"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Client Handling

### JavaScript

```typescript{title="JavaScript" description="JavaScript" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "JavaScript"]}
connection.on("ReceiveNotification", (notification: NotificationMessage) => {
    switch (notification.tag) {
        case "order-shipped":
            showShippingToast(notification.payload);
            break;
        case "payment-failed":
            showPaymentAlert(notification.payload, notification.priority);
            break;
    }
});
```

### React Example

```tsx
useEffect(() => {
    connection.on("ReceiveNotification", (notification) => {
        if (notification.priority === "Critical") {
            toast.error(notification.payload.message);
        } else {
            toast.info(notification.payload.message);
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
    options.Tags.UseHook<NotificationTagAttribute, SignalRNotificationHook<NotificationHub>>();
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
[NotificationTag(
    Tag = "order-status-changed",
    Group = "customer-{CustomerId}",
    Priority = NotificationPriority.Normal)]
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
