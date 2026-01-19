---
title: "ECommerce Tutorial Overview"
version: 0.1.0
category: Tutorial
order: 1
description: "Build a complete e-commerce system with Whizbang - microservices, event sourcing, CQRS, and distributed messaging"
tags: tutorial, ecommerce, microservices, event-sourcing, cqrs, distributed-systems
---

# ECommerce Tutorial Overview

Build a **complete e-commerce system** using Whizbang to learn all framework features through a realistic, production-ready example.

## What You'll Build

A distributed e-commerce platform with 7 microservices:

```
┌─────────────────────────────────────────────────────────────┐
│  ECommerce Platform Architecture                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Order      │  │  Inventory   │  │   Payment    │     │
│  │   Service    │  │   Service    │  │   Service    │     │
│  │  (Commands)  │  │  (Commands)  │  │  (Commands)  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                  ┌─────────▼─────────┐                      │
│                  │  Azure Service    │                      │
│                  │      Bus          │                      │
│                  │   (Event Hub)     │                      │
│                  └─────────┬─────────┘                      │
│                            │                                │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐     │
│  │Notification  │  │   Shipping   │  │  Analytics   │     │
│  │   Service    │  │   Service    │  │   Service    │     │
│  │  (Events)    │  │  (Events)    │  │(Perspectives)│     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Services

| Service | Type | Purpose |
|---------|------|---------|
| **Order Service** | Command API | Order management, CRUD operations |
| **Inventory Service** | Command Worker | Stock tracking, reservations |
| **Payment Service** | Command Worker | Payment processing, transactions |
| **Notification Service** | Event Worker | Email/SMS notifications |
| **Shipping Service** | Event Worker | Shipment creation, tracking |
| **Customer Service** | Query API | Customer read models (BFF) |
| **Analytics Service** | Event Worker | Real-time analytics, reporting |

## What You'll Learn

### Core Features
- ✅ **Commands & Events** - Request/response + pub/sub patterns
- ✅ **Receptors** - Message handlers with business logic
- ✅ **Perspectives** - Event-driven read models (CQRS)
- ✅ **Dispatcher** - Zero-reflection message routing
- ✅ **Message Context** - Correlation, causation, tracing

### Messaging Patterns
- ✅ **Outbox Pattern** - Reliable cross-service events
- ✅ **Inbox Pattern** - Exactly-once message processing
- ✅ **Work Coordination** - Lease-based distributed processing
- ✅ **Event Envelopes** - Hop-based observability

### Data Access
- ✅ **Dapper + PostgreSQL** - High-performance queries
- ✅ **EF Core 10** - Full-featured ORM
- ✅ **Event Store** - Event sourcing with time-travel
- ✅ **Perspectives Storage** - Read model schemas

### Infrastructure
- ✅ **.NET Aspire** - Local orchestration with emulators
- ✅ **Azure Service Bus** - Production messaging
- ✅ **Health Checks** - Kubernetes readiness/liveness
- ✅ **Policy-Based Routing** - Multi-tenant, environment-aware

### Advanced Topics
- ✅ **Source Generators** - Zero-reflection discovery
- ✅ **AOT Compatibility** - Native AOT deployment
- ✅ **Testing** - Unit, integration, e2e tests
- ✅ **Deployment** - Docker, Kubernetes, Azure

## Prerequisites

- **.NET 10.0 RC2+** SDK
- **Docker Desktop** (for PostgreSQL, Azurite, Service Bus emulator)
- **Visual Studio 2024** or **VS Code** with C# DevKit
- **Azure CLI** (for production deployment)
- **Basic C# knowledge** (records, async/await, dependency injection)

## Tutorial Structure

### Part 1: Foundation (Order & Inventory)
1. **[Tutorial Overview](tutorial-overview.md)** ← You are here
2. **[Order Management](order-management.md)** - Create orders, command handling
3. **[Inventory Service](inventory-service.md)** - Stock reservations, event publishing

### Part 2: Distributed Processing (Payment & Notifications)
4. **[Payment Processing](payment-processing.md)** - Payment gateway integration
5. **[Notification Service](notification-service.md)** - Email/SMS via events

### Part 3: Logistics & Analytics (Shipping & Reporting)
6. **[Shipping Service](shipping-service.md)** - Shipment creation, tracking
7. **[Analytics Service](analytics-service.md)** - Real-time dashboards

### Part 4: Customer Experience (Read Models)
8. **[Customer Service](customer-service.md)** - BFF pattern, perspectives

### Part 5: Production Readiness
9. **[Testing Strategy](testing-strategy.md)** - Unit, integration, e2e tests
10. **[Deployment](deployment.md)** - Docker, Kubernetes, Azure

## Project Setup

### 1. Create Solution

```bash
mkdir ECommerce
cd ECommerce

dotnet new sln -n ECommerce
```

### 2. Add Projects

```bash
# Order Service (HTTP API)
dotnet new webapi -n ECommerce.OrderService.API
dotnet sln add ECommerce.OrderService.API

# Inventory Service (Background Worker)
dotnet new worker -n ECommerce.InventoryWorker
dotnet sln add ECommerce.InventoryWorker

# Payment Service (Background Worker)
dotnet new worker -n ECommerce.PaymentWorker
dotnet sln add ECommerce.PaymentWorker

# Notification Service (Background Worker)
dotnet new worker -n ECommerce.NotificationWorker
dotnet sln add ECommerce.NotificationWorker

# Shipping Service (Background Worker)
dotnet new worker -n ECommerce.ShippingWorker
dotnet sln add ECommerce.ShippingWorker

# Customer Service (HTTP API - BFF)
dotnet new webapi -n ECommerce.CustomerService.API
dotnet sln add ECommerce.CustomerService.API

# Analytics Service (Background Worker)
dotnet new worker -n ECommerce.AnalyticsWorker
dotnet sln add ECommerce.AnalyticsWorker

# Shared Contracts
dotnet new classlib -n ECommerce.Contracts
dotnet sln add ECommerce.Contracts

# Aspire App Host (Orchestration)
dotnet new aspire-apphost -n ECommerce.AppHost
dotnet sln add ECommerce.AppHost
```

### 3. Add Whizbang Packages

```bash
# All projects
dotnet add ECommerce.OrderService.API package Whizbang.Core
dotnet add ECommerce.InventoryWorker package Whizbang.Core
dotnet add ECommerce.PaymentWorker package Whizbang.Core
dotnet add ECommerce.NotificationWorker package Whizbang.Core
dotnet add ECommerce.ShippingWorker package Whizbang.Core
dotnet add ECommerce.CustomerService.API package Whizbang.Core
dotnet add ECommerce.AnalyticsWorker package Whizbang.Core

# Projects with Azure Service Bus
dotnet add ECommerce.OrderService.API package Whizbang.Transports.AzureServiceBus
dotnet add ECommerce.InventoryWorker package Whizbang.Transports.AzureServiceBus
dotnet add ECommerce.PaymentWorker package Whizbang.Transports.AzureServiceBus
dotnet add ECommerce.NotificationWorker package Whizbang.Transports.AzureServiceBus
dotnet add ECommerce.ShippingWorker package Whizbang.Transports.AzureServiceBus
dotnet add ECommerce.AnalyticsWorker package Whizbang.Transports.AzureServiceBus

# Projects with PostgreSQL
dotnet add ECommerce.OrderService.API package Whizbang.Data.Postgres
dotnet add ECommerce.InventoryWorker package Whizbang.Data.Postgres
dotnet add ECommerce.CustomerService.API package Whizbang.Data.Postgres
dotnet add ECommerce.AnalyticsWorker package Whizbang.Data.Postgres

# Aspire integration
dotnet add ECommerce.OrderService.API package Whizbang.Hosting.Azure.ServiceBus
dotnet add ECommerce.AppHost package Aspire.Hosting.Azure.ServiceBus
```

### 4. Project Structure

```
ECommerce/
├── ECommerce.sln
├── ECommerce.AppHost/             # .NET Aspire orchestration
├── ECommerce.Contracts/           # Shared messages
│   ├── Commands/
│   │   ├── CreateOrder.cs
│   │   ├── ReserveInventory.cs
│   │   └── ProcessPayment.cs
│   └── Events/
│       ├── OrderCreated.cs
│       ├── InventoryReserved.cs
│       └── PaymentProcessed.cs
├── ECommerce.OrderService.API/    # Order management
│   ├── Receptors/
│   │   ├── CreateOrderReceptor.cs
│   │   └── CancelOrderReceptor.cs
│   └── Controllers/
│       └── OrdersController.cs
├── ECommerce.InventoryWorker/     # Inventory management
│   ├── Receptors/
│   │   └── ReserveInventoryReceptor.cs
│   └── Perspectives/
│       └── InventorySummaryPerspective.cs
├── ECommerce.PaymentWorker/       # Payment processing
│   └── Receptors/
│       └── ProcessPaymentReceptor.cs
├── ECommerce.NotificationWorker/  # Notifications
│   └── Receptors/
│       └── SendNotificationReceptor.cs
├── ECommerce.ShippingWorker/      # Shipping
│   └── Receptors/
│       └── CreateShipmentReceptor.cs
├── ECommerce.CustomerService.API/ # Customer BFF
│   ├── Perspectives/
│   │   ├── OrderSummaryPerspective.cs
│   │   └── CustomerActivityPerspective.cs
│   └── Controllers/
│       └── CustomersController.cs
└── ECommerce.AnalyticsWorker/     # Analytics
    └── Perspectives/
        └── DailySalesAnalyticsPerspective.cs
```

## Key Concepts Demonstrated

### Event-Driven Architecture

```csharp
// Command: Create Order (synchronous)
CreateOrder command → CreateOrderReceptor → OrderCreated event

// Event: Order Created (asynchronous pub/sub)
OrderCreated event → Published to Azure Service Bus
  ├─ InventoryWorker → ReserveInventory
  ├─ NotificationWorker → SendOrderConfirmation
  └─ AnalyticsWorker → UpdateDailySales (perspective)
```

### CQRS (Command Query Responsibility Segregation)

**Write Side**:
- Order Service receives `CreateOrder` command
- CreateOrderReceptor handles command
- Publishes `OrderCreated` event to event bus

**Read Side**:
- Customer Service subscribes to `OrderCreated` events
- OrderSummaryPerspective updates read model
- CustomersController queries read model (fast!)

### Saga Pattern (Distributed Transactions)

```
1. CreateOrder → OrderCreated
2. OrderCreated → ReserveInventory → InventoryReserved
3. InventoryReserved → ProcessPayment → PaymentProcessed
4. PaymentProcessed → CreateShipment → ShipmentCreated
5. ShipmentCreated → SendShippingNotification → NotificationSent

Compensation (if payment fails):
- PaymentFailed → ReleaseInventory → InventoryReleased
```

## Development Workflow

### 1. Run Locally (Aspire)

```bash
cd ECommerce.AppHost
dotnet run
```

Open Aspire Dashboard: `http://localhost:15000`

### 2. Create Order via API

```bash
curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-123",
    "items": [
      { "productId": "prod-456", "quantity": 2, "unitPrice": 19.99 }
    ]
  }'
```

### 3. Observe Event Flow

Check Aspire Dashboard:
- Order Service: HTTP request logged
- Service Bus: OrderCreated event published
- Inventory Worker: InventoryReserved event published
- Payment Worker: PaymentProcessed event published
- Notification Worker: Email sent

### 4. Query Read Model

```bash
curl http://localhost:5001/customers/cust-123/orders
```

Returns denormalized order summary from read model (fast!).

## Next Steps

Continue to **[Order Management](order-management.md)** to start building the Order Service.

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
