---
title: "Notification Service"
version: 0.1.0
category: Tutorial
order: 5
description: "Build the Notification Worker - email/SMS notifications, template rendering, and delivery tracking"
tags: tutorial, notification-service, email, sms, event-driven
---

# Notification Service

Build the **Notification Worker** - a background service that subscribes to multiple events (`OrderCreated`, `PaymentProcessed`, `ShipmentCreated`) and sends notifications via email/SMS.

:::note
This is **Part 4** of the ECommerce Tutorial. Complete [Payment Processing](payment-processing.md) first.
:::

---

## What You'll Build

```
┌─────────────────────────────────────────────────────────────┐
│  Notification Service Architecture                          │
│                                                              │
│  ┌─────────────┐                                            │
│  │Azure Service│  OrderCreated, PaymentProcessed, etc.      │
│  │     Bus     │──────────────────────────┐                 │
│  └─────────────┘                          │                 │
│                                            ▼                 │
│                          ┌────────────────────────────┐     │
│                          │  Multiple Event Receptors  │     │
│                          │  - OrderConfirmationReceptor│    │
│                          │  - PaymentReceiptReceptor  │     │
│                          │  - ShipmentNotificationReceptor│ │
│                          └──────────┬─────────────────┘     │
│                                     │                        │
│                      ┌──────────────┼──────────────┐        │
│                      │              │              │        │
│                      ▼              ▼              ▼        │
│                 ┌─────────┐   ┌─────────┐   ┌──────────┐   │
│                 │Template │   │  Email  │   │Postgres  │   │
│                 │ Engine  │   │Provider │   │ Tracking │   │
│                 │(Scriban)│   │(SendGrid│   │  Table   │   │
│                 └─────────┘   │/Twilio) │   └──────────┘   │
│                               └─────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

**Features**:
- ✅ Multi-event subscriptions
- ✅ Email notifications (SendGrid)
- ✅ SMS notifications (Twilio)
- ✅ Template rendering (Scriban)
- ✅ Delivery tracking
- ✅ Retry logic for failed sends

---

## Step 1: Notification Providers

### Email Provider (SendGrid)

**ECommerce.NotificationWorker/Services/IEmailProvider.cs**:

```csharp
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

**ECommerce.NotificationWorker/Services/SendGridEmailProvider.cs**:

```csharp
using SendGrid;
using SendGrid.Helpers.Mail;

namespace ECommerce.NotificationWorker.Services;

public class SendGridEmailProvider : IEmailProvider {
  private readonly SendGridClient _client;
  private readonly string _fromEmail;
  private readonly string _fromName;
  private readonly ILogger<SendGridEmailProvider> _logger;

  public SendGridEmailProvider(
    IConfiguration configuration,
    ILogger<SendGridEmailProvider> logger
  ) {
    var apiKey = configuration["SendGrid:ApiKey"]
      ?? throw new InvalidOperationException("SendGrid:ApiKey not configured");

    _client = new SendGridClient(apiKey);
    _fromEmail = configuration["SendGrid:FromEmail"] ?? "noreply@ecommerce.example.com";
    _fromName = configuration["SendGrid:FromName"] ?? "ECommerce Platform";
    _logger = logger;
  }

  public async Task<EmailResult> SendEmailAsync(
    string to,
    string subject,
    string htmlBody,
    string? textBody = null,
    CancellationToken ct = default
  ) {
    try {
      var from = new EmailAddress(_fromEmail, _fromName);
      var toAddress = new EmailAddress(to);
      var msg = MailHelper.CreateSingleEmail(
        from,
        toAddress,
        subject,
        textBody ?? htmlBody,
        htmlBody
      );

      var response = await _client.SendEmailAsync(msg, ct);

      if (response.IsSuccessStatusCode) {
        var messageId = response.Headers.GetValues("X-Message-Id").FirstOrDefault();
        _logger.LogInformation(
          "Email sent to {To}, subject: {Subject}, messageId: {MessageId}",
          to,
          subject,
          messageId
        );

        return new EmailResult(
          Success: true,
          MessageId: messageId,
          ErrorMessage: null
        );
      } else {
        var errorBody = await response.Body.ReadAsStringAsync();
        _logger.LogError(
          "Email send failed to {To}: {StatusCode} - {Error}",
          to,
          response.StatusCode,
          errorBody
        );

        return new EmailResult(
          Success: false,
          MessageId: null,
          ErrorMessage: $"{response.StatusCode}: {errorBody}"
        );
      }
    } catch (Exception ex) {
      _logger.LogError(ex, "Email send exception for {To}", to);
      return new EmailResult(
        Success: false,
        MessageId: null,
        ErrorMessage: ex.Message
      );
    }
  }
}
```

### SMS Provider (Twilio)

**ECommerce.NotificationWorker/Services/ISmsProvider.cs**:

```csharp
namespace ECommerce.NotificationWorker.Services;

public interface ISmsProvider {
  Task<SmsResult> SendSmsAsync(
    string to,
    string message,
    CancellationToken ct = default
  );
}

public record SmsResult(
  bool Success,
  string? MessageSid,
  string? ErrorMessage
);
```

**ECommerce.NotificationWorker/Services/TwilioSmsProvider.cs**:

```csharp
using Twilio;
using Twilio.Rest.Api.V2010.Account;
using Twilio.Types;

namespace ECommerce.NotificationWorker.Services;

public class TwilioSmsProvider : ISmsProvider {
  private readonly string _fromNumber;
  private readonly ILogger<TwilioSmsProvider> _logger;

  public TwilioSmsProvider(
    IConfiguration configuration,
    ILogger<TwilioSmsProvider> logger
  ) {
    var accountSid = configuration["Twilio:AccountSid"]
      ?? throw new InvalidOperationException("Twilio:AccountSid not configured");
    var authToken = configuration["Twilio:AuthToken"]
      ?? throw new InvalidOperationException("Twilio:AuthToken not configured");

    _fromNumber = configuration["Twilio:FromNumber"] ?? "+15551234567";

    TwilioClient.Init(accountSid, authToken);
    _logger = logger;
  }

  public async Task<SmsResult> SendSmsAsync(
    string to,
    string message,
    CancellationToken ct = default
  ) {
    try {
      var smsMessage = await MessageResource.CreateAsync(
        to: new PhoneNumber(to),
        from: new PhoneNumber(_fromNumber),
        body: message
      );

      if (smsMessage.Status == MessageResource.StatusEnum.Queued ||
          smsMessage.Status == MessageResource.StatusEnum.Sent) {
        _logger.LogInformation(
          "SMS sent to {To}, sid: {Sid}",
          to,
          smsMessage.Sid
        );

        return new SmsResult(
          Success: true,
          MessageSid: smsMessage.Sid,
          ErrorMessage: null
        );
      } else {
        _logger.LogError(
          "SMS send failed to {To}: {Status} - {ErrorMessage}",
          to,
          smsMessage.Status,
          smsMessage.ErrorMessage
        );

        return new SmsResult(
          Success: false,
          MessageSid: null,
          ErrorMessage: smsMessage.ErrorMessage
        );
      }
    } catch (Exception ex) {
      _logger.LogError(ex, "SMS send exception for {To}", to);
      return new SmsResult(
        Success: false,
        MessageSid: null,
        ErrorMessage: ex.Message
      );
    }
  }
}
```

---

## Step 2: Template Engine

**ECommerce.NotificationWorker/Services/ITemplateRenderer.cs**:

```csharp
namespace ECommerce.NotificationWorker.Services;

public interface ITemplateRenderer {
  Task<string> RenderAsync<TModel>(
    string templateName,
    TModel model,
    CancellationToken ct = default
  );
}
```

**ECommerce.NotificationWorker/Services/ScribanTemplateRenderer.cs**:

```csharp
using Scriban;
using Scriban.Runtime;

namespace ECommerce.NotificationWorker.Services;

public class ScribanTemplateRenderer : ITemplateRenderer {
  private readonly string _templateDirectory;
  private readonly Dictionary<string, Template> _cache = new();
  private readonly ILogger<ScribanTemplateRenderer> _logger;

  public ScribanTemplateRenderer(
    IConfiguration configuration,
    ILogger<ScribanTemplateRenderer> logger
  ) {
    _templateDirectory = configuration["Templates:Directory"] ?? "Templates";
    _logger = logger;
  }

  public async Task<string> RenderAsync<TModel>(
    string templateName,
    TModel model,
    CancellationToken ct = default
  ) {
    var template = await GetTemplateAsync(templateName, ct);

    var scriptObject = new ScriptObject();
    scriptObject.Import(model, renamer: member => member.Name);

    var context = new TemplateContext();
    context.PushGlobal(scriptObject);

    return await template.RenderAsync(context);
  }

  private async Task<Template> GetTemplateAsync(string templateName, CancellationToken ct) {
    if (_cache.TryGetValue(templateName, out var cachedTemplate)) {
      return cachedTemplate;
    }

    var templatePath = Path.Combine(_templateDirectory, $"{templateName}.liquid");
    if (!File.Exists(templatePath)) {
      throw new FileNotFoundException($"Template not found: {templatePath}");
    }

    var templateContent = await File.ReadAllTextAsync(templatePath, ct);
    var template = Template.Parse(templateContent);

    if (template.HasErrors) {
      var errors = string.Join(", ", template.Messages);
      throw new InvalidOperationException($"Template parse errors: {errors}");
    }

    _cache[templateName] = template;
    return template;
  }
}
```

**Templates/order-confirmation.liquid**:

```liquid
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .header { background-color: #4CAF50; color: white; padding: 20px; }
    .content { padding: 20px; }
    .order-items { border-collapse: collapse; width: 100%; }
    .order-items th, .order-items td { border: 1px solid #ddd; padding: 8px; }
    .total { font-weight: bold; font-size: 1.2em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Order Confirmation</h1>
  </div>
  <div class="content">
    <p>Hi {{ customer_name }},</p>
    <p>Thank you for your order! Your order <strong>#{{ order_id }}</strong> has been received and is being processed.</p>

    <h2>Order Details</h2>
    <table class="order-items">
      <thead>
        <tr>
          <th>Product</th>
          <th>Quantity</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {{ for item in items }}
        <tr>
          <td>{{ item.product_id }}</td>
          <td>{{ item.quantity }}</td>
          <td>${{ item.unit_price }}</td>
          <td>${{ item.line_total }}</td>
        </tr>
        {{ end }}
      </tbody>
    </table>

    <p class="total">Total: ${{ total_amount }}</p>

    <h2>Shipping Address</h2>
    <p>
      {{ shipping_address.street }}<br>
      {{ shipping_address.city }}, {{ shipping_address.state }} {{ shipping_address.zip_code }}<br>
      {{ shipping_address.country }}
    </p>

    <p>We'll send you another email when your order ships.</p>
    <p>Thanks,<br>The ECommerce Team</p>
  </div>
</body>
</html>
```

---

## Step 3: Database Schema

**ECommerce.NotificationWorker/Database/Migrations/001_CreateNotificationsTable.sql**:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,  -- 'OrderConfirmation', 'PaymentReceipt', 'ShipmentNotification'
  channel TEXT NOT NULL,  -- 'Email', 'SMS'
  recipient TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'Sent', 'Failed', 'Pending'
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_order_id ON notifications(order_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

---

## Step 4: Implement Receptors

### Order Confirmation Receptor

**ECommerce.NotificationWorker/Receptors/OrderConfirmationReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using ECommerce.NotificationWorker.Services;
using Npgsql;
using Dapper;

namespace ECommerce.NotificationWorker.Receptors;

public class OrderConfirmationReceptor : IReceptor<OrderCreated, NotificationSent> {
  private readonly NpgsqlConnection _db;
  private readonly IEmailProvider _emailProvider;
  private readonly ITemplateRenderer _templateRenderer;
  private readonly ILogger<OrderConfirmationReceptor> _logger;

  public OrderConfirmationReceptor(
    NpgsqlConnection db,
    IEmailProvider emailProvider,
    ITemplateRenderer templateRenderer,
    ILogger<OrderConfirmationReceptor> logger
  ) {
    _db = db;
    _emailProvider = emailProvider;
    _templateRenderer = templateRenderer;
    _logger = logger;
  }

  public async Task<NotificationSent> HandleAsync(
    OrderCreated @event,
    CancellationToken ct = default
  ) {
    var notificationId = Guid.NewGuid().ToString("N");

    try {
      // 1. Get customer email (in production, query customer service)
      var customerEmail = $"{@event.CustomerId}@example.com";  // Demo

      // 2. Render email template
      var htmlBody = await _templateRenderer.RenderAsync(
        "order-confirmation",
        new {
          customer_name = @event.CustomerId,
          order_id = @event.OrderId,
          items = @event.Items.Select(i => new {
            product_id = i.ProductId,
            quantity = i.Quantity,
            unit_price = i.UnitPrice,
            line_total = i.LineTotal
          }),
          total_amount = @event.TotalAmount,
          shipping_address = new {
            street = @event.ShippingAddress.Street,
            city = @event.ShippingAddress.City,
            state = @event.ShippingAddress.State,
            zip_code = @event.ShippingAddress.ZipCode,
            country = @event.ShippingAddress.Country
          }
        },
        ct
      );

      // 3. Send email
      var result = await _emailProvider.SendEmailAsync(
        to: customerEmail,
        subject: $"Order Confirmation - #{@event.OrderId}",
        htmlBody: htmlBody,
        ct: ct
      );

      // 4. Track notification
      await _db.ExecuteAsync(
        """
        INSERT INTO notifications (
          notification_id, order_id, notification_type, channel, recipient, subject, message,
          status, provider_message_id, error_message, sent_at, created_at
        )
        VALUES (
          @NotificationId, @OrderId, @NotificationType, @Channel, @Recipient, @Subject, @Message,
          @Status, @ProviderMessageId, @ErrorMessage, @SentAt, NOW()
        )
        """,
        new {
          NotificationId = notificationId,
          OrderId = @event.OrderId,
          NotificationType = "OrderConfirmation",
          Channel = "Email",
          Recipient = customerEmail,
          Subject = $"Order Confirmation - #{@event.OrderId}",
          Message = htmlBody,
          Status = result.Success ? "Sent" : "Failed",
          ProviderMessageId = result.MessageId,
          ErrorMessage = result.ErrorMessage,
          SentAt = result.Success ? DateTime.UtcNow : (DateTime?)null
        }
      );

      if (result.Success) {
        _logger.LogInformation(
          "Order confirmation sent for order {OrderId} to {Email}",
          @event.OrderId,
          customerEmail
        );

        return new NotificationSent(
          NotificationId: notificationId,
          OrderId: @event.OrderId,
          NotificationType: "OrderConfirmation",
          Channel: "Email",
          SentAt: DateTime.UtcNow
        );
      } else {
        throw new NotificationFailedException(
          notificationId,
          "OrderConfirmation",
          result.ErrorMessage ?? "Email send failed"
        );
      }
    } catch (Exception ex) when (ex is not NotificationFailedException) {
      _logger.LogError(ex, "Failed to send order confirmation for order {OrderId}", @event.OrderId);
      throw new NotificationFailedException(notificationId, "OrderConfirmation", ex.Message);
    }
  }
}

public record NotificationSent(
  string NotificationId,
  string OrderId,
  string NotificationType,
  string Channel,
  DateTime SentAt
) : IEvent;

public class NotificationFailedException : Exception {
  public NotificationFailedException(string notificationId, string type, string message)
    : base($"Notification {notificationId} ({type}) failed: {message}") { }
}
```

### Payment Receipt Receptor

**ECommerce.NotificationWorker/Receptors/PaymentReceiptReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using ECommerce.NotificationWorker.Services;
using Npgsql;
using Dapper;

namespace ECommerce.NotificationWorker.Receptors;

public class PaymentReceiptReceptor : IReceptor<PaymentProcessed, NotificationSent> {
  private readonly NpgsqlConnection _db;
  private readonly IEmailProvider _emailProvider;
  private readonly ITemplateRenderer _templateRenderer;
  private readonly ILogger<PaymentReceiptReceptor> _logger;

  public PaymentReceiptReceptor(
    NpgsqlConnection db,
    IEmailProvider emailProvider,
    ITemplateRenderer templateRenderer,
    ILogger<PaymentReceiptReceptor> logger
  ) {
    _db = db;
    _emailProvider = emailProvider;
    _templateRenderer = templateRenderer;
    _logger = logger;
  }

  public async Task<NotificationSent> HandleAsync(
    PaymentProcessed @event,
    CancellationToken ct = default
  ) {
    var notificationId = Guid.NewGuid().ToString("N");

    // Similar implementation to OrderConfirmationReceptor
    // Render "payment-receipt" template and send email

    // For brevity, omitted - follows same pattern as OrderConfirmation

    return new NotificationSent(
      NotificationId: notificationId,
      OrderId: @event.OrderId,
      NotificationType: "PaymentReceipt",
      Channel: "Email",
      SentAt: DateTime.UtcNow
    );
  }
}
```

### Shipment Notification Receptor (SMS)

**ECommerce.NotificationWorker/Receptors/ShipmentNotificationReceptor.cs**:

```csharp
using Whizbang.Core;
using ECommerce.Contracts.Events;
using ECommerce.NotificationWorker.Services;
using Npgsql;
using Dapper;

namespace ECommerce.NotificationWorker.Receptors;

public class ShipmentNotificationReceptor : IReceptor<ShipmentCreated, NotificationSent> {
  private readonly NpgsqlConnection _db;
  private readonly ISmsProvider _smsProvider;
  private readonly ILogger<ShipmentNotificationReceptor> _logger;

  public ShipmentNotificationReceptor(
    NpgsqlConnection db,
    ISmsProvider smsProvider,
    ILogger<ShipmentNotificationReceptor> logger
  ) {
    _db = db;
    _smsProvider = smsProvider;
    _logger = logger;
  }

  public async Task<NotificationSent> HandleAsync(
    ShipmentCreated @event,
    CancellationToken ct = default
  ) {
    var notificationId = Guid.NewGuid().ToString("N");

    try {
      // 1. Get customer phone (in production, query customer service)
      var customerPhone = "+15551234567";  // Demo

      // 2. Build SMS message
      var message = $"Your order #{@event.OrderId} has shipped! " +
                    $"Tracking: {@event.TrackingNumber}. " +
                    $"Estimated delivery: {@event.EstimatedDelivery:MM/dd/yyyy}";

      // 3. Send SMS
      var result = await _smsProvider.SendSmsAsync(
        to: customerPhone,
        message: message,
        ct: ct
      );

      // 4. Track notification
      await _db.ExecuteAsync(
        """
        INSERT INTO notifications (
          notification_id, order_id, notification_type, channel, recipient, message,
          status, provider_message_id, error_message, sent_at, created_at
        )
        VALUES (
          @NotificationId, @OrderId, @NotificationType, @Channel, @Recipient, @Message,
          @Status, @ProviderMessageId, @ErrorMessage, @SentAt, NOW()
        )
        """,
        new {
          NotificationId = notificationId,
          OrderId = @event.OrderId,
          NotificationType = "ShipmentNotification",
          Channel = "SMS",
          Recipient = customerPhone,
          Message = message,
          Status = result.Success ? "Sent" : "Failed",
          ProviderMessageId = result.MessageSid,
          ErrorMessage = result.ErrorMessage,
          SentAt = result.Success ? DateTime.UtcNow : (DateTime?)null
        }
      );

      if (result.Success) {
        _logger.LogInformation(
          "Shipment notification sent for order {OrderId} to {Phone}",
          @event.OrderId,
          customerPhone
        );

        return new NotificationSent(
          NotificationId: notificationId,
          OrderId: @event.OrderId,
          NotificationType: "ShipmentNotification",
          Channel: "SMS",
          SentAt: DateTime.UtcNow
        );
      } else {
        throw new NotificationFailedException(
          notificationId,
          "ShipmentNotification",
          result.ErrorMessage ?? "SMS send failed"
        );
      }
    } catch (Exception ex) when (ex is not NotificationFailedException) {
      _logger.LogError(ex, "Failed to send shipment notification for order {OrderId}", @event.OrderId);
      throw new NotificationFailedException(notificationId, "ShipmentNotification", ex.Message);
    }
  }
}
```

---

## Step 5: Service Configuration

**ECommerce.NotificationWorker/Program.cs**:

```csharp
using Whizbang.Core;
using Whizbang.Data.Postgres;
using Whizbang.Transports.AzureServiceBus;
using Npgsql;
using ECommerce.NotificationWorker.Services;

var builder = Host.CreateApplicationBuilder(args);

// 1. Add Whizbang
builder.Services.AddWhizbang(options => {
  options.ServiceName = "NotificationWorker";
  options.EnableInbox = true;
});

// 2. Add PostgreSQL
builder.Services.AddScoped<NpgsqlConnection>(sp => {
  var connectionString = builder.Configuration.GetConnectionString("NotificationDb");
  return new NpgsqlConnection(connectionString);
});

// 3. Add Azure Service Bus
builder.AddAzureServiceBus("messaging");

// 4. Add notification providers
builder.Services.AddSingleton<IEmailProvider, SendGridEmailProvider>();
builder.Services.AddSingleton<ISmsProvider, TwilioSmsProvider>();
builder.Services.AddSingleton<ITemplateRenderer, ScribanTemplateRenderer>();

// 5. Add Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
await host.MigrateDatabaseAsync();
await host.RunAsync();
```

**appsettings.json**:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Whizbang": "Debug"
    }
  },
  "ConnectionStrings": {
    "NotificationDb": "Host=localhost;Database=notification;Username=postgres;Password=postgres"
  },
  "SendGrid": {
    "ApiKey": "SG.xxx",
    "FromEmail": "noreply@ecommerce.example.com",
    "FromName": "ECommerce Platform"
  },
  "Twilio": {
    "AccountSid": "ACxxx",
    "AuthToken": "xxx",
    "FromNumber": "+15551234567"
  },
  "Templates": {
    "Directory": "Templates"
  },
  "Whizbang": {
    "ServiceName": "NotificationWorker",
    "Inbox": {
      "Enabled": true,
      "BatchSize": 100,
      "PollingInterval": "00:00:05"
    }
  }
}
```

---

## Step 6: Test Notifications

### 1. Update Aspire

**ECommerce.AppHost/Program.cs**:

```csharp
var notificationDb = postgres.AddDatabase("notification-db");

var notificationWorker = builder.AddProject<Projects.ECommerce_NotificationWorker>("notification-worker")
  .WithReference(notificationDb)
  .WithReference(serviceBus);
```

### 2. Create Order

```bash
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

### 3. Check Email (SendGrid Dashboard)

Navigate to SendGrid dashboard → Activity Feed → Search for recipient email

### 4. Verify Database

```sql
SELECT * FROM notifications WHERE order_id = '<order-id>';
```

**Expected**:
- Row for `OrderConfirmation` (Email) with `status = 'Sent'`
- Row for `PaymentReceipt` (Email) with `status = 'Sent'`
- Row for `ShipmentNotification` (SMS) with `status = 'Sent'`

---

## Key Concepts

### Multi-Event Subscriptions

```csharp
// Single service subscribes to multiple events
public class OrderConfirmationReceptor : IReceptor<OrderCreated, NotificationSent> { }
public class PaymentReceiptReceptor : IReceptor<PaymentProcessed, NotificationSent> { }
public class ShipmentNotificationReceptor : IReceptor<ShipmentCreated, NotificationSent> { }
```

**Azure Service Bus**:
- OrderCreated → `order-confirmation-subscription`
- PaymentProcessed → `payment-receipt-subscription`
- ShipmentCreated → `shipment-notification-subscription`

### Template Rendering

```liquid
{{ for item in items }}
  <tr>
    <td>{{ item.product_id }}</td>
    <td>{{ item.quantity }}</td>
    <td>${{ item.unit_price }}</td>
  </tr>
{{ end }}
```

**Benefits**:
- ✅ **Separation of Concerns**: Business logic separate from presentation
- ✅ **Non-Technical Editing**: Marketing can update templates
- ✅ **Testability**: Unit test template rendering independently

---

## Testing

### Unit Test - Email Rendering

```csharp
[Test]
public async Task OrderConfirmation_RendersTemplateCorrectlyAsync() {
  // Arrange
  var renderer = new ScribanTemplateRenderer(mockConfig, mockLogger);
  var model = new {
    customer_name = "John Doe",
    order_id = "order-123",
    items = new[] {
      new { product_id = "prod-456", quantity = 2, unit_price = 19.99m, line_total = 39.98m }
    },
    total_amount = 39.98m,
    shipping_address = new { street = "123 Main", city = "Springfield", state = "IL", zip_code = "62701", country = "USA" }
  };

  // Act
  var html = await renderer.RenderAsync("order-confirmation", model);

  // Assert
  await Assert.That(html).Contains("Order Confirmation");
  await Assert.That(html).Contains("order-123");
  await Assert.That(html).Contains("$39.98");
}
```

---

## Next Steps

Continue to **[Shipping Service](shipping-service.md)** to:
- Subscribe to `PaymentProcessed` events
- Create shipments via carrier API
- Publish `ShipmentCreated` events
- Track shipment status

---

## Key Takeaways

✅ **Multi-Event Subscriptions** - Single service handles multiple event types
✅ **Template Rendering** - Scriban for maintainable email templates
✅ **Provider Abstraction** - Swap email/SMS providers easily
✅ **Delivery Tracking** - Store notification history for auditing
✅ **Graceful Failures** - Log errors, don't block order processing

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
