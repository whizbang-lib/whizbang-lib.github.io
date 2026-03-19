---
title: Polymorphic Types
version: 1.0.0
category: GraphQL
order: 6
description: >-
  Register polymorphic type hierarchies with HotChocolate GraphQL - automatic
  discovery from JsonDerivedType attributes
tags: 'graphql, polymorphic, interfaces, json, hotchocolate, inheritance'
codeReferences:
  - src/Whizbang.Transports.HotChocolate/Extensions/PolymorphicTypeExtensions.cs
testReferences:
  - tests/Whizbang.Transports.HotChocolate.Tests/Unit/PolymorphicTypeExtensionsTests.cs
---

# Polymorphic Types in GraphQL

Whizbang provides extension methods to register polymorphic type hierarchies with HotChocolate, enabling turn-key GraphQL support for types using `[JsonPolymorphic]` and `[JsonDerivedType]` attributes.

## Overview

The `PolymorphicTypeExtensions` class enables:

- **Automatic Type Registration** - Base type becomes GraphQL interface, derived types become implementations
- **Attribute Discovery** - Derived types discovered from `[JsonDerivedType]` attributes
- **Consistent Serialization** - Same type hierarchy works for JSON API and GraphQL
- **AOT Compatible** - No reflection at runtime

## Installation

```bash
dotnet add package Whizbang.Transports.HotChocolate
```

## Defining Polymorphic Types

### Base Type with Attributes

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(TextFieldSettings), "text")]
[JsonDerivedType(typeof(NumberFieldSettings), "number")]
[JsonDerivedType(typeof(DateFieldSettings), "date")]
public abstract class AbstractFieldSettings {
    public string Label { get; init; } = "";
    public bool Required { get; init; }
}

public class TextFieldSettings : AbstractFieldSettings {
    public int? MaxLength { get; init; }
    public string? Placeholder { get; init; }
}

public class NumberFieldSettings : AbstractFieldSettings {
    public decimal? MinValue { get; init; }
    public decimal? MaxValue { get; init; }
    public int DecimalPlaces { get; init; }
}

public class DateFieldSettings : AbstractFieldSettings {
    public DateOnly? MinDate { get; init; }
    public DateOnly? MaxDate { get; init; }
    public string Format { get; init; } = "yyyy-MM-dd";
}
```

## Registration Methods

### Auto-Discovery

Automatically discovers derived types from `[JsonDerivedType]` attributes:

```csharp
builder.Services.AddGraphQLServer()
    .AddWhizbangLenses()
    .AddPolymorphicType<AbstractFieldSettings>();
```

### Explicit Registration

Manually specify derived types:

```csharp
builder.Services.AddGraphQLServer()
    .AddWhizbangLenses()
    .AddPolymorphicType<AbstractFieldSettings>(
        typeof(TextFieldSettings),
        typeof(NumberFieldSettings),
        typeof(DateFieldSettings));
```

## Generated GraphQL Schema

The registration generates:

```graphql
interface AbstractFieldSettings {
  label: String!
  required: Boolean!
}

type TextFieldSettings implements AbstractFieldSettings {
  label: String!
  required: Boolean!
  maxLength: Int
  placeholder: String
}

type NumberFieldSettings implements AbstractFieldSettings {
  label: String!
  required: Boolean!
  minValue: Decimal
  maxValue: Decimal
  decimalPlaces: Int!
}

type DateFieldSettings implements AbstractFieldSettings {
  label: String!
  required: Boolean!
  minDate: Date
  maxDate: Date
  format: String!
}
```

## Querying Polymorphic Types

### Fragment Spread

```graphql
{
  formFields {
    nodes {
      settings {
        label
        required
        ... on TextFieldSettings {
          maxLength
          placeholder
        }
        ... on NumberFieldSettings {
          minValue
          maxValue
          decimalPlaces
        }
        ... on DateFieldSettings {
          minDate
          maxDate
          format
        }
      }
    }
  }
}
```

### Inline Fragments

```graphql
{
  formFields {
    nodes {
      settings {
        __typename
        label
        required
        ... on TextFieldSettings { maxLength }
        ... on NumberFieldSettings { decimalPlaces }
      }
    }
  }
}
```

## Complete Example

### Model Definitions

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$type")]
[JsonDerivedType(typeof(EmailNotification), "email")]
[JsonDerivedType(typeof(SmsNotification), "sms")]
[JsonDerivedType(typeof(PushNotification), "push")]
public abstract class NotificationSettings {
    public bool Enabled { get; init; }
}

public class EmailNotification : NotificationSettings {
    public string EmailAddress { get; init; } = "";
    public bool IncludeAttachments { get; init; }
}

public class SmsNotification : NotificationSettings {
    public string PhoneNumber { get; init; } = "";
}

public class PushNotification : NotificationSettings {
    public string DeviceToken { get; init; } = "";
    public bool ShowBadge { get; init; }
}
```

### Service Registration

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddGraphQLServer()
    .AddWhizbangLenses()
    .AddPolymorphicType<NotificationSettings>()
    .AddQueryType<Query>();

var app = builder.Build();
app.MapGraphQL();
app.Run();
```

### Query Type

```csharp
public class Query {
    public NotificationSettings GetUserNotificationSettings(
        [Service] IUserService userService,
        Guid userId) {
        return userService.GetNotificationSettings(userId);
    }
}
```

### GraphQL Query

```graphql
{
  userNotificationSettings(userId: "...") {
    __typename
    enabled
    ... on EmailNotification {
      emailAddress
      includeAttachments
    }
    ... on SmsNotification {
      phoneNumber
    }
    ... on PushNotification {
      deviceToken
      showBadge
    }
  }
}
```

## Error Handling

### Missing JsonPolymorphic Attribute

```csharp
// This will throw InvalidOperationException
builder.Services.AddGraphQLServer()
    .AddPolymorphicType<SomeTypeWithoutAttribute>();
// Error: "Type 'SomeTypeWithoutAttribute' must have [JsonPolymorphic] attribute to use AddPolymorphicType."
```

### Missing JsonDerivedType Attributes

```csharp
[JsonPolymorphic]
public abstract class BaseType { } // No [JsonDerivedType] attributes

// This will throw InvalidOperationException
builder.Services.AddGraphQLServer()
    .AddPolymorphicType<BaseType>();
// Error: "Type 'BaseType' must have at least one [JsonDerivedType] attribute to use AddPolymorphicType."
```

## Best Practices

1. **Use Consistent Discriminators** - Keep `$type` discriminator consistent between JSON API and GraphQL
2. **Prefer Auto-Discovery** - Let the extension discover types from attributes to keep registration DRY
3. **Explicit for Flexibility** - Use explicit registration when you need to expose different types to GraphQL than JSON
4. **Test Both APIs** - Verify polymorphic types work in both REST/JSON and GraphQL contexts

## Related Documentation

- [GraphQL Setup](setup.md) - HotChocolate configuration
- [Lens Integration](lens-integration.md) - Exposing lenses via GraphQL
- [JSON Serialization](../core-concepts/json-serialization.md) - AOT-compatible serialization
