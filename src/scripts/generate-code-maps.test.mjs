// Tests for generate-code-tests-map.mjs and generate-code-docs-map.mjs. Run: pnpm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { main as generateCodeTestsMap } from './generate-code-tests-map.mjs';
import { main as generateCodeDocsMap } from './generate-code-docs-map.mjs';

/** A throwaway library checkout: { 'relative/path.cs': 'content' }. */
function library(files) {
  const root = mkdtempSync(join(tmpdir(), 'code-maps-lib-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** An output file that already holds a committed map, so a refused run can be shown to leave it alone. */
function committedMap() {
  const path = join(mkdtempSync(join(tmpdir(), 'code-maps-out-')), 'map.json');
  writeFileSync(path, '{"committed":true}');
  return path;
}

/** Silences the generators' progress output and records their warnings. */
function quiet(t) {
  t.mock.method(console, 'log', () => {});
  return t.mock.method(console, 'warn', () => {});
}

const WAKE_SIGNAL = `namespace Whizbang.Core.Async;
/// <summary>A wake signal.</summary>
/// <docs>fundamentals/workers/perspective-worker-notify</docs>
/// <tests>tests/Whizbang.Core.Component.Tests/Async/WakeSignalTests.cs</tests>
public sealed class WakeSignal {
}
`;
const WAKE_SIGNAL_TESTS = `namespace Whizbang.Core.Tests.Async;
public class WakeSignalTests {
  [Test]
  public async Task Set_WakesTheWaiterAsync() {
    var signal = new WakeSignal();
    await Assert.That(signal).IsNotNull();
  }
}
`;
const UNTAGGED = `namespace Whizbang.Core;
public sealed class Untagged {
}
`;

for (const [name, generate] of [['code-tests map', generateCodeTestsMap], ['code-docs map', generateCodeDocsMap]]) {
  test(`${name}: a library path that does not exist is refused and the committed map is left alone`, async (t) => {
    quiet(t);
    const outputPath = committedMap();
    const missing = join(tmpdir(), 'no-such-library-checkout', 'whizbang');

    await assert.rejects(generate({ libraryPath: missing, outputPath }), /WHIZBANG_LIB_PATH/);

    assert.equal(readFileSync(outputPath, 'utf8'), '{"committed":true}');
  });

  test(`${name}: a library with no source files is refused and the committed map is left alone`, async (t) => {
    quiet(t);
    const outputPath = committedMap();
    const notALibrary = library({ 'README.md': '# not the library' });

    await assert.rejects(generate({ libraryPath: notALibrary, outputPath }), /WHIZBANG_LIB_PATH/);

    assert.equal(readFileSync(outputPath, 'utf8'), '{"committed":true}');
  });
}

test('code-tests map: a library whose source carries no <tests> tag is refused and the committed map is left alone', async (t) => {
  quiet(t);
  const outputPath = committedMap();
  const lib = library({ 'src/Whizbang.Core/Untagged.cs': UNTAGGED, 'tests/Whizbang.Core.Tests/UntaggedTests.cs': WAKE_SIGNAL_TESTS });

  await assert.rejects(generateCodeTestsMap({ libraryPath: lib, outputPath }), /no <tests> tag/);

  assert.equal(readFileSync(outputPath, 'utf8'), '{"committed":true}');
});

test('code-docs map: a library whose source carries no <docs> tag is refused and the committed map is left alone', async (t) => {
  quiet(t);
  const outputPath = committedMap();
  const lib = library({ 'src/Whizbang.Core/Untagged.cs': UNTAGGED });

  await assert.rejects(generateCodeDocsMap({ libraryPath: lib, outputPath }), /no <docs> tag/);

  assert.equal(readFileSync(outputPath, 'utf8'), '{"committed":true}');
});

test('code-tests map: a test file in a new test project is linked at its new path', async (t) => {
  quiet(t);
  const outputPath = committedMap();
  const lib = library({
    'src/Whizbang.Core/Async/WakeSignal.cs': WAKE_SIGNAL,
    'tests/Whizbang.Core.Component.Tests/Async/WakeSignalTests.cs': WAKE_SIGNAL_TESTS,
  });

  await generateCodeTestsMap({ libraryPath: lib, outputPath });

  const map = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.deepEqual(
    [...new Set(map.codeToTests.WakeSignal.map((l) => `${l.testFile}:${l.testMethod}`))],
    ['tests/Whizbang.Core.Component.Tests/Async/WakeSignalTests.cs:Set_WakesTheWaiterAsync'],
  );
  assert.equal(map.testsToCode['WakeSignalTests.Set_WakesTheWaiterAsync'][0].sourceFile, 'src/Whizbang.Core/Async/WakeSignal.cs');
});

test('code-tests map: a method-level <tests> tag naming a test file that does not exist is reported', async (t) => {
  const warn = quiet(t);
  const outputPath = committedMap();
  const lib = library({
    'src/Whizbang.Core/Async/WakeSignal.cs': WAKE_SIGNAL.replace(
      '<tests>tests/Whizbang.Core.Component.Tests/Async/WakeSignalTests.cs</tests>',
      '<tests>tests/Whizbang.Core.Tests/Async/WakeSignalTests.cs:Set_WakesTheWaiterAsync</tests>'),
    'tests/Whizbang.Core.Component.Tests/Async/WakeSignalTests.cs': WAKE_SIGNAL_TESTS,
  });

  await generateCodeTestsMap({ libraryPath: lib, outputPath });

  const warnings = warn.mock.calls.map((c) => c.arguments.join(' '));
  assert.ok(
    warnings.some((w) => w.includes('tests/Whizbang.Core.Tests/Async/WakeSignalTests.cs') && /does not exist/.test(w)),
    `expected a warning naming the missing test file, got:\n${warnings.join('\n')}`,
  );
});
