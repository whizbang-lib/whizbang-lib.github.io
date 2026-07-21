---
title: Plugin Architecture
pageType: concept
verifiedAgainstCommit: 1b31f58d
verifiedDate: 2026-07-16
version: 1.0.0
category: Extensibility
order: 12
description: >-
  Design plugin systems - dynamic assembly loading, hot-reload, and extension
  points
tags: 'plugins, dynamic-loading, hot-reload, extensibility'
codeReferences:
  - src/Whizbang.Core/ServiceCollectionExtensions.cs
  - src/Whizbang.Core/ServiceRegistrationCallbacks.cs
  - src/Whizbang.Core/Configuration/ServiceRegistrationOptions.cs
testReferences:
  - tests/Whizbang.Core.Tests/ServiceCollectionExtensionsTests.cs
  - tests/Whizbang.Generators.Tests/ServiceRegistrationGeneratorTests.cs
lastMaintainedCommit: '01f07906'
---

# Plugin Architecture

**Plugin architectures** enable dynamic extensibility through loadable assemblies, hot-reload capabilities, and well-defined extension points.

:::note
This is an advanced topic for building extensible systems on top of Whizbang. Most applications don't need plugin capabilities.
:::

---

## Why Plugin Architecture?

| Scenario | Static Assembly | Plugin System |
|----------|----------------|---------------|
| **Fixed Features** | ✅ Simple | No need |
| **Dynamic Extensions** | ❌ Recompile required | ✅ Load at runtime |
| **Hot-Reload** | ❌ Restart required | ✅ Update without restart |
| **3rd-Party Extensions** | ❌ Code access needed | ✅ Interface-based |

**When to use plugins**:
- ✅ Extensible platforms (like VS Code)
- ✅ Multi-tenant customizations
- ✅ Hot-reloadable features
- ✅ 3rd-party integrations

---

## Whizbang's Built-In Extension Mechanism

Before reaching for dynamic assembly loading, note how Whizbang itself composes "plugins": **module-initializer callbacks**. Source generators (ServiceRegistrationGenerator, ReceptorDiscoveryGenerator, etc.) emit `[ModuleInitializer]` methods in each consumer assembly that assign callbacks on the static `ServiceRegistrationCallbacks` class (`LensServices`, `PerspectiveServices`, `Dispatcher`, `RawReceptors`, `PinnedIdRegistry`, `MessageTypeCatalog`, `PerspectivePersistenceOptions`). `services.AddWhizbang()` then invokes every registered callback — zero reflection, fully AOT-compatible.

```csharp{title="Module Initializer Callbacks" description="Whizbang's AOT-compatible assembly composition" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "ModuleInitializer", "Callbacks"] tests=["ServiceCollectionExtensionsTests.AddWhizbang_InvokesLensServicesCallback_WhenRegisteredAsync", "ServiceCollectionExtensionsTests.AddWhizbang_CallsAllCallbacksInOrder_Async"]}
// Generated module initializer in a consumer/extension assembly:
[ModuleInitializer]
internal static void RegisterServiceCallbacks() {
  ServiceRegistrationCallbacks.LensServices = (services, options) =>
    services.AddLensServices(o => o.IncludeSelfRegistration = options.IncludeSelfRegistration);
}

// User code - services are auto-registered:
services.AddWhizbang();  // Invokes all registered callbacks
```

This is the pattern to prefer for statically-referenced extension assemblies: reference the assembly, its module initializer wires everything up.

---

## Plugin Interface Pattern

### Pattern 1: IPlugin Contract

```csharp{title="Pattern 1: IPlugin Contract" description="Pattern 1: IPlugin Contract" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "IPlugin"] unverified="user extension example — custom IWhizbangPlugin contract, not a Whizbang type"}
public interface IWhizbangPlugin {
  string Name { get; }
  Version Version { get; }

  void Initialize(IServiceCollection services);
  void Configure(IApplicationBuilder app);
}
```

### Pattern 2: Plugin Loader

```csharp{title="Pattern 2: Plugin Loader" description="Pattern 2: Plugin Loader" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Plugin"] unverified="user extension example — reflection-based plugin loader, not AOT-compatible"}
using System.Reflection;
using System.Runtime.Loader;

public class PluginLoader {
  public IEnumerable<IWhizbangPlugin> LoadPlugins(string pluginDirectory) {
    var plugins = new List<IWhizbangPlugin>();

    foreach (var dllPath in Directory.GetFiles(pluginDirectory, "*.dll")) {
      var context = new AssemblyLoadContext(Path.GetFileName(dllPath), isCollectible: true);
      var assembly = context.LoadFromAssemblyPath(dllPath);

      foreach (var type in assembly.GetTypes()) {
        if (typeof(IWhizbangPlugin).IsAssignableFrom(type) && !type.IsInterface) {
          var plugin = (IWhizbangPlugin)Activator.CreateInstance(type)!;
          plugins.Add(plugin);
        }
      }
    }

    return plugins;
  }
}
```

---

## Extension Points

### Pattern 3: Receptor Plugin

```csharp{title="Pattern 3: Receptor Plugin" description="Pattern 3: Receptor Plugin" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "Receptor"] unverified="user extension example — plugin registering a receptor (not fired without compile-time discovery)"}
// Plugin assembly
public class CustomReceptorPlugin : IWhizbangPlugin {
  public string Name => "CustomReceptors";
  public Version Version => new(1, 0, 0);

  public void Initialize(IServiceCollection services) {
    services.AddTransient<IReceptor<CustomCommand, CustomEvent>, CustomReceptor>();
  }

  public void Configure(IApplicationBuilder app) {
    // No app configuration needed
  }
}
```

:::warning
Receptor discovery in Whizbang is **compile-time** (source generators build the receptor registry, and `AddWhizbang()` invokes `ServiceRegistrationCallbacks` once at startup). A receptor in an assembly loaded at runtime is NOT in the generated registry, so registering it in DI alone will not make the dispatcher fire it. Plugins loaded after startup must be statically referenced by an assembly that participates in source generation, or expose their own registration surface that your host calls explicitly.
:::

---

## Hot-Reload Support

### Pattern 4: Reloadable Plugins

```csharp{title="Pattern 4: Reloadable Plugins" description="Pattern 4: Reloadable Plugins" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Reloadable"] unverified="user extension example — reflection-based hot-reload, not AOT-compatible"}
public class HotReloadPluginManager {
  private readonly Dictionary<string, AssemblyLoadContext> _contexts = [];
  private FileSystemWatcher? _watcher;

  public void EnableHotReload(string pluginDirectory) {
    _watcher = new FileSystemWatcher(pluginDirectory, "*.dll");
    _watcher.Changed += (s, e) => ReloadPlugin(e.FullPath);
    _watcher.EnableRaisingEvents = true;
  }

  private void ReloadPlugin(string path) {
    var name = Path.GetFileName(path);

    // Unload existing
    if (_contexts.TryGetValue(name, out var oldContext)) {
      oldContext.Unload();
      _contexts.Remove(name);
    }

    // Load new version
    var newContext = new AssemblyLoadContext(name, isCollectible: true);
    newContext.LoadFromAssemblyPath(path);
    _contexts[name] = newContext;
  }
}
```

---

## Best Practices

### DO ✅

- ✅ **Define clear interfaces** for plugins
- ✅ **Use AssemblyLoadContext** for isolation
- ✅ **Version plugin APIs** carefully
- ✅ **Validate plugins** before loading
- ✅ **Handle load failures** gracefully

### DON'T ❌

- ❌ Share state between plugins (isolation)
- ❌ Allow reflection-heavy plugins (breaks AOT)
- ❌ Skip versioning (compatibility issues)
- ❌ Load untrusted plugins (security risk)

:::note
The `PluginLoader` and hot-reload patterns above rely on `AssemblyLoadContext`, `Assembly.GetTypes()`, and `Activator.CreateInstance` — all reflection-based and **incompatible with Native AOT**. Whizbang's core is zero-reflection/AOT-first; dynamic plugin loading is only an option for JIT-deployed hosts. For AOT deployments, use the module-initializer callback pattern with statically-referenced assemblies instead.
:::

---

## Further Reading

**Extensibility**:
- [Custom Receptors](custom-receptors.md) - Receptor extension patterns
- [Custom Transports](custom-transports.md) - Transport plugins

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
