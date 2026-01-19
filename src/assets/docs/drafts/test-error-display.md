---
title: Test Error Display
category: Test
---

# Test Error Display

This is a test page to verify that our front-matter error display is working.

## Code with Front-Matter (Should be fine)

```csharp{
title: "Good Example"
description: "This has proper front-matter"
framework: "NET8"
category: "Test"
difficulty: "BEGINNER"
tags: ["Test"]
}
public class GoodExample {
    public string Message { get; set; } = "I have front-matter!";
}
```

## Code WITHOUT Front-Matter (Should show error)

```csharp
public class BadExample {
    public string Message { get; set; } = "I need front-matter!";
}
```

## Another Bad Example

```javascript
function badFunction() {
    console.log("This JS code also needs front-matter!");
}
```

## Non-Code Block (Should be fine)

```text
This is just text, no error needed.
```