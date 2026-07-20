---
title: Notification Service
pageType: tutorial
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Tutorial
order: 5
description: >-
  Build the Notification Worker - email/SMS notifications, template rendering,
  and delivery tracking
tags: 'tutorial, notification-service, email, sms, event-driven'
codeReferences:
  - samples/ECommerce/ECommerce.NotificationWorker/Program.cs
  - >-
    samples/ECommerce/ECommerce.NotificationWorker/Receptors/SendNotificationReceptor.cs
  - samples/ECommerce/ECommerce.Contracts/Commands/SendNotificationCommand.cs
  - samples/ECommerce/ECommerce.Contracts/Events/NotificationSentEvent.cs
testReferences:
  - >-
    samples/ECommerce/tests/ECommerce.NotificationWorker.Tests/SendNotificationReceptorTests.cs
lastMaintainedCommit: '01f07906'
---

# Notification Service

Build the **Notification Worker** - a background service that handles `SendNotificationCommand`, sends notifications via email/SMS/push providers, and publishes `NotificationSentEvent`.

:::note
This is **Part 4** of the ECommerce Tutorial. Complete [Payment Processing](payment-processing.md) first.
:::

---

## What You'll Build

```mermaid{caption="Notification Service architecture — Azure Service Bus delivers SendNotificationCommand to SendNotificationReceptor, which renders a template, sends via an email/SMS provider, and publishes NotificationSentEvent to the event store."}
flowchart TD
    subgraph NSA["Notification Service Architecture"]
        ASB["Azure Service Bus"]
        Receptor["SendNotificationReceptor<br/>- Render message<br/>- Send via provider<br/>- Publish NotificationSentEvent"]
        Template["Template Engine<br/>(Scriban)"]
        Email["Email/SMS Provider<br/>(SendGrid/Twilio)"]
        EventStore["wh_event_store (Event Store)"]

        ASB -->|"SendNotificationCommand"| Receptor
        Receptor --> Template
        Receptor --> Email
        Receptor --> EventStore
    end

    class ASB layer-command
    class Receptor layer-core
    class Template,Email layer-infrastructure
    class EventStore layer-event
```

**Features**:
- ✅ Command-driven notifications (Email / SMS / Push)
- ✅ `NotificationSentEvent` for delivery tracking
- ✅ Provider abstraction (SendGrid, Twilio)
- ✅ Template rendering (Scriban)
- ✅ Framework-managed inbox/outbox

---

## Step 1: Define Messages

### SendNotificationCommand

**ECommerce.Contracts/Commands/SendNotificationCommand.cs**:

```csharp{title="SendNotificationCommand" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "SendNotification", "Command"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (SendNotificationReceptorTests), which is outside the core unit-test coverage map"}
using Whizbang.Core;

namespace ECommerce.Contracts.Commands;

/// <summary>
/// Command to send a notification to a customer
/// </summary>
public record SendNotificationCommand : ICommand {
  public required string CustomerId { get; init; }
  public required string Subject { get; init; }
  public required string Message { get; init; }
  public NotificationType Type { get; init; }
}

public enum NotificationType {
  Email,
  Sms,
  Push
}
```

### NotificationSentEvent

**ECommerce.Contracts/Events/NotificationSentEvent.cs**:

```csharp{title="NotificationSentEvent" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "NotificationSent", "Event"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (SendNotificationReceptorTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using Whizbang.Core;

namespace ECommerce.Contracts.Events;

/// <summary>
/// Event published when a notification is successfully sent
/// </summary>
public record NotificationSentEvent : IEvent {
  [StreamId]
  public required string CustomerId { get; init; }
  public required string Subject { get; init; }
  public NotificationType Type { get; init; }
  public DateTime SentAt { get; init; }
}
```

---

## Step 2: Implement Receptor

**ECommerce.NotificationWorker/Receptors/SendNotificationReceptor.cs**:

```csharp{title="Step 2: Implement Receptor" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Step", "Implement"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (SendNotificationReceptorTests), which is outside the core unit-test coverage map"}
using ECommerce.Contracts.Commands;
using ECommerce.Contracts.Events;
using Whizbang.Core;

namespace ECommerce.NotificationWorker.Receptors;

/// <summary>
/// Handles SendNotificationCommand and publishes NotificationSentEvent
/// </summary>
public class SendNotificationReceptor(IDispatcher dispatcher, ILogger<SendNotificationReceptor> logger) : IReceptor<SendNotificationCommand, NotificationSentEvent> {

  public async ValueTask<NotificationSentEvent> HandleAsync(
    SendNotificationCommand message,
    CancellationToken cancellationToken = default) {

    logger.LogInformation(
      "Sending {NotificationType} notification to customer {CustomerId}: {Subject}",
      message.Type,
      message.CustomerId,
      message.Subject);

    // Send the notification (business logic would go here)
    // In a real system, this would call an email/SMS/push notification service

    // Simulate sending delay
    await Task.Delay(100, cancellationToken);

    var notificationSent = new NotificationSentEvent {
      CustomerId = message.CustomerId,
      Subject = message.Subject,
      Type = message.Type,
      SentAt = DateTime.UtcNow
    };

    // Publish the event
    await dispatcher.PublishAsync(notificationSent);

    logger.LogInformation(
      "Notification sent to customer {CustomerId}",
      message.CustomerId);

    return notificationSent;
  }
}
```

:::updated
Earlier drafts showed per-event receptors (`IReceptor<OrderCreated, NotificationSent>`, etc.) with `Task<T> HandleAsync` and hand-written tracking SQL. The receptor contract is `ValueTask<TResponse> HandleAsync(TMessage, CancellationToken)`. If you want a notification per upstream event (order created, payment processed, shipment created), add one receptor per event type — events can have receptors too (see `PaymentShippingReceptor` in the Shipping tutorial). Delivery tracking belongs in a perspective over `NotificationSentEvent`, not ad-hoc SQL.
:::

---

## Step 3: Notification Providers (Production)

The sample simulates delivery. In production, put providers behind interfaces so you can swap vendors and mock in tests. These are plain .NET services — inject them into the receptor.

**Email provider abstraction**:

```csharp{title="Email Provider (SendGrid)" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Email", "Provider"] unverified="production provider abstraction — not exercised by a test"}
namespace ECommerce.NotificationWorker.Services;

public interface IEmailProvider {
  Task<EmailResult> SendEmailAsync(
    string to,
    string subject,
    string htmlBody,
    string? textBody = null,
    CancellationToken ct = default
  );
}

public record EmailResult(
  bool Success,
  string? MessageId,
  string? ErrorMessage
);
```

**SendGrid implementation (condensed)**:

```csharp{title="Email Provider (SendGrid) - SendGridEmailProvider" description="**ECommerce." category="Example" difficulty="ADVANCED" tags=["Learn", "Tutorial", "Email", "Provider"] unverified="production provider (SendGrid) — not exercised by a test"}
using SendGrid;
using SendGrid.Helpers.Mail;

namespace ECommerce.NotificationWorker.Services;

public class SendGridEmailProvider(IConfiguration configuration, ILogger<SendGridEmailProvider> logger) : IEmailProvider {
  private readonly SendGridClient _client = new(configuration["SendGrid:ApiKey"]
    ?? throw new InvalidOperationException("SendGrid:ApiKey not configured"));

  public async Task<EmailResult> SendEmailAsync(
    string to,
    string subject,
    string htmlBody,
    string? textBody = null,
    CancellationToken ct = default) {

    var from = new EmailAddress(
      configuration["SendGrid:FromEmail"] ?? "noreply@ecommerce.example.com",
      configuration["SendGrid:FromName"] ?? "ECommerce Platform");
    var msg = MailHelper.CreateSingleEmail(from, new EmailAddress(to), subject, textBody ?? htmlBody, htmlBody);

    var response = await _client.SendEmailAsync(msg, ct);

    if (response.IsSuccessStatusCode) {
      var messageId = response.Headers.GetValues("X-Message-Id").FirstOrDefault();
      logger.LogInformation("Email sent to {To}, messageId: {MessageId}", to, messageId);
      return new EmailResult(true, messageId, null);
    }

    var errorBody = await response.Body.ReadAsStringAsync(ct);
    logger.LogError("Email send failed to {To}: {StatusCode} - {Error}", to, response.StatusCode, errorBody);
    return new EmailResult(false, null, $"{response.StatusCode}: {errorBody}");
  }
}
```

**SMS (Twilio)** follows the same shape — `ISmsProvider.SendSmsAsync(to, message, ct)` returning an `SmsResult`.

### Template Rendering (Scriban)

```csharp{title="Step 3: Template Engine" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Step", "Template"] unverified="production template renderer (Scriban) — not exercised by a test"}
using Scriban;

namespace ECommerce.NotificationWorker.Services;

public interface ITemplateRenderer {
  Task<string> RenderAsync<TModel>(string templateName, TModel model, CancellationToken ct = default);
}

public class ScribanTemplateRenderer(IConfiguration configuration) : ITemplateRenderer {
  private readonly string _templateDirectory = configuration["Templates:Directory"] ?? "Templates";
  private readonly Dictionary<string, Template> _cache = new();

  public async Task<string> RenderAsync<TModel>(string templateName, TModel model, CancellationToken ct = default) {
    if (!_cache.TryGetValue(templateName, out var template)) {
      var content = await File.ReadAllTextAsync(Path.Combine(_templateDirectory, $"{templateName}.liquid"), ct);
      template = Template.Parse(content);
      _cache[templateName] = template;
    }

    return await template.RenderAsync(model, member => member.Name);
  }
}
```

```liquid
<p>Hi {{ customer_name }},</p>
<p>Thank you for your order <strong>#{{ order_id }}</strong>!</p>
{{ for item in items }}
  <li>{{ item.product_name }} × {{ item.quantity }} — ${{ item.unit_price }}</li>
{{ end }}
<p class="total">Total: ${{ total_amount }}</p>
```

**Benefits**:
- ✅ **Separation of Concerns**: Business logic separate from presentation
- ✅ **Non-Technical Editing**: Marketing can update templates
- ✅ **Testability**: Unit test template rendering independently

---

## Step 4: Service Configuration

**ECommerce.NotificationWorker/Program.cs** (condensed from the sample):

```csharp{title="Step 4: Service Configuration" description="**ECommerce." category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Step", "Service"] unverified="host/DI wiring — not exercised by a test"}
using Whizbang.Core;
using Whizbang.Core.Generated;
using Whizbang.Data.EFCore.Postgres;
using Whizbang.Transports.AzureServiceBus;
using ECommerce.Contracts.Generated;
using ECommerce.NotificationWorker;
using ECommerce.NotificationWorker.Generated;

var builder = Host.CreateApplicationBuilder(args);

builder.AddServiceDefaults();

var serviceBusConnection = builder.Configuration.GetConnectionString("servicebus")
    ?? throw new InvalidOperationException("Azure Service Bus connection string 'servicebus' not found");

builder.Services.AddAzureServiceBusTransport(serviceBusConnection);
builder.Services.AddAzureServiceBusHealthChecks();

// Unified Whizbang API: routing + EF Core Postgres driver + transport consumer
_ = builder.Services
  .AddWhizbang()
  .WithRouting(routing => {
    routing
      .OwnDomains("ecommerce.notification.commands")
      .SubscribeTo("ecommerce.orders.events")
      .Inbox.UseSharedTopic("inbox");
  })
  .WithEFCore<NotificationDbContext>()
  .WithDriver.Postgres
  .AddTransportConsumer();

builder.Services.AddReceptors();
builder.Services.AddWhizbangDispatcher();

// Production: register providers here
// builder.Services.AddSingleton<IEmailProvider, SendGridEmailProvider>();
// builder.Services.AddSingleton<ISmsProvider, TwilioSmsProvider>();
// builder.Services.AddSingleton<ITemplateRenderer, ScribanTemplateRenderer>();

var host = builder.Build();

using (var scope = host.Services.CreateScope()) {
  var dbContext = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();
  var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
  await dbContext.EnsureWhizbangDatabaseInitializedAsync(logger);
}

host.Run();
```

---

## Step 5: Test Notifications

### 1. Update Aspire

**ECommerce.AppHost/Program.cs** (excerpt matching the sample):

```csharp{title="Update Aspire" description="**ECommerce." category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Update", "Aspire"] unverified="host/DI wiring — not exercised by a test"}
var notificationDb = postgres.AddDatabase("notificationdb");

ordersTopic.AddServiceBusSubscription("sub-notification-orders");
inboxTopic.AddServiceBusSubscription("sub-inbox-notification").WithDestinationFilter("notification-service");

var notificationWorker = builder.AddProject("notificationworker", "../ECommerce.NotificationWorker/ECommerce.NotificationWorker.csproj")
    .WithReference(notificationDb)
    .WithReference(messagingInfra)
    .WaitFor(notificationDb)
    .WaitFor(messagingInfra);
```

### 2. Create Order

```bash{title="Create Order" description="Create Order" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Create", "Order"]}
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{ "customerId": "...", "lineItems": [ ... ] }'
```

### 3. Verify Events

```sql{title="Verify Database" description="Verify Database" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Verify", "Database"]}
SELECT stream_id, event_type, created_at
FROM wh_event_store
WHERE event_type LIKE '%Notification%'
ORDER BY created_at DESC;
```

**Expected**: a `NotificationSentEvent` row per notification, streamed by `CustomerId`.

---

## Key Concepts

### One Receptor per Message Type

```csharp{title="Multi-Event Subscriptions" description="Multi-Event Subscriptions" category="Example" difficulty="BEGINNER" tags=["Learn", "Tutorial", "Multi-Event", "Subscriptions"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (SendNotificationReceptorTests), which is outside the core unit-test coverage map"}
// Commands have receptors...
public class SendNotificationReceptor : IReceptor<SendNotificationCommand, NotificationSentEvent> { /* ... */ }

// ...and events can have receptors too (event → follow-up command/notification)
public class OrderConfirmationReceptor : IReceptor<OrderCreatedEvent, SendNotificationCommand> { /* ... */ }
public class ShipmentNotificationReceptor : IReceptor<ShipmentCreatedEvent, SendNotificationCommand> { /* ... */ }
```

Routing determines which topics this worker consumes (`SubscribeTo("ecommerce.orders.events")`), and receptor discovery wires each message type to its handler — no per-subscription plumbing.

---

## Testing

**tests/ECommerce.NotificationWorker.Tests/SendNotificationReceptorTests.cs** (condensed):

```csharp{title="Unit Test - Send Notification" description="Unit Test - Send Notification" category="Example" difficulty="INTERMEDIATE" tags=["Learn", "Tutorial", "Unit", "Test"] unverified="tutorial worked-example — exercised by the ECommerce sample suite (SendNotificationReceptorTests), which is outside the core unit-test coverage map"}
[Test]
public async Task HandleAsync_SendsNotification_ReturnsNotificationSentEventAsync() {
  // Arrange
  var dispatcher = new TestDispatcher(); // records PublishAsync calls
  var logger = NullLogger<SendNotificationReceptor>.Instance;
  var receptor = new SendNotificationReceptor(dispatcher, logger);

  var command = new SendNotificationCommand {
    CustomerId = "customer-123",
    Subject = "Order Confirmation",
    Message = "Your order has been confirmed.",
    Type = NotificationType.Email
  };

  // Act
  var result = await receptor.HandleAsync(command, CancellationToken.None);

  // Assert
  await Assert.That(result.CustomerId).IsEqualTo("customer-123");
  await Assert.That(result.Type).IsEqualTo(NotificationType.Email);
  await Assert.That(dispatcher.PublishedEvents).Count().IsEqualTo(1);
}
```

---

## Next Steps

Continue to **[Shipping Service](shipping-service.md)** to:
- React to `PaymentProcessedEvent` with a receptor
- Create shipments and publish `ShipmentCreatedEvent`
- See event → command chaining in action

---

## Key Takeaways

✅ **Command-Driven Notifications** - `SendNotificationCommand` → `NotificationSentEvent`
✅ **Receptor Contract** - `ValueTask<TResponse> HandleAsync(TMessage, CancellationToken)`
✅ **Provider Abstraction** - Swap email/SMS providers easily
✅ **Template Rendering** - Scriban for maintainable email templates
✅ **Delivery Tracking** - Materialize `NotificationSentEvent` into a perspective for auditing

---

*Version 1.0.0 - Foundation Release | Last Updated: 2026-07-16*
