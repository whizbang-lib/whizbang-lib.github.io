---
title: "Deployment"
version: 0.1.0
category: Tutorial
order: 10
description: "Deploy to production - Azure Kubernetes Service, CI/CD pipelines, monitoring, and scaling"
tags: tutorial, deployment, kubernetes, azure, cicd, monitoring
---

# Deployment

Deploy the **ECommerce system** to production using Azure Kubernetes Service (AKS), implement CI/CD pipelines, configure monitoring, and enable auto-scaling.

:::note
This is **Part 9** (Final) of the ECommerce Tutorial. Complete [Testing Strategy](testing-strategy.md) first.
:::

---

## Deployment Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Azure Kubernetes Service (AKS)                              │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Ingress Controller (nginx)                         │    │
│  │  - SSL/TLS Termination                              │    │
│  │  - Load Balancing                                   │    │
│  └────────────┬─────────────────────────────────────────┘   │
│               │                                               │
│  ┌────────────▼────────┐  ┌──────────────────┐              │
│  │  Order Service      │  │ Customer Service │              │
│  │  (3 replicas)       │  │  (2 replicas)    │              │
│  └─────────────────────┘  └──────────────────┘              │
│                                                               │
│  ┌─────────────────────┐  ┌──────────────────┐              │
│  │ Inventory Worker    │  │  Payment Worker  │              │
│  │  (2 replicas)       │  │  (2 replicas)    │              │
│  └─────────────────────┘  └──────────────────┘              │
│                                                               │
│  ┌─────────────────────┐  ┌──────────────────┐              │
│  │Notification Worker  │  │ Shipping Worker  │              │
│  │  (2 replicas)       │  │  (2 replicas)    │              │
│  └─────────────────────┘  └──────────────────┘              │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Analytics Worker (1 replica)                        │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Azure Managed Services                                      │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐│
│  │ Azure Service    │  │ Azure Database   │  │ Azure      ││
│  │ Bus (Premium)    │  │ for PostgreSQL   │  │ Monitor    ││
│  └──────────────────┘  └──────────────────┘  └────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Step 1: Dockerfiles

### Order Service Dockerfile

**ECommerce.OrderService.API/Dockerfile**:

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy solution and project files
COPY ECommerce.sln .
COPY ECommerce.OrderService.API/ECommerce.OrderService.API.csproj ECommerce.OrderService.API/
COPY ECommerce.Contracts/ECommerce.Contracts.csproj ECommerce.Contracts/

# Restore dependencies
RUN dotnet restore ECommerce.OrderService.API/ECommerce.OrderService.API.csproj

# Copy source code
COPY . .

# Build and publish
WORKDIR /src/ECommerce.OrderService.API
RUN dotnet publish -c Release -o /app/publish \
  --no-restore \
  /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Copy published files
COPY --from=build /app/publish .

# Create non-root user
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Expose port
EXPOSE 8080

ENTRYPOINT ["dotnet", "ECommerce.OrderService.API.dll"]
```

### Worker Service Dockerfile

**ECommerce.InventoryWorker/Dockerfile**:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ECommerce.sln .
COPY ECommerce.InventoryWorker/ECommerce.InventoryWorker.csproj ECommerce.InventoryWorker/
COPY ECommerce.Contracts/ECommerce.Contracts.csproj ECommerce.Contracts/

RUN dotnet restore ECommerce.InventoryWorker/ECommerce.InventoryWorker.csproj

COPY . .
WORKDIR /src/ECommerce.InventoryWorker
RUN dotnet publish -c Release -o /app/publish \
  --no-restore \
  /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

ENTRYPOINT ["dotnet", "ECommerce.InventoryWorker.dll"]
```

---

## Step 2: Kubernetes Manifests

### Order Service Deployment

**k8s/order-service/deployment.yaml**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: ecommerce
  labels:
    app: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
      - name: order-service
        image: ecommerceacr.azurecr.io/order-service:latest
        ports:
        - containerPort: 8080
          name: http
        env:
        - name: ASPNETCORE_ENVIRONMENT
          value: "Production"
        - name: ConnectionStrings__OrdersDb
          valueFrom:
            secretKeyRef:
              name: database-secrets
              key: orders-db-connection-string
        - name: Whizbang__ServiceBus__ConnectionString
          valueFrom:
            secretKeyRef:
              name: servicebus-secrets
              key: connection-string
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: ecommerce
spec:
  selector:
    app: order-service
  ports:
  - port: 80
    targetPort: 8080
    name: http
  type: ClusterIP
```

### Horizontal Pod Autoscaler

**k8s/order-service/hpa.yaml**:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: ecommerce
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
```

### Ingress

**k8s/ingress.yaml**:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ecommerce-ingress
  namespace: ecommerce
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.ecommerce.example.com
    secretName: ecommerce-tls
  rules:
  - host: api.ecommerce.example.com
    http:
      paths:
      - path: /api/orders
        pathType: Prefix
        backend:
          service:
            name: order-service
            port:
              number: 80
      - path: /api/customers
        pathType: Prefix
        backend:
          service:
            name: customer-service
            port:
              number: 80
      - path: /api/analytics
        pathType: Prefix
        backend:
          service:
            name: analytics-service
            port:
              number: 80
```

---

## Step 3: Azure Infrastructure (Bicep)

**infra/main.bicep**:

```bicep
param location string = 'eastus'
param environment string = 'production'

// Azure Kubernetes Service
resource aks 'Microsoft.ContainerService/managedClusters@2024-01-01' = {
  name: 'ecommerce-aks-${environment}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    kubernetesVersion: '1.28'
    dnsPrefix: 'ecommerce-${environment}'
    agentPoolProfiles: [
      {
        name: 'nodepool1'
        count: 3
        vmSize: 'Standard_D4s_v3'
        mode: 'System'
        enableAutoScaling: true
        minCount: 3
        maxCount: 10
        osDiskSizeGB: 128
        osType: 'Linux'
      }
    ]
    networkProfile: {
      networkPlugin: 'azure'
      loadBalancerSku: 'standard'
      serviceCidr: '10.0.0.0/16'
      dnsServiceIP: '10.0.0.10'
    }
    addonProfiles: {
      azurePolicy: {
        enabled: true
      }
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalytics.id
        }
      }
    }
  }
}

// Azure Database for PostgreSQL
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: 'ecommerce-postgres-${environment}'
  location: location
  sku: {
    name: 'Standard_D4s_v3'
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    administratorLogin: 'pgadmin'
    administratorLoginPassword: '<secure-password>'
    storage: {
      storageSizeGB: 128
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Enabled'
    }
    highAvailability: {
      mode: 'ZoneRedundant'
    }
  }
}

// Azure Service Bus
resource serviceBus 'Microsoft.ServiceBus/namespaces@2023-01-01-preview' = {
  name: 'ecommerce-servicebus-${environment}'
  location: location
  sku: {
    name: 'Premium'
    tier: 'Premium'
    capacity: 1
  }
  properties: {
    zoneRedundant: true
  }
}

// Azure Container Registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'ecommerceacr${environment}'
  location: location
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// Log Analytics Workspace
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'ecommerce-logs-${environment}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'ecommerce-appinsights-${environment}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

output aksName string = aks.name
output acrLoginServer string = acr.properties.loginServer
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output serviceBusNamespace string = serviceBus.name
```

**Deploy infrastructure**:

```bash
az deployment group create \
  --resource-group ecommerce-rg \
  --template-file infra/main.bicep \
  --parameters environment=production
```

---

## Step 4: CI/CD Pipeline (GitHub Actions)

**.github/workflows/deploy.yaml**:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  AZURE_RESOURCE_GROUP: ecommerce-rg
  AKS_CLUSTER_NAME: ecommerce-aks-production
  ACR_NAME: ecommerceacrproduction

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Setup .NET 10
      uses: actions/setup-dotnet@v4
      with:
        dotnet-version: '10.0.x'

    - name: Restore dependencies
      run: dotnet restore

    - name: Build
      run: dotnet build --no-restore

    - name: Run unit tests
      run: dotnet test --no-build --verbosity normal --logger trx

    - name: Run integration tests
      run: |
        docker-compose -f docker-compose.test.yml up -d
        dotnet test tests/ECommerce.IntegrationTests --no-build
        docker-compose -f docker-compose.test.yml down

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    strategy:
      matrix:
        service:
        - order-service
        - inventory-worker
        - payment-worker
        - notification-worker
        - shipping-worker
        - customer-service
        - analytics-worker
    steps:
    - uses: actions/checkout@v4

    - name: Login to Azure Container Registry
      uses: azure/docker-login@v1
      with:
        login-server: ${{ env.ACR_NAME }}.azurecr.io
        username: ${{ secrets.ACR_USERNAME }}
        password: ${{ secrets.ACR_PASSWORD }}

    - name: Build and push Docker image
      run: |
        docker build -t ${{ env.ACR_NAME }}.azurecr.io/${{ matrix.service }}:${{ github.sha }} \
          -f ECommerce.${{ matrix.service }}/Dockerfile .
        docker push ${{ env.ACR_NAME }}.azurecr.io/${{ matrix.service }}:${{ github.sha }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
    - uses: actions/checkout@v4

    - name: Azure Login
      uses: azure/login@v1
      with:
        creds: ${{ secrets.AZURE_CREDENTIALS }}

    - name: Get AKS credentials
      run: |
        az aks get-credentials \
          --resource-group ${{ env.AZURE_RESOURCE_GROUP }} \
          --name ${{ env.AKS_CLUSTER_NAME }}

    - name: Update Kubernetes manifests
      run: |
        sed -i "s|:latest|:${{ github.sha }}|g" k8s/**/*.yaml

    - name: Deploy to AKS
      run: |
        kubectl apply -f k8s/namespace.yaml
        kubectl apply -f k8s/secrets/ --namespace ecommerce
        kubectl apply -f k8s/ --recursive --namespace ecommerce

    - name: Wait for rollout
      run: |
        kubectl rollout status deployment/order-service --namespace ecommerce --timeout=10m
        kubectl rollout status deployment/inventory-worker --namespace ecommerce --timeout=10m
```

---

## Step 5: Monitoring and Observability

### Application Insights Integration

**Program.cs**:

```csharp
builder.Services.AddApplicationInsightsTelemetry(options => {
  options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
});

builder.Services.AddOpenTelemetryMetrics(metrics => {
  metrics
    .AddAspNetCoreInstrumentation()
    .AddHttpClientInstrumentation()
    .AddRuntimeInstrumentation();
});

builder.Services.AddOpenTelemetryTracing(tracing => {
  tracing
    .AddAspNetCoreInstrumentation()
    .AddHttpClientInstrumentation()
    .AddNpgsql()
    .AddAzureServiceBusInstrumentation();
});
```

### Prometheus Metrics

**k8s/monitoring/prometheus.yaml**:

```yaml
apiVersion: v1
kind: ServiceMonitor
metadata:
  name: ecommerce-services
  namespace: ecommerce
spec:
  selector:
    matchLabels:
      app: order-service
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### Custom Metrics

**Receptors/CreateOrderReceptor.cs**:

```csharp
private readonly Meter _meter = new("ECommerce.OrderService");
private readonly Counter<long> _ordersCreated;

public CreateOrderReceptor(...) {
  _ordersCreated = _meter.CreateCounter<long>(
    "orders_created_total",
    description: "Total number of orders created"
  );
}

public async Task<OrderCreated> HandleAsync(CreateOrder command, CancellationToken ct) {
  // ... process order

  _ordersCreated.Add(1, new TagList {
    { "customer_id", command.CustomerId },
    { "item_count", command.Items.Length }
  });

  return @event;
}
```

---

## Step 6: Database Migrations

### Migration Job

**k8s/jobs/migrate-orders-db.yaml**:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate-orders-db
  namespace: ecommerce
spec:
  template:
    spec:
      containers:
      - name: migrate
        image: ecommerceacr.azurecr.io/order-service:latest
        command: ["dotnet", "ECommerce.OrderService.API.dll", "migrate"]
        env:
        - name: ConnectionStrings__OrdersDb
          valueFrom:
            secretKeyRef:
              name: database-secrets
              key: orders-db-connection-string
      restartPolicy: OnFailure
  backoffLimit: 3
```

**Run migration before deployment**:

```bash
kubectl apply -f k8s/jobs/migrate-orders-db.yaml
kubectl wait --for=condition=complete job/migrate-orders-db --timeout=5m
```

---

## Step 7: Blue-Green Deployment

**k8s/order-service/deployment-blue.yaml**:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-blue
  namespace: ecommerce
  labels:
    app: order-service
    version: blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
      version: blue
  template:
    metadata:
      labels:
        app: order-service
        version: blue
    spec:
      containers:
      - name: order-service
        image: ecommerceacr.azurecr.io/order-service:v1.0.0
        # ...
```

**k8s/order-service/service-switch.yaml**:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: ecommerce
spec:
  selector:
    app: order-service
    version: blue  # Switch to "green" for rollover
  ports:
  - port: 80
    targetPort: 8080
```

**Deployment process**:

```bash
# Deploy green version
kubectl apply -f k8s/order-service/deployment-green.yaml

# Wait for readiness
kubectl wait --for=condition=available deployment/order-service-green --timeout=5m

# Switch traffic to green
kubectl patch service order-service -p '{"spec":{"selector":{"version":"green"}}}'

# Monitor for errors (5 minutes)
# If successful, delete blue
kubectl delete deployment order-service-blue
```

---

## Key Takeaways

✅ **Kubernetes Deployment** - AKS with auto-scaling and health checks
✅ **CI/CD Pipeline** - GitHub Actions for automated testing and deployment
✅ **Infrastructure as Code** - Bicep for Azure resources
✅ **Monitoring** - Application Insights and Prometheus metrics
✅ **Blue-Green Deployment** - Zero-downtime deployments
✅ **Database Migrations** - Automated with Kubernetes jobs

---

## Production Checklist

Before going live:

- [ ] SSL/TLS certificates configured (cert-manager + Let's Encrypt)
- [ ] Secrets stored in Azure Key Vault (not ConfigMaps)
- [ ] Database backups configured (7-day retention)
- [ ] Log aggregation configured (Azure Monitor)
- [ ] Alerts configured for critical errors
- [ ] Auto-scaling tested under load
- [ ] Disaster recovery plan documented
- [ ] Security scanning in CI/CD pipeline
- [ ] Rate limiting configured on Ingress
- [ ] DDoS protection enabled

---

## Congratulations!

You've completed the **ECommerce Tutorial** and built a production-ready, event-driven microservices system with Whizbang! 🎉

**What you've learned**:
- Event-driven architecture with CQRS
- Distributed transactions with sagas
- Read models with perspectives
- Testing strategies (unit, integration, e2e)
- Production deployment on Kubernetes

**Next steps**:
- Explore [Advanced Topics](../advanced-topics/) for performance tuning and scaling
- Check out [Customization Examples](../customization-examples/) for real-world patterns
- Join the community and share your Whizbang projects!

---

*Version 0.1.0 - Foundation Release | Last Updated: 2024-12-12*
