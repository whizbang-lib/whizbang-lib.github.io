---
title: SignalR Integration
version: 1.0.0
category: Integrations
order: 1
description: >-
  Real-time push notifications with ASP.NET Core SignalR - AOT-compatible
  polymorphic JSON serialization for Whizbang message types
tags: 'signalr, real-time, notifications, websockets, aot, json-serialization'
codeReferences:
  - src/Whizbang.SignalR/DependencyInjection/SignalRServiceCollectionExtensions.cs
  - src/Whizbang.SignalR/Hooks/SignalRNotificationHook.cs
testReferences:
  - tests/Whizbang.SignalR.Tests/DependencyInjection/SignalRServiceCollectionExtensionsTests.cs
  - tests/Whizbang.SignalR.Tests/Hooks/SignalRNotificationHookTests.cs
---

# SignalR Integration

Whizbang provides seamless ASP.NET Core SignalR integration with automatic AOT-compatible JSON serialization for polymorphic message types.

## Overview

The `Whizbang.SignalR` package enables:

- **AOT-Compatible Serialization** - Automatic configuration with `JsonContextRegistry`
- **Polymorphic Type Support** - Push `ICommand`, `IEvent`, and custom types without manual serialization
- **Turn-Key Setup** - Single extension method configures everything
- **Notification Hooks** - Tag-based real-time notifications via `SignalRNotificationHook`

## Installation

```bash{title="Installation" description="Demonstrates installation" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Installation"]}
dotnet add package Whizbang.SignalR
```

## Quick Start

### Basic Setup

```csharp{title="Basic Setup" description="Demonstrates basic Setup" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Basic", "Setup"]}
// Program.cs
var builder = WebApplication.CreateBuilder(args);

// Add SignalR with Whizbang JSON serialization
builder.Services.AddWhizbangSignalR();

var app = builder.Build();

app.MapHub<NotificationHub>("/notifications");
app.Run();
```

### With Hub Options

```csharp{title="With Hub Options" description="Demonstrates with Hub Options" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Hub", "Options"]}
builder.Services.AddWhizbangSignalR()
    .AddHubOptions<NotificationHub>(options => {
        options.EnableDetailedErrors = true;
        options.ClientTimeoutInterval = TimeSpan.FromSeconds(30);
        options.KeepAliveInterval = TimeSpan.FromSeconds(10);
    });
```

## AddWhizbangSignalR

The `AddWhizbangSignalR` extension method configures SignalR to use Whizbang's `JsonContextRegistry` for JSON serialization. This enables:

| Feature | Description |
|---------|-------------|
| **Core Types** | `MessageEnvelope`, `MessageHop`, and other Whizbang types |
| **Application Messages** | `ICommand` and `IEvent` implementations |
| **Polymorphic Types** | Types with `[JsonPolymorphic]` and `[JsonDerivedType]` attributes |
| **Value Objects** | `WhizbangId` and other value types |

### How It Works

```csharp{title="How It Works" description="Demonstrates how It Works" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Works"]}
public static ISignalRServerBuilder AddWhizbangSignalR(this IServiceCollection services) {
    return services.AddSignalR()
        .AddJsonProtocol(options => {
            options.PayloadSerializerOptions = JsonContextRegistry.CreateCombinedOptions();
        });
}
```

The `JsonContextRegistry.CreateCombinedOptions()` method returns a `JsonSerializerOptions` instance that includes all registered JSON serialization contexts, enabling polymorphic serialization without reflection.

## Example Hub

```csharp{title="Example Hub" description="Demonstrates example Hub" category="API" difficulty="BEGINNER" tags=["Apis", "Signalr", "Example", "Hub"]}
public class NotificationHub : Hub {
    public async Task JoinGroup(string groupName) {
        await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
    }

    public async Task LeaveGroup(string groupName) {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, groupName);
    }
}
```

## Pushing Messages

```csharp{title="Pushing Messages" description="Demonstrates pushing Messages" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "Pushing", "Messages"]}
public class OrderService {
    private readonly IHubContext<NotificationHub> _hubContext;

    public OrderService(IHubContext<NotificationHub> hubContext) {
        _hubContext = hubContext;
    }

    public async Task NotifyOrderShipped(Guid customerId, OrderShippedEvent evt) {
        // Polymorphic type sent with correct JSON serialization
        await _hubContext.Clients.Group($"customer-{customerId}")
            .SendAsync("ReceiveNotification", evt);
    }
}
```

## Client Configuration

### JavaScript/TypeScript

```typescript{title="JavaScript/TypeScript" description="Demonstrates javaScript/TypeScript" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", "JavaScript", "TypeScript"]}
import * as signalR from "@microsoft/signalr";

const connection = new signalR.HubConnectionBuilder()
    .withUrl("/notifications")
    .withAutomaticReconnect()
    .build();

connection.on("ReceiveNotification", (notification) => {
    console.log("Received:", notification);
    // Handle polymorphic types via $type discriminator
});

await connection.start();
await connection.invoke("JoinGroup", `customer-${customerId}`);
```

### .NET Client

```csharp{title=".NET Client" description="Demonstrates .NET Client" category="API" difficulty="INTERMEDIATE" tags=["Apis", "Signalr", ".NET", "Client"]}
var connection = new HubConnectionBuilder()
    .WithUrl("https://api.example.com/notifications")
    .WithAutomaticReconnect()
    .Build();

connection.On<NotificationMessage>("ReceiveNotification", notification => {
    Console.WriteLine($"Received: {notification.Tag}");
});

await connection.StartAsync();
await connection.InvokeAsync("JoinGroup", $"customer-{customerId}");
```

## Related Documentation

- [Notification Hooks](./notification-hooks.md) - Tag-based SignalR notifications
- JSON Serialization - AOT-compatible serialization
- [Message Tags](../../fundamentals/messages/message-tags.md) - Tag-based processing hooks
