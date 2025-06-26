---
title: Simple C# Code Examples
category: Core concepts
order: 4
---

# Simple C# Code Examples

Basic examples to test the enhanced C# code block functionality.

## Simple Console Application

```csharp{
title: "Hello World Console App"
description: "A simple console application demonstrating basic C# syntax"
framework: "NET8"
difficulty: "BEGINNER"
filename: "Program.cs"
}
using System;

namespace HelloWorld
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Hello, World!");
            Console.WriteLine("Welcome to enhanced C# code viewing!");
            
            var message = GetWelcomeMessage("Developer");
            Console.WriteLine(message);
        }
        
        static string GetWelcomeMessage(string name)
        {
            return $"Hello, {name}! Today is {DateTime.Now:yyyy-MM-dd}";
        }
    }
}
```

## Basic Class Example

```csharp{
title: "Person Class"
description: "Simple class with properties and methods"
category: "ENTITY"
difficulty: "BEGINNER"
tags: ["Class", "Properties", "Methods"]
filename: "Person.cs"
}
public class Person
{
    public string Name { get; set; }
    public int Age { get; set; }
    public string Email { get; set; }
    
    public Person(string name, int age, string email)
    {
        Name = name;
        Age = age;
        Email = email;
    }
    
    public void DisplayInfo()
    {
        Console.WriteLine($"Name: {Name}");
        Console.WriteLine($"Age: {Age}");
        Console.WriteLine($"Email: {Email}");
    }
    
    public bool IsAdult()
    {
        return Age >= 18;
    }
}
```

## NuGet Package Example

```csharp{
title: "JSON Serialization Example"
description: "Using Newtonsoft.Json for JSON operations"
framework: "NET8"
difficulty: "INTERMEDIATE"
tags: ["JSON", "Serialization", "NuGet"]
nugetPackages: ["Newtonsoft.Json"]
filename: "JsonExample.cs"
}
using Newtonsoft.Json;
using System.Collections.Generic;

public class JsonExample
{
    public void SerializeExample()
    {
        var person = new Person("John Doe", 30, "john@example.com");
        
        // Serialize to JSON
        string json = JsonConvert.SerializeObject(person, Formatting.Indented);
        Console.WriteLine("Serialized JSON:");
        Console.WriteLine(json);
        
        // Deserialize from JSON
        var deserializedPerson = JsonConvert.DeserializeObject<Person>(json);
        Console.WriteLine("\nDeserialized object:");
        deserializedPerson.DisplayInfo();
    }
}
```
