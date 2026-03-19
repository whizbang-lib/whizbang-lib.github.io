#!/usr/bin/env node

/**
 * Documentation Tree Reorganization Script
 *
 * Migrates the v1.0.0 docs from the organic flat structure to a
 * persona-based 7-section structure.
 *
 * Usage:
 *   node src/scripts/migrate-docs-tree.mjs --dry-run    # Report what will change
 *   node src/scripts/migrate-docs-tree.mjs              # Execute the migration
 *   node src/scripts/migrate-docs-tree.mjs --update-tags # Update <docs> tags in library repo
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.resolve(__dirname, '../assets/docs/v1.0.0');
const LIBRARY_ROOT = process.env.WHIZBANG_LIB_PATH || path.resolve(__dirname, '../../../whizbang');

const DRY_RUN = process.argv.includes('--dry-run');
const UPDATE_TAGS = process.argv.includes('--update-tags');

// ─── Complete old-path → new-path mapping ────────────────────────────────────
// Paths are relative to v1.0.0/, without .md extension (matching <docs> tag format)
// Order: most specific first to avoid prefix collisions

const PATH_MAP = new Map([
  // ── getting-started (unchanged) ──
  // No entries needed

  // ── tutorial → learn/tutorial ──
  ['tutorial/analytics-service', 'learn/tutorial/analytics-service'],
  ['tutorial/customer-service', 'learn/tutorial/customer-service'],
  ['tutorial/deployment', 'learn/tutorial/deployment'],
  ['tutorial/inventory-service', 'learn/tutorial/inventory-service'],
  ['tutorial/notification-service', 'learn/tutorial/notification-service'],
  ['tutorial/order-management', 'learn/tutorial/order-management'],
  ['tutorial/payment-processing', 'learn/tutorial/payment-processing'],
  ['tutorial/shipping-service', 'learn/tutorial/shipping-service'],
  ['tutorial/testing-strategy', 'learn/tutorial/testing-strategy'],
  ['tutorial/tutorial-overview', 'learn/tutorial/tutorial-overview'],

  // ── customization-examples → learn/examples ──
  ['customization-examples/event-sourcing-cqrs', 'learn/examples/event-sourcing-cqrs'],
  ['customization-examples/microservices-orchestration', 'learn/examples/microservices-orchestration'],
  ['customization-examples/multi-tenant-saas', 'learn/examples/multi-tenant-saas'],
  ['customization-examples/real-time-analytics', 'learn/examples/real-time-analytics'],

  // ── core-concepts/events → fundamentals/events ──
  ['core-concepts/events', 'fundamentals/events/events'],
  ['core-concepts/event-streams', 'fundamentals/events/event-streams'],
  ['core-concepts/stream-id', 'fundamentals/events/stream-id'],
  ['core-concepts/event-store', 'fundamentals/events/event-store'],
  ['core-concepts/event-store-query', 'fundamentals/events/event-store-query'],
  ['core-concepts/system-events', 'fundamentals/events/system-events'],

  // ── core-concepts/dispatcher → fundamentals/dispatcher ──
  ['core-concepts/dispatcher', 'fundamentals/dispatcher/dispatcher'],
  ['core-concepts/routing', 'fundamentals/dispatcher/routing'],
  ['core-concepts/rpc-extraction', 'fundamentals/dispatcher/rpc-extraction'],

  // ── core-concepts/messages → fundamentals/messages ──
  ['core-concepts/messages', 'fundamentals/messages/messages'],
  ['core-concepts/message-context', 'fundamentals/messages/message-context'],
  ['core-concepts/message-associations', 'fundamentals/messages/message-associations'],
  ['core-concepts/message-tags', 'fundamentals/messages/message-tags'],
  ['core-concepts/envelope-registry', 'fundamentals/messages/envelope-registry'],
  ['core-concepts/envelope-serialization', 'fundamentals/messages/envelope-serialization'],
  ['core-concepts/delivery-receipts', 'fundamentals/messages/delivery-receipts'],

  // ── core-concepts/receptors → fundamentals/receptors ──
  ['core-concepts/receptors', 'fundamentals/receptors/receptors'],
  ['core-concepts/lifecycle-receptors', 'fundamentals/receptors/lifecycle-receptors'],

  // ── core-concepts/perspectives → fundamentals/perspectives ──
  ['core-concepts/perspectives', 'fundamentals/perspectives/perspectives'],
  ['core-concepts/perspectives/association-info', 'fundamentals/perspectives/association-info'],
  ['core-concepts/perspectives/event-completion', 'fundamentals/perspectives/event-completion'],
  ['core-concepts/perspectives/multi-stream', 'fundamentals/perspectives/multi-stream'],
  ['core-concepts/perspectives/perspective-sync', 'fundamentals/perspectives/perspective-sync'],
  ['core-concepts/perspectives/typed-associations', 'fundamentals/perspectives/typed-associations'],

  // ── perspectives/ → fundamentals/perspectives ──
  ['perspectives/association-info', 'fundamentals/perspectives/association-metadata'],
  ['perspectives/physical-fields', 'fundamentals/perspectives/physical-fields'],
  ['perspectives/polymorphic-discriminator', 'fundamentals/perspectives/polymorphic-discriminator'],
  ['perspectives/polymorphic-types', 'fundamentals/perspectives/polymorphic-types'],
  ['perspectives/rebuild', 'fundamentals/perspectives/rebuild'],
  ['perspectives/registry', 'fundamentals/perspectives/registry'],
  ['perspectives/sync', 'fundamentals/perspectives/sync'],
  ['perspectives/table-naming', 'fundamentals/perspectives/table-naming'],
  ['perspectives/temporal', 'fundamentals/perspectives/temporal'],
  ['perspectives/vector-fields', 'fundamentals/perspectives/vector-fields'],

  // ── core-concepts/lenses → fundamentals/lenses ──
  ['core-concepts/lenses', 'fundamentals/lenses/lenses'],
  ['core-concepts/scoped-lenses', 'fundamentals/lenses/scoped-lenses'],

  // ── lenses/ → fundamentals/lenses ──
  ['lenses/lens-query-factory', 'fundamentals/lenses/lens-query-factory'],
  ['lenses/multi-model-queries', 'fundamentals/lenses/multi-model-queries'],
  ['lenses/raw-sql', 'fundamentals/lenses/raw-sql'],
  ['lenses/scoped-queries', 'fundamentals/lenses/scoped-queries'],
  ['lenses/temporal-query', 'fundamentals/lenses/temporal-query'],
  ['lenses/vector-search', 'fundamentals/lenses/vector-search'],

  // ── core-concepts/lifecycle → fundamentals/lifecycle ──
  ['core-concepts/lifecycle', 'fundamentals/lifecycle/lifecycle'],
  ['core-concepts/lifecycle-stages', 'fundamentals/lifecycle/lifecycle-stages'],

  // ── core-concepts/identity → fundamentals/identity ──
  ['core-concepts/whizbang-ids', 'fundamentals/identity/whizbang-ids'],
  ['core-concepts/type-formatting', 'fundamentals/identity/type-formatting'],
  ['core-concepts/type-matching', 'fundamentals/identity/type-matching'],
  ['core-concepts/type-qualification', 'fundamentals/identity/type-qualification'],
  ['core-concepts/fuzzy-matching', 'fundamentals/identity/fuzzy-matching'],
  ['core-concepts/assembly-registry', 'fundamentals/identity/assembly-registry'],
  ['core-concepts/time-provider', 'fundamentals/identity/time-provider'],

  // ── core-concepts/security → fundamentals/security ──
  ['core-concepts/security', 'fundamentals/security/security'],
  ['core-concepts/message-security', 'fundamentals/security/message-security'],
  ['core-concepts/security-context-propagation', 'fundamentals/security/security-context-propagation'],
  ['core-concepts/scoping', 'fundamentals/security/scoping'],
  ['core-concepts/scope-propagation', 'fundamentals/security/scope-propagation'],
  ['core-concepts/audit-logging', 'fundamentals/security/audit-logging'],

  // ── core-concepts/persistence → fundamentals/persistence ──
  ['core-concepts/persistence', 'fundamentals/persistence/persistence'],
  ['core-concepts/observability', 'fundamentals/persistence/observability'],

  // ── core-concepts/transport-consumer → messaging/transports ──
  ['core-concepts/transport-consumer', 'messaging/transports/transport-consumer'],

  // ── components → various ──
  ['components/dispatcher', 'fundamentals/dispatcher/dispatcher'],  // MERGE target
  ['components/receptors', 'fundamentals/receptors/receptors'],      // MERGE target
  ['components/perspectives', 'fundamentals/perspectives/perspectives'], // MERGE target
  ['components/lenses', 'fundamentals/lenses/lenses'],              // MERGE target
  ['components/transports', 'messaging/transports/transports'],
  ['components/transports/azure-service-bus', 'messaging/transports/azure-service-bus'],  // redirect
  ['components/transports/rabbitmq', 'messaging/transports/rabbitmq'],  // redirect
  // components/workers/transport-consumer is in MERGE_SOURCES (deleted as duplicate)
  ['components/data/postgres', 'data/postgres'],
  ['components/caching', 'data/caching'],
  ['components/ledger', 'fundamentals/events/ledger'],
  ['components/policy-engine', 'operations/infrastructure/policy-engine'],
  ['components/drivers', 'data/drivers'],

  // ── messaging (root files unchanged, already at messaging/) ──
  // messaging/commands-events, messaging/failure-handling, etc. stay

  // ── transports → messaging/transports ──
  ['transports/azure-service-bus', 'messaging/transports/azure-service-bus'],
  ['transports/in-memory', 'messaging/transports/in-memory'],
  ['transports/rabbitmq', 'messaging/transports/rabbitmq'],

  // ── data-access → data ──
  ['data-access/schema-generation-pattern', 'data/schema-generation-pattern'],

  // ── rest → apis/rest ──
  ['rest/filtering', 'apis/rest/filtering'],
  ['rest/mutations', 'apis/rest/mutations'],
  ['rest/setup', 'apis/rest/setup'],

  // ── graphql → apis/graphql ──
  ['graphql/filtering', 'apis/graphql/filtering'],
  ['graphql/index', 'apis/graphql/index'],
  ['graphql/lens-integration', 'apis/graphql/lens-integration'],
  ['graphql/polymorphic-types', 'apis/graphql/polymorphic-types'],
  ['graphql/scoping', 'apis/graphql/scoping'],
  ['graphql/setup', 'apis/graphql/setup'],
  ['graphql/sorting', 'apis/graphql/sorting'],

  // ── mutations → apis/mutations ──
  ['mutations/custom-request-dto', 'apis/mutations/custom-request-dto'],
  ['mutations/hooks', 'apis/mutations/hooks'],

  // ── integrations/signalr → apis/signalr ──
  ['integrations/signalr', 'apis/signalr/signalr'],

  // ── signalr → apis/signalr ──
  ['signalr/notification-hooks', 'apis/signalr/notification-hooks'],

  // ── configuration → operations/configuration ──
  ['configuration/whizbang-options', 'operations/configuration/whizbang-options'],

  // ── di → operations/configuration ──
  ['di/all-services', 'operations/configuration/all-services'],
  ['di/lens-services', 'operations/configuration/lens-services'],
  ['di/perspective-services', 'operations/configuration/perspective-services'],
  ['di/service-registration-options', 'operations/configuration/service-registration-options'],
  ['di/service-registration', 'operations/configuration/service-registration'],

  // ── observability → operations/observability ──
  ['observability/diagnostics', 'operations/observability/diagnostics'],
  ['observability/logging-categories', 'operations/observability/logging-categories'],
  ['observability/opentelemetry-integration', 'operations/observability/opentelemetry-integration'],
  ['observability/tracing', 'operations/observability/tracing'],

  // ── tracing → operations/observability ──
  ['tracing/verbosity-levels', 'operations/observability/verbosity-levels'],

  // ── infrastructure → operations/infrastructure ──
  ['infrastructure/aspire-integration', 'operations/infrastructure/aspire-integration'],
  ['infrastructure/health-checks', 'operations/infrastructure/health-checks'],
  ['infrastructure/migrations', 'operations/infrastructure/migrations'],
  ['infrastructure/policies', 'operations/infrastructure/policies'],
  ['infrastructure/pooling', 'operations/infrastructure/pooling'],

  // ── workers → operations/workers ──
  ['workers/database-readiness', 'operations/workers/database-readiness'],
  ['workers/execution-lifecycle', 'operations/workers/execution-lifecycle'],
  ['workers/perspective-worker', 'operations/workers/perspective-worker'],

  // ── testing → operations/testing ──
  ['testing/lifecycle-synchronization', 'operations/testing/lifecycle-synchronization'],

  // ── diagnostics → operations/diagnostics ──
  ['diagnostics/serializable-property-analyzer', 'operations/diagnostics/serializable-property-analyzer'],
  ['diagnostics/whiz030', 'operations/diagnostics/whiz030'],
  ['diagnostics/whiz031', 'operations/diagnostics/whiz031'],
  ['diagnostics/whiz058', 'operations/diagnostics/whiz058'],
  ['diagnostics/whiz059', 'operations/diagnostics/whiz059'],
  ['diagnostics/whiz062', 'operations/diagnostics/whiz062'],
  ['diagnostics/whiz070', 'operations/diagnostics/whiz070'],
  ['diagnostics/whiz071', 'operations/diagnostics/whiz071'],
  ['diagnostics/whiz080', 'operations/diagnostics/whiz080'],
  ['diagnostics/whiz090', 'operations/diagnostics/whiz090'],
  ['diagnostics/whiz400', 'operations/diagnostics/whiz400'],
  ['diagnostics/whiz802', 'operations/diagnostics/whiz802'],
  ['diagnostics/whiz807', 'operations/diagnostics/whiz807'],

  // ── advanced-topics → various ──
  ['advanced-topics/testing-receptors', 'operations/testing/testing-receptors'],
  ['advanced-topics/deployment-strategies', 'operations/deployment/deployment-strategies'],
  ['advanced-topics/scaling', 'operations/deployment/scaling'],
  ['advanced-topics/performance-tuning', 'operations/deployment/performance-tuning'],
  ['advanced-topics/monitoring', 'operations/deployment/monitoring'],
  ['advanced-topics/troubleshooting', 'operations/deployment/troubleshooting'],
  ['advanced-topics/native-aot', 'operations/deployment/native-aot'],
  ['advanced-topics/security', 'operations/deployment/security'],
  ['advanced-topics/multi-tenancy', 'fundamentals/security/multi-tenancy'],

  // ── extensibility → extending/extensibility ──
  ['extensibility/custom-dispatchers', 'extending/extensibility/custom-dispatchers'],
  ['extensibility/custom-health-checks', 'extending/extensibility/custom-health-checks'],
  ['extensibility/custom-id-generators', 'extending/extensibility/custom-id-generators'],
  ['extensibility/custom-perspectives', 'extending/extensibility/custom-perspectives'],
  ['extensibility/custom-policies', 'extending/extensibility/custom-policies'],
  ['extensibility/custom-receptors', 'extending/extensibility/custom-receptors'],
  ['extensibility/custom-serializers', 'extending/extensibility/custom-serializers'],
  ['extensibility/custom-storage', 'extending/extensibility/custom-storage'],
  ['extensibility/custom-transports', 'extending/extensibility/custom-transports'],
  ['extensibility/custom-work-coordinators', 'extending/extensibility/custom-work-coordinators'],
  ['extensibility/database-schema-framework', 'extending/extensibility/database-schema-framework'],
  ['extensibility/hooks-and-middleware', 'extending/extensibility/hooks-and-middleware'],
  ['extensibility/plugin-architecture', 'extending/extensibility/plugin-architecture'],

  // ── attributes → extending/attributes ──
  ['attributes/generatestreamid', 'extending/attributes/generatestreamid'],
  ['attributes/streamid', 'extending/attributes/streamid'],
  ['attributes/streamkey', 'extending/attributes/streamkey'],

  // ── source-generators → extending/source-generators ──
  ['source-generators/aggregate-ids', 'extending/source-generators/aggregate-ids'],
  ['source-generators/attribute-utilities', 'extending/source-generators/attribute-utilities'],
  ['source-generators/configuration', 'extending/source-generators/configuration'],
  ['source-generators/json-contexts', 'extending/source-generators/json-contexts'],
  ['source-generators/message-registry', 'extending/source-generators/message-registry'],
  ['source-generators/perspective-discovery', 'extending/source-generators/perspective-discovery'],
  ['source-generators/polymorphic-serialization', 'extending/source-generators/polymorphic-serialization'],
  ['source-generators/receptor-discovery', 'extending/source-generators/receptor-discovery'],
  ['source-generators/topic-filter-discovery', 'extending/source-generators/topic-filter-discovery'],

  // ── internals → extending/internals ──
  ['internals/json-serialization-customizations', 'extending/internals/json-serialization-customizations'],

  // ── architecture → extending/internals ──
  ['architecture/message-lifecycle', 'extending/internals/message-lifecycle'],

  // ── features → extending/features ──
  ['features/debugger-aware-clock', 'extending/features/debugger-aware-clock'],
  ['features/vector-search', 'extending/features/vector-search'],

  // ── guides → fundamentals/security ──
  ['guides/implementing-multi-tenancy', 'fundamentals/security/implementing-multi-tenancy'],

  // ── migration-guide (unchanged) ──
  // No entries needed

  // ── Additional mappings for <docs> tags referencing planned/future docs ──
  // These don't have files yet but tags in source should use new paths
  ['core-concepts/cascade-context', 'fundamentals/messages/cascade-context'],
  ['core-concepts/multi-tenancy', 'fundamentals/security/multi-tenancy'],
  ['core-concepts/dependency-injection', 'operations/configuration/dependency-injection'],
  ['core-concepts/model-action', 'fundamentals/perspectives/model-action'],
  ['core-concepts/perspectives-with-actions', 'fundamentals/perspectives/perspectives-with-actions'],
  ['core-concepts/message-context-extraction', 'fundamentals/messages/message-context-extraction'],
  ['core-concepts/invoke-result', 'fundamentals/dispatcher/invoke-result'],
  ['configuration/service-registration-options', 'operations/configuration/service-registration-options'],
  ['infrastructure/database-limits', 'operations/infrastructure/database-limits'],
  ['source-generators/type-symbol-extensions', 'extending/source-generators/type-symbol-extensions'],
  ['tracing/attributes', 'operations/observability/tracing-attributes'],
  ['rest/lens-integration', 'apis/rest/lens-integration'],
  ['mutations/command-endpoints', 'apis/mutations/command-endpoints'],
  ['graphql/mutations', 'apis/graphql/mutations'],
  ['perspectives/snapshots', 'fundamentals/perspectives/snapshots'],
  ['perspectives/stream-locking', 'fundamentals/perspectives/stream-locking'],
  ['perspectives/typed-associations', 'fundamentals/perspectives/typed-associations'],
  ['attributes/auto-populate', 'extending/attributes/auto-populate'],
  ['attributes/must-exist', 'extending/attributes/must-exist'],
  ['observability/metrics', 'operations/observability/metrics'],
  ['data-access/efcore-complex-types', 'data/efcore-complex-types'],
  ['components/workers/service-bus-consumer', 'messaging/transports/service-bus-consumer'],
  ['components/workers/transport-consumer', 'messaging/transports/transport-consumer'],
  ['workers/work-coordinator-publisher-worker', 'operations/workers/work-coordinator-publisher-worker'],
  ['diagnostics/whiz032', 'operations/diagnostics/whiz032'],
  ['diagnostics/whiz033', 'operations/diagnostics/whiz033'],
  ['diagnostics/whiz040', 'operations/diagnostics/whiz040'],
  ['diagnostics/whiz041', 'operations/diagnostics/whiz041'],
  ['diagnostics/whiz042', 'operations/diagnostics/whiz042'],
  ['diagnostics/whiz055', 'operations/diagnostics/whiz055'],
  ['diagnostics/whiz056', 'operations/diagnostics/whiz056'],
  ['diagnostics/whiz057', 'operations/diagnostics/whiz057'],
  ['diagnostics/whiz060', 'operations/diagnostics/whiz060'],
  ['diagnostics/whiz061', 'operations/diagnostics/whiz061'],
  ['diagnostics/whiz063', 'operations/diagnostics/whiz063'],
  ['diagnostics/whiz300', 'operations/diagnostics/whiz300'],
  ['diagnostics/whiz801', 'operations/diagnostics/whiz801'],
  ['diagnostics/whiz803', 'operations/diagnostics/whiz803'],
  ['diagnostics/whiz805', 'operations/diagnostics/whiz805'],
]);

// Files that are merge targets (components/* → merged into core-concepts equivalent)
// Format: source path (to be deleted) → target path (keep and append unique content)
const MERGE_SOURCES = new Set([
  'components/dispatcher',
  'components/receptors',
  'components/perspectives',
  'components/lenses',
  'components/transports/azure-service-bus',  // redirect page, just delete
  'components/transports/rabbitmq',           // redirect page, just delete
  'components/workers/transport-consumer',    // duplicate of core-concepts version
]);

// ─── _folder.md templates ────────────────────────────────────────────────────

const FOLDER_CONFIGS = [
  // Top-level sections
  { path: 'getting-started', title: 'Getting Started', order: 1 },
  { path: 'learn', title: 'Learn', order: 2 },
  { path: 'learn/tutorial', title: 'Tutorial', order: 1 },
  { path: 'learn/examples', title: 'Examples', order: 2 },
  { path: 'fundamentals', title: 'Fundamentals', order: 3 },
  { path: 'fundamentals/events', title: 'Events', order: 1 },
  { path: 'fundamentals/dispatcher', title: 'Dispatcher', order: 2 },
  { path: 'fundamentals/messages', title: 'Messages', order: 3 },
  { path: 'fundamentals/receptors', title: 'Receptors', order: 4 },
  { path: 'fundamentals/perspectives', title: 'Perspectives', order: 5 },
  { path: 'fundamentals/lenses', title: 'Lenses', order: 6 },
  { path: 'fundamentals/lifecycle', title: 'Lifecycle', order: 7 },
  { path: 'fundamentals/identity', title: 'Identity & Types', order: 8 },
  { path: 'fundamentals/security', title: 'Security', order: 9 },
  { path: 'fundamentals/persistence', title: 'Persistence', order: 10 },
  { path: 'messaging', title: 'Messaging', order: 4 },
  { path: 'messaging/transports', title: 'Transports', order: 10 },
  { path: 'data', title: 'Data', order: 5 },
  { path: 'apis', title: 'APIs & Integrations', order: 6 },
  { path: 'apis/rest', title: 'REST', order: 1 },
  { path: 'apis/graphql', title: 'GraphQL', order: 2 },
  { path: 'apis/mutations', title: 'Mutations', order: 3 },
  { path: 'apis/signalr', title: 'SignalR', order: 4 },
  { path: 'operations', title: 'Operations & Configuration', order: 7 },
  { path: 'operations/configuration', title: 'Configuration', order: 1 },
  { path: 'operations/observability', title: 'Observability', order: 2 },
  { path: 'operations/infrastructure', title: 'Infrastructure', order: 3 },
  { path: 'operations/workers', title: 'Workers', order: 4 },
  { path: 'operations/testing', title: 'Testing', order: 5 },
  { path: 'operations/diagnostics', title: 'Diagnostics', order: 6 },
  { path: 'operations/deployment', title: 'Deployment & Scaling', order: 7 },
  { path: 'extending', title: 'Extending Whizbang', order: 8 },
  { path: 'extending/extensibility', title: 'Extensibility', order: 1 },
  { path: 'extending/attributes', title: 'Attributes', order: 2 },
  { path: 'extending/source-generators', title: 'Source Generators', order: 3 },
  { path: 'extending/internals', title: 'Internals', order: 4 },
  { path: 'extending/features', title: 'Features', order: 5 },
];

// ─── Implementation ──────────────────────────────────────────────────────────

function log(msg) {
  console.log(DRY_RUN ? `[DRY-RUN] ${msg}` : msg);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    if (!DRY_RUN) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    log(`  mkdir ${path.relative(DOCS_ROOT, dirPath)}`);
  }
}

function createFolderMd(folderPath, title, order) {
  const filePath = path.join(DOCS_ROOT, folderPath, '_folder.md');
  if (fs.existsSync(filePath)) {
    // Update existing _folder.md with new order
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.includes(`order: ${order}`) && existing.includes(`title: ${title}`)) {
      return; // Already correct
    }
    log(`  update _folder.md: ${folderPath} (title: ${title}, order: ${order})`);
    if (!DRY_RUN) {
      const content = `---\ntitle: ${title}\norder: ${order}\n---\n\n# ${title}\n`;
      fs.writeFileSync(filePath, content);
    }
    return;
  }
  log(`  create _folder.md: ${folderPath} (title: ${title}, order: ${order})`);
  if (!DRY_RUN) {
    ensureDir(path.join(DOCS_ROOT, folderPath));
    const content = `---\ntitle: ${title}\norder: ${order}\n---\n\n# ${title}\n`;
    fs.writeFileSync(filePath, content);
  }
}

function gitMv(from, to) {
  const fromAbs = path.join(DOCS_ROOT, from);
  const toAbs = path.join(DOCS_ROOT, to);

  if (!fs.existsSync(fromAbs)) {
    log(`  SKIP (not found): ${from}`);
    return false;
  }

  ensureDir(path.dirname(toAbs));

  if (fs.existsSync(toAbs)) {
    log(`  SKIP (target exists): ${from} → ${to}`);
    return false;
  }

  log(`  git mv ${from} → ${to}`);
  if (!DRY_RUN) {
    execSync(`git mv "${fromAbs}" "${toAbs}"`, { cwd: DOCS_ROOT });
  }
  return true;
}

function deleteFile(filePath) {
  const abs = path.join(DOCS_ROOT, filePath);
  if (!fs.existsSync(abs)) return;
  log(`  git rm ${filePath}`);
  if (!DRY_RUN) {
    execSync(`git rm "${abs}"`, { cwd: DOCS_ROOT });
  }
}

function moveDocsFiles() {
  console.log('\n=== Phase 1: Create folder structure ===\n');

  for (const cfg of FOLDER_CONFIGS) {
    ensureDir(path.join(DOCS_ROOT, cfg.path));
    createFolderMd(cfg.path, cfg.title, cfg.order);
  }

  console.log('\n=== Phase 2: Move documentation files ===\n');

  // Track which files have been moved (to handle merge targets)
  const moved = new Set();

  // Process each mapping entry
  for (const [oldPath, newPath] of PATH_MAP) {
    const oldFile = `${oldPath}.md`;
    const newFile = `${newPath}.md`;

    // Skip merge sources - they'll be handled separately
    if (MERGE_SOURCES.has(oldPath)) {
      continue;
    }

    // Skip if already moved (e.g., duplicate mapping entries)
    if (moved.has(oldFile)) {
      continue;
    }

    if (gitMv(oldFile, newFile)) {
      moved.add(oldFile);
    }
  }

  console.log('\n=== Phase 3: Handle merge targets ===\n');

  // For merge sources, just delete them (content already covered by richer core-concepts versions)
  for (const source of MERGE_SOURCES) {
    const sourceFile = `${source}.md`;
    deleteFile(sourceFile);
  }

  console.log('\n=== Phase 4: Move remaining files ===\n');

  // Move _folder.md files that need to go with their content
  // and handle any files not in the explicit mapping

  // Move messaging root files (they stay at messaging/)
  const messagingFiles = [
    'commands-events', 'failure-handling', 'idempotency-patterns',
    'inbox-pattern', 'message-envelopes', 'multi-instance-coordination',
    'outbox-pattern', 'topic-filters', 'work-coordination', 'work-coordinator'
  ];
  for (const f of messagingFiles) {
    // These are already at messaging/, no move needed
  }

  // Move data root files (they stay at data/)
  const dataFiles = [
    'dapper-integration', 'efcore-integration', 'efcore-json-configuration',
    'event-store', 'perspectives-storage', 'schema-migration',
    'turnkey-initialization', 'work-coordinator-strategies'
  ];
  for (const f of dataFiles) {
    // These are already at data/, no move needed
  }

  console.log('\n=== Phase 5: Clean up empty directories ===\n');

  const dirsToCleanup = [
    'advanced-topics', 'architecture', 'components/data', 'components/transports',
    'components/workers', 'components', 'core-concepts/perspectives',
    'core-concepts', 'customization-examples', 'data-access', 'di',
    'diagnostics', 'extensibility', 'features', 'graphql', 'guides',
    'infrastructure', 'integrations', 'internals', 'lenses', 'observability',
    'perspectives', 'rest', 'signalr', 'source-generators', 'testing',
    'tracing', 'transports', 'tutorial', 'workers', 'attributes'
  ];

  for (const dir of dirsToCleanup) {
    const absDir = path.join(DOCS_ROOT, dir);
    if (fs.existsSync(absDir)) {
      // Remove any remaining _folder.md files
      const folderMd = path.join(absDir, '_folder.md');
      if (fs.existsSync(folderMd)) {
        log(`  rm ${dir}/_folder.md`);
        if (!DRY_RUN) {
          try {
            execSync(`git rm "${folderMd}"`, { cwd: DOCS_ROOT });
          } catch {
            fs.unlinkSync(folderMd);
          }
        }
      }

      // Try to remove directory if empty
      try {
        const remaining = fs.readdirSync(absDir);
        if (remaining.length === 0) {
          log(`  rmdir ${dir}`);
          if (!DRY_RUN) {
            fs.rmdirSync(absDir);
          }
        } else {
          log(`  WARN: ${dir} not empty: ${remaining.join(', ')}`);
        }
      } catch (e) {
        // Directory may already be gone
      }
    }
  }

  // Also remove components/README.md
  deleteFile('components/README.md');
}

// ─── Update <docs> tags in library source ────────────────────────────────────

function updateDocsTags() {
  console.log('\n=== Updating <docs> tags in library source ===\n');

  const srcDir = path.join(LIBRARY_ROOT, 'src');
  if (!fs.existsSync(srcDir)) {
    console.error(`Library src directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Build a sorted map (longest prefix first for greedy matching)
  const sortedMap = [...PATH_MAP].sort((a, b) => b[0].length - a[0].length);

  // Find all .cs files
  const csFiles = findFiles(srcDir, '.cs');
  log(`Found ${csFiles.length} .cs files to scan`);

  let totalChanges = 0;
  let filesChanged = 0;

  for (const file of csFiles) {
    // Skip generated/obj/bin
    if (file.includes('/obj/') || file.includes('/bin/') ||
        file.includes('/Generated/') ||
        file.endsWith('.designer.cs')) {
      continue;
    }

    let content = fs.readFileSync(file, 'utf-8');
    let changed = false;

    // Match <docs>path</docs> and <docs>path#anchor</docs>
    const newContent = content.replace(/<docs>(.*?)<\/docs>/g, (match, docsPath) => {
      // Split off anchor
      const hashIdx = docsPath.indexOf('#');
      const pathPart = hashIdx >= 0 ? docsPath.substring(0, hashIdx) : docsPath;
      const anchor = hashIdx >= 0 ? docsPath.substring(hashIdx) : '';

      // Try exact match first
      if (PATH_MAP.has(pathPart)) {
        const newPath = PATH_MAP.get(pathPart);
        changed = true;
        totalChanges++;
        return `<docs>${newPath}${anchor}</docs>`;
      }

      // Try prefix match (for paths like "components/transports" → "messaging/transports/transports")
      for (const [oldPrefix, newPrefix] of sortedMap) {
        if (pathPart.startsWith(oldPrefix + '/')) {
          const suffix = pathPart.substring(oldPrefix.length);
          const newPath = newPrefix + suffix;
          changed = true;
          totalChanges++;
          return `<docs>${newPath}${anchor}</docs>`;
        }
      }

      // No match found
      return match;
    });

    if (changed) {
      filesChanged++;
      if (!DRY_RUN) {
        fs.writeFileSync(file, newContent);
      }
      log(`  Updated: ${path.relative(LIBRARY_ROOT, file)}`);
    }
  }

  console.log(`\n  Total: ${totalChanges} tag updates in ${filesChanged} files`);
}

function findFiles(dir, ext) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findFiles(fullPath, ext));
      }
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (UPDATE_TAGS) {
  updateDocsTags();
} else {
  moveDocsFiles();
}
