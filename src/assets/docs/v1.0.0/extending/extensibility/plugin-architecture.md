---
title: Plugin Architecture
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

## Plugin Interface Pattern

### Pattern 1: IPlugin Contract

```csharp{title="Pattern 1: IPlugin Contract" description="Pattern 1: IPlugin Contract" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "IPlugin"]}
public interface IWhizbangPlugin {
  string Name { get; }
  Version Version { get; }

  void Initialize(IServiceCollection services);
  void Configure(IApplicationBuilder app);
}
```

### Pattern 2: Plugin Loader

```csharp{title="Pattern 2: Plugin Loader" description="Pattern 2: Plugin Loader" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Plugin"]}
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

```csharp{title="Pattern 3: Receptor Plugin" description="Pattern 3: Receptor Plugin" category="Extensibility" difficulty="BEGINNER" tags=["Extending", "Extensibility", "Pattern", "Receptor"]}
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

---

## Hot-Reload Support

### Pattern 4: Reloadable Plugins

```csharp{title="Pattern 4: Reloadable Plugins" description="Pattern 4: Reloadable Plugins" category="Extensibility" difficulty="INTERMEDIATE" tags=["Extending", "Extensibility", "Pattern", "Reloadable"]}
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

---

## Further Reading

**Extensibility**:
- [Custom Receptors](custom-receptors.md) - Receptor extension patterns
- [Custom Transports](custom-transports.md) - Transport plugins

---

*Version 1.0.0 - Foundation Release | Last Updated: 2024-12-12*
