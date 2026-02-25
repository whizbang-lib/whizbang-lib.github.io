---
title: Installation Guide
version: 1.0.0
category: Getting Started
order: 2
description: >-
  Install Whizbang and set up your first project with NuGet packages, project
  templates, and IDE configuration
tags: 'installation, setup, nuget, project-templates'
codeReferences:
  - Directory.Build.props
  - Directory.Packages.props
---

# Installation Guide

This guide walks you through installing Whizbang and setting up your first project.

## Prerequisites

Before installing Whizbang, ensure you have:

### Required

- **.NET 10.0 SDK** (RC2 or later)
  ```bash
  dotnet --version
  # Should show 10.0.0 or later
  ```

- **C# 13** language support (included with .NET 10 SDK)

### Recommended

- **Visual Studio 2024** (17.12+) or **Visual Studio Code** with C# Dev Kit
- **Docker Desktop** (for PostgreSQL and Azure Service Bus Emulator)
- **.NET Aspire Workload** (for orchestration):
  ```bash
  dotnet workload install aspire
  ```

## Installation Options

### Option 1: NuGet Packages (Recommended)

Install Whizbang packages for your specific needs:

#### Core Package

```bash
dotnet add package Whizbang.Core
```

**Includes**:
- Core interfaces (`IDispatcher`, `IReceptor`, `IPerspectiveOf`)
- Message envelope and observability
- Object pooling for performance
- Policy engine foundation

#### Data Access Packages

**Dapper + PostgreSQL** (lightweight, fast):
```bash
dotnet add package Whizbang.Data.Dapper.Postgres
```

**EF Core + PostgreSQL** (full-featured):
```bash
dotnet add package Whizbang.Data.EFCore.Postgres
dotnet add package Whizbang.Data.EFCore.Postgres.Generators
```

**SQLite** (development/testing):
```bash
dotnet add package Whizbang.Data.Dapper.Sqlite
```

#### Transport Packages

**Azure Service Bus**:
```bash
dotnet add package Whizbang.Transports.AzureServiceBus
dotnet add package Whizbang.Hosting.Azure.ServiceBus
```

#### Source Generators

**Automatic Discovery**:
```bash
dotnet add package Whizbang.Generators
```

**Includes**:
- Receptor discovery and registration
- Perspective discovery
- Message registry generation (VSCode extension)
- Aggregate ID generation
- AOT-compatible JSON contexts

### Option 2: Package Bundle

For complete functionality, add all packages:

```xml
<!-- YourProject.csproj -->
<ItemGroup>
  <PackageReference Include="Whizbang.Core" Version="0.1.0" />
  <PackageReference Include="Whizbang.Generators" Version="0.1.0" />
  <PackageReference Include="Whizbang.Data.Dapper.Postgres" Version="0.1.0" />
  <PackageReference Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />
  <PackageReference Include="Whizbang.Hosting.Azure.ServiceBus" Version="0.1.0" />
</ItemGroup>
```

### Option 3: Central Package Management (Recommended for Solutions)

Use `Directory.Packages.props` for version management:

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>

  <ItemGroup>
    <!-- Whizbang Packages -->
    <PackageVersion Include="Whizbang.Core" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Generators" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Data.Dapper.Postgres" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Data.EFCore.Postgres" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Data.EFCore.Postgres.Generators" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Transports.AzureServiceBus" Version="0.1.0" />
    <PackageVersion Include="Whizbang.Hosting.Azure.ServiceBus" Version="0.1.0" />
  </ItemGroup>
</Project>
```

Then in project files:

```xml
<!-- YourProject.csproj -->
<ItemGroup>
  <PackageReference Include="Whizbang.Core" />
  <PackageReference Include="Whizbang.Generators" />
  <!-- Versions come from Directory.Packages.props -->
</ItemGroup>
```

## Project Setup

### 1. Create New Project

```bash
# Create solution
dotnet new sln -n MyWhizbangApp

# Create ASP.NET Core Web API project
dotnet new webapi -n MyWhizbangApp.API
dotnet sln add MyWhizbangApp.API

# Add Whizbang packages
cd MyWhizbangApp.API
dotnet add package Whizbang.Core
dotnet add package Whizbang.Generators
dotnet add package Whizbang.Data.Dapper.Postgres
```

### 2. Configure Target Framework

Ensure your project targets .NET 10:

```xml
<!-- MyWhizbangApp.API.csproj -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>13</LangVersion> <!-- C# 13 for latest features -->
  </PropertyGroup>
</Project>
```

### 3. Add Directory.Build.props (Optional but Recommended)

Create solution-level build configuration:

```xml
<!-- Directory.Build.props -->
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>13</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>

  <PropertyGroup>
    <!-- Source Generator Settings -->
    <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
    <CompilerGeneratedFilesOutputPath>$(MSBuildProjectDirectory)/.whizbang-generated</CompilerGeneratedFilesOutputPath>
  </PropertyGroup>
</Project>
```

### 4. Configure .editorconfig (K&R/Egyptian Braces)

Whizbang follows K&R/Egyptian braces style:

```ini
# .editorconfig
root = true

[*.cs]
# Brace style - K&R/Egyptian (opening brace on same line)
csharp_new_line_before_open_brace = none
csharp_new_line_before_else = false
csharp_new_line_before_catch = false
csharp_new_line_before_finally = false

# Indentation
indent_style = space
indent_size = 4

# Naming conventions
dotnet_naming_rule.async_methods_end_in_async.severity = warning
dotnet_naming_rule.async_methods_end_in_async.symbols = async_methods
dotnet_naming_rule.async_methods_end_in_async.style = end_in_async

dotnet_naming_symbols.async_methods.applicable_kinds = method
dotnet_naming_symbols.async_methods.required_modifiers = async

dotnet_naming_style.end_in_async.required_suffix = Async
dotnet_naming_style.end_in_async.capitalization = pascal_case
```

## Database Setup

### PostgreSQL (Recommended for Production)

#### Option A: Docker (Easiest)

```bash
docker run -d \
  --name whizbang-postgres \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_USER=whizbang \
  -e POSTGRES_DB=whizbang \
  -p 5432:5432 \
  postgres:16
```

#### Option B: .NET Aspire (Automatic)

With Aspire, PostgreSQL starts automatically:

```csharp
// AppHost/Program.cs
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("postgres")
    .WithPgAdmin()
    .AddDatabase("whizbangdb");

var api = builder.AddProject<Projects.MyWhizbangApp_API>("api")
    .WithReference(postgres);

builder.Build().Run();
```

### Connection String Configuration

**appsettings.Development.json**:
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=whizbang;Username=whizbang;Password=your_password"
  }
}
```

## IDE Configuration

### Visual Studio 2024

1. **Install .NET 10 SDK** (included with VS 2024 17.12+)
2. **Enable Source Generators**:
   - Tools → Options → Text Editor → C# → Advanced
   - Check "Enable source generators"
3. **View Generated Files**:
   - Solution Explorer → Show All Files
   - Expand `.whizbang-generated/` folder

### Visual Studio Code

1. **Install Extensions**:
   ```bash
   code --install-extension ms-dotnettools.csdevkit
   code --install-extension ms-dotnettools.csharp
   ```

2. **Configure settings.json**:
   ```json
   {
     "dotnet.testWindow.useTestingPlatformProtocol": true,
     "omnisharp.enableRoslynAnalyzers": true,
     "omnisharp.enableEditorConfigSupport": true
   }
   ```

3. **Install Whizbang VSCode Extension** (Optional):
   - Provides CodeLens annotations
   - Message flow visualization
   - Jump-to-definition for handlers

### JetBrains Rider

1. **Enable Source Generators**:
   - Settings → Build, Execution, Deployment → Toolset and Build
   - Check "Enable source generators"

2. **Configure NuGet Sources**:
   - Settings → NuGet → Sources
   - Add nuget.org if not present

## Verify Installation

### 1. Build Project

```bash
dotnet build
```

**Expected output**:
```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

### 2. Check Source Generators

```bash
ls .whizbang-generated/
```

**Expected files** (after adding receptors):
```
Whizbang.Generators/
├── ReceptorDiscoveryGenerator/
│   └── ReceptorRegistrations.g.cs
├── PerspectiveDiscoveryGenerator/
│   └── PerspectiveRegistrations.g.cs
└── MessageRegistryGenerator/
    └── MessageRegistry.g.cs
```

### 3. Run Tests (if added)

```bash
dotnet test
```

## Troubleshooting

### Issue: Source Generators Not Running

**Symptoms**: No files in `.whizbang-generated/`

**Solutions**:
1. Rebuild solution: `dotnet clean && dotnet build`
2. Check generator package is referenced:
   ```bash
   dotnet list package | grep Whizbang.Generators
   ```
3. Enable verbose MSBuild output:
   ```bash
   dotnet build -v:detailed | grep Whizbang
   ```

### Issue: "Type 'IReceptor' Not Found"

**Symptoms**: Cannot resolve Whizbang types

**Solutions**:
1. Verify package installation:
   ```bash
   dotnet restore
   dotnet list package
   ```
2. Check target framework is net10.0
3. Add using directive:
   ```csharp
   using Whizbang.Core;
   ```

### Issue: PostgreSQL Connection Fails

**Symptoms**: "Connection refused" or timeout errors

**Solutions**:
1. Check PostgreSQL is running:
   ```bash
   docker ps | grep postgres
   ```
2. Test connection:
   ```bash
   psql -h localhost -U whizbang -d whizbang
   ```
3. Verify connection string in appsettings.json

### Issue: Native AOT Warnings

**Symptoms**: Trimming warnings during publish

**Solutions**:
1. Whizbang is trimming-safe by design
2. Ensure all JSON contexts are generated:
   ```csharp
   [JsonSerializable(typeof(YourMessage))]
   partial class YourJsonContext : JsonSerializerContext { }
   ```
3. Use Whizbang.Generators to auto-generate contexts

## Next Steps

✅ **Installation Complete!**

**What's Next?**

1. **[Quick Start Tutorial](quick-start.md)** - Build your first Whizbang app
2. **[Project Structure Guide](project-structure.md)** - Organize your application
3. **[Core Concepts: Receptors](../core-concepts/receptors.md)** - Understand message handling

## Additional Resources

- **Sample Projects**: `/samples/ECommerce` in the Whizbang repository
- **Package Documentation**: https://nuget.org/packages/Whizbang.Core
- **GitHub Issues**: https://github.com/whizbang-lib/whizbang/issues

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
