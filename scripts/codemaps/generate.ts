#!/usr/bin/env node
/**
 * scripts/codemaps/generate.ts
 *
 * Frontend codemap generator for this Angular workspace.
 *
 * Goal: give humans + AI agents fast entry points (routing, providers,
 * state, and layer boundaries) with stable diffs.
 *
 * Usage:
 *   npx tsx scripts/codemaps/generate.ts src
 *
 * Output (generated):
 *   docs/CODEMAPS/INDEX.md
 *   docs/CODEMAPS/AREAS.md
 *   docs/CODEMAPS/ROUTING.md
 *   docs/CODEMAPS/PROVIDERS.md
 *   docs/CODEMAPS/STATE.md
 *   docs/CODEMAPS/LAYERS.md
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'src');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'CODEMAPS');
const TODAY = new Date().toISOString().split('T')[0];

const OUTPUT_FILES = {
  index: 'INDEX.md',
  areas: 'AREAS.md',
  routing: 'ROUTING.md',
  providers: 'PROVIDERS.md',
  state: 'STATE.md',
  layers: 'LAYERS.md',
  publicApis: 'PUBLIC-APIS.md',
  application: 'APPLICATION.md',
} as const;

type AreaKey = 'app' | 'shared' | 'domains' | 'assets-config' | 'misc';

const AREAS: Record<AreaKey, { name: string; patterns: RegExp[] }> = {
  app: {
    name: 'App (Angular)',
    patterns: [/^src\/app\//, /^src\/styles\//],
  },
  shared: {
    name: 'Shared Libraries',
    patterns: [/^src\/shared\//],
  },
  domains: {
    name: 'Domains (Business Packages)',
    patterns: [/^src\/domains\//],
  },
  'assets-config': {
    name: 'Assets & Runtime Config',
    patterns: [/^src\/assets\//, /^src\/environments\//],
  },
  misc: {
    name: 'Misc (Top-Level src)',
    patterns: [],
  },
};

function rel(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function toMdList(items: string[], empty = '- *(none)*'): string {
  if (items.length === 0) return empty;
  return items.map((i) => `- ${i}`).join('\n');
}

function mdLink(fileRel: string): string {
  return `\`${fileRel}\``;
}

function safeRead(fileRel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, fileRel), 'utf8');
  } catch {
    return '';
  }
}

function extractRegexAll(content: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(content))) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function walkDir(dir: string, results: string[] = []): string[] {
  const SKIP = new Set([
    'node_modules',
    '.git',
    '.angular',
    'dist',
    'build',
    'out',
    'out-tsc',
    'coverage',
    '.cache',
  ]);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, results);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (
      !['.ts', '.tsx', '.js', '.jsx', '.html', '.scss', '.json'].includes(ext)
    ) {
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

function buildTree(dir: string, prefix = '', depth = 0): string {
  if (depth > 2) return '';

  const SKIP = new Set([
    'node_modules',
    '.git',
    '.angular',
    'dist',
    'build',
    'out',
    'out-tsc',
    'coverage',
  ]);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  const dirs = entries
    .filter(
      (e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items = [...dirs, ...files];
  let result = '';

  items.forEach((entry, i) => {
    const isLast = i === items.length - 1;
    const connector = isLast ? '\\-- ' : '|-- ';
    result += `${prefix}${connector}${entry.name}\n`;
    if (entry.isDirectory()) {
      const newPrefix = prefix + (isLast ? '    ' : '|   ');
      result += buildTree(path.join(dir, entry.name), newPrefix, depth + 1);
    }
  });

  return result;
}

function classify(filesAbs: string[]): Record<AreaKey, string[]> {
  const out: Record<AreaKey, string[]> = {
    app: [],
    shared: [],
    domains: [],
    'assets-config': [],
    misc: [],
  };

  for (const fileAbs of filesAbs) {
    const fileRel = rel(fileAbs);
    const matchKey = (Object.keys(AREAS) as AreaKey[]).find((key) =>
      AREAS[key].patterns.some((p) => p.test(fileRel))
    );
    out[matchKey ?? 'misc'].push(fileRel);
  }

  for (const key of Object.keys(out) as AreaKey[]) {
    out[key].sort();
  }

  return out;
}

function topDirectories(filesRel: string[]): string[] {
  const dirs = new Set(filesRel.map((f) => path.dirname(f)));
  return [...dirs].sort();
}

function entryPoints(filesRel: string[]): string[] {
  // Heuristic “jump files”. Keep stable and high-signal.
  return filesRel
    .filter((f) =>
      /(\/routes\.ts$)|(\/app\.routes\.ts$)|(\/app\.config\.ts$)|(\/index\.ts$)|(\/main\.ts$)|(\/public-api\.ts$)/.test(
        f
      )
    )
    .slice(0, 50);
}

function generateIndex(rootRel: string): string {
  return `# CODEMAPS Index

Last updated: ${TODAY}

Curated maps (edited by humans):
- \`docs/CODEMAPS/ARCHITECTURE.md\`
- \`docs/CODEMAPS/MODULES.md\`
- \`docs/CODEMAPS/FILES.md\`

Generated maps (regenerate, do not hand-edit):
- [Areas](./${OUTPUT_FILES.areas})
- [Routing](./${OUTPUT_FILES.routing})
- [Providers](./${OUTPUT_FILES.providers})
- [State](./${OUTPUT_FILES.state})
- [Layer coverage](./${OUTPUT_FILES.layers})
- [Public APIs](./${OUTPUT_FILES.publicApis})
- [Application layer](./${OUTPUT_FILES.application})

Regenerate:
\`\`\`bash
npx tsx scripts/codemaps/generate.ts ${rootRel}
\`\`\`
`;
}

function generateAreasDoc(
  classified: Record<AreaKey, string[]>,
  allFilesRel: string[],
  rootRel: string
): string {
  const totalFiles = allFilesRel.length;

  const rows = (Object.keys(classified) as AreaKey[])
    .map((k) => {
      const keyDirs = topDirectories(classified[k])
        .slice(0, 6)
        .map((d) => `\`${d}/\``)
        .join(', ');
      const eps = entryPoints(classified[k])
        .slice(0, 10)
        .map((e) => `\`${e}\``)
        .join(', ');
      return `| ${AREAS[k].name} | ${classified[k].length} | ${keyDirs || '—'} | ${eps || '—'} |`;
    })
    .join('\n');

  const tree = buildTree(SRC_DIR);

  return `# Generated Codemap: Areas

Last updated: ${TODAY}
Root: \`${rootRel}\`
Files scanned: ${totalFiles}

| Area | Files | Key directories (sample) | Common entry points (sample) |
|------|-------|--------------------------|------------------------------|
${rows}

## Structure (depth-limited)

\`\`\`text
${rootRel}/
${tree}\`\`\`
`;
}

function findRouteFiles(allFilesRel: string[]): string[] {
  const routes = allFilesRel.filter((f) => /\/routes\.ts$/.test(f));
  const rootRoutes = allFilesRel.filter((f) => /\/app\.routes\.ts$/.test(f));
  return uniqSorted([...rootRoutes, ...routes]);
}

function summarizeRouteFile(fileRel: string): {
  file: string;
  paths: string[];
  loadChildren: string[];
  loadComponent: string[];
  componentRefs: string[];
  providerCalls: string[];
} {
  const content = safeRead(fileRel);

  const paths = uniqSorted(
    extractRegexAll(content, /path\s*:\s*['"]([^'"]+)['"]/g).slice(0, 10)
  );

  const loadChildren = uniqSorted(
    extractRegexAll(
      content,
      /loadChildren\s*:\s*\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/g
    )
  );

  const loadComponent = uniqSorted(
    extractRegexAll(
      content,
      /loadComponent\s*:\s*\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/g
    )
  );

  const componentRefs = uniqSorted(
    extractRegexAll(content, /component\s*:\s*([A-Za-z0-9_]+)/g)
  ).slice(0, 12);

  const providerCalls = uniqSorted(
    extractRegexAll(content, /(provide[A-Za-z0-9_]+\(\))/g)
  ).slice(0, 20);

  return {
    file: fileRel,
    paths,
    loadChildren,
    loadComponent,
    componentRefs,
    providerCalls,
  };
}

function generateRoutingDoc(allFilesRel: string[], rootRel: string): string {
  const routeFiles = findRouteFiles(allFilesRel);

  const blocks = routeFiles
    .map((fileRel) => {
      const s = summarizeRouteFile(fileRel);
      const lines: string[] = [];
      lines.push(`## ${mdLink(s.file)}`);

      if (s.paths.length > 0) {
        lines.push('');
        lines.push(
          `Paths (hints): ${s.paths.map((p) => `\`${p}\``).join(', ')}`
        );
      }

      if (s.loadChildren.length > 0) {
        lines.push('');
        lines.push('Lazy route trees:');
        lines.push(toMdList(s.loadChildren.map((p) => `\`import('${p}')\``)));
      }

      if (s.loadComponent.length > 0) {
        lines.push('');
        lines.push('Lazy components:');
        lines.push(toMdList(s.loadComponent.map((p) => `\`import('${p}')\``)));
      }

      if (s.componentRefs.length > 0) {
        lines.push('');
        lines.push('Declared components (hints):');
        lines.push(toMdList(s.componentRefs.map((c) => `\`${c}\``)));
      }

      if (s.providerCalls.length > 0) {
        lines.push('');
        lines.push('Providers attached (hints):');
        lines.push(toMdList(s.providerCalls.map((c) => `\`${c}\``)));
      }

      return lines.join('\n');
    })
    .join('\n\n');

  return `# Generated Codemap: Routing

Last updated: ${TODAY}
Root: \`${rootRel}\`

Heuristic list of route entry points and their lazy-load relationships.

${blocks}
`;
}

function findProviderFiles(allFilesRel: string[]): string[] {
  const patterns = [
    /-service\.providers\.ts$/,
    /\.providers\.ts$/,
    /\.provider\.ts$/,
    /-context\.providers\.ts$/,
  ];
  return uniqSorted(allFilesRel.filter((f) => patterns.some((p) => p.test(f))));
}

function extractExportedFunctions(content: string): string[] {
  return uniqSorted(
    extractRegexAll(content, /export\s+function\s+([A-Za-z0-9_]+)\s*\(/g)
  );
}

function extractContexts(content: string): string[] {
  return uniqSorted(
    extractRegexAll(content, /AppContext\.([A-Z0-9_]+)/g).map(
      (c) => `AppContext.${c}`
    )
  );
}

function generateProvidersDoc(allFilesRel: string[], rootRel: string): string {
  const providerFiles = findProviderFiles(allFilesRel);

  const groupKeyFor = (fileRel: string): string => {
    const inApp = fileRel.match(/^src\/app\/([^/]+)\//);
    if (inApp) return `src/app/${inApp[1]}`;
    if (fileRel.startsWith('src/app/')) return 'src/app';
    if (fileRel.startsWith('src/shared/')) return 'src/shared';
    if (fileRel.startsWith('src/domains/')) return 'src/domains';
    return 'other';
  };

  const grouped: Record<string, string[]> = {};
  for (const f of providerFiles) {
    const k = groupKeyFor(f);
    grouped[k] ??= [];
    grouped[k].push(f);
  }

  const groups = Object.keys(grouped)
    .sort()
    .map((group) => {
      const files = grouped[group].sort();
      const entries = files
        .map((fileRel) => {
          const content = safeRead(fileRel);
          const exportedFns = extractExportedFunctions(content).slice(0, 12);
          const contexts = extractContexts(content).slice(0, 20);

          const lines: string[] = [];
          lines.push(`- ${mdLink(fileRel)}`);
          if (exportedFns.length > 0) {
            lines.push(
              `  exports: ${exportedFns.map((n) => `\`${n}()\``).join(', ')}`
            );
          }
          if (contexts.length > 0) {
            lines.push(
              `  contexts: ${contexts.map((c) => `\`${c}\``).join(', ')}`
            );
          }
          return lines.join('\n');
        })
        .join('\n');

      return `## ${group}\n\n${entries || '- *(none)*'}`;
    })
    .join('\n\n');

  return `# Generated Codemap: Providers

Last updated: ${TODAY}
Root: \`${rootRel}\`

Provider files are high-signal entry points for DI wiring and cross-context dependencies.

${groups}
`;
}

function generateStateDoc(allFilesRel: string[], rootRel: string): string {
  const proxies = uniqSorted(
    allFilesRel.filter((f) => /\.proxy\.ts$/.test(f) && !/\.spec\.ts$/.test(f))
  );
  const stores = uniqSorted(
    allFilesRel
      .filter((f) => /\.store\.ts$/.test(f) || /\/store\//.test(f))
      .filter((f) => !/\.spec\.ts$/.test(f))
  );

  const highlights = uniqSorted(
    [
      'src/app/core/shared/store/base.store.ts',
      'src/app/core/session/session.store.ts',
      'src/app/core/context/context.registry.ts',
    ].filter((p) => allFilesRel.includes(p))
  );

  const sessionSample = uniqSorted(
    allFilesRel.filter((f) => f.startsWith('src/app/core/session/'))
  ).slice(0, 80);

  const toolkitSample = uniqSorted(
    allFilesRel.filter((f) => f.startsWith('src/app/core/shared/store/'))
  ).slice(0, 80);

  return `# Generated Codemap: State

Last updated: ${TODAY}
Root: \`${rootRel}\`

## Key entry points

${toMdList(highlights.map(mdLink), '- *(not found)*')}

## Session proxies (cached cross-context ports)

${toMdList(proxies.slice(0, 80).map(mdLink), '- *(none found)*')}
${proxies.length > 80 ? `\n*...and ${proxies.length - 80} more*\n` : ''}

## Stores (high-signal paths)

${toMdList(stores.slice(0, 160).map(mdLink), '- *(none found)*')}
${stores.length > 160 ? `\n*...and ${stores.length - 160} more*\n` : ''}

## Core store toolkit (sample)

${toMdList(toolkitSample.map(mdLink), '- *(none found)*')}

## Core session (sample)

${toMdList(sessionSample.map(mdLink), '- *(none found)*')}
`;
}

function boundedContexts(allFilesRel: string[]): string[] {
  const dirs = new Set<string>();
  for (const f of allFilesRel) {
    const m = f.match(/^src\/app\/([^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

function hasAnyPrefix(filesRel: string[], prefixes: string[]): boolean {
  return prefixes.some((p) => filesRel.some((f) => f.startsWith(p)));
}

function generateLayersDoc(allFilesRel: string[], rootRel: string): string {
  const contexts = boundedContexts(allFilesRel);

  const rows = contexts
    .map((ctx) => {
      const prefix = `src/app/${ctx}/`;
      const ctxFiles = allFilesRel.filter((f) => f.startsWith(prefix));

      const hasPresentation = hasAnyPrefix(ctxFiles, [
        `${prefix}presentation/`,
        `${prefix}pages/`,
      ]);
      const hasApplication = hasAnyPrefix(ctxFiles, [`${prefix}application/`]);
      const hasDomain = hasAnyPrefix(ctxFiles, [
        `${prefix}domain/`,
        `${prefix}domains/`,
      ]);
      const hasInfrastructure = hasAnyPrefix(ctxFiles, [
        `${prefix}infrastructure/`,
      ]);

      const routesCount = ctxFiles.filter((f) =>
        /\/routes\.ts$/.test(f)
      ).length;
      const providersCount = ctxFiles.filter((f) =>
        /providers\.ts$/.test(f)
      ).length;

      return `| \`src/app/${ctx}/\` | ${hasPresentation ? 'yes' : '—'} | ${hasApplication ? 'yes' : '—'} | ${hasDomain ? 'yes' : '—'} | ${hasInfrastructure ? 'yes' : '—'} | ${routesCount} | ${providersCount} |`;
    })
    .join('\n');

  return `# Generated Codemap: Layer Coverage

Last updated: ${TODAY}
Root: \`${rootRel}\`

Quick heuristic view of which layer folders exist.

| Context root | has presentation/ | has application/ | has domain(s)/ | has infrastructure/ | routes.ts | *providers.ts |
|--------------|-------------------|------------------|---------------|---------------------|----------|--------------|
${rows}
`;
}

function findPublicApiFiles(allFilesRel: string[]): string[] {
  return uniqSorted(allFilesRel.filter((f) => /\/public-api\.ts$/.test(f)));
}

function extractExportedNames(content: string): string[] {
  const named = extractRegexAll(content, /export\s*\{([^}]+)\}/g)
    .flatMap((chunk) =>
      chunk
        .split(',')
        .map((s) => s.trim())
        .map((s) => s.split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
    )
    .filter((n) => !n.startsWith('/*') && !n.startsWith('//'));

  const exportedFns = extractExportedFunctions(content);

  return uniqSorted([...named, ...exportedFns]);
}

function generatePublicApisDoc(allFilesRel: string[], rootRel: string): string {
  const publicApis = findPublicApiFiles(allFilesRel);

  const blocks = publicApis
    .map((fileRel) => {
      const content = safeRead(fileRel);
      const exported = extractExportedNames(content);
      const ports = uniqSorted(exported.filter((n) => /Port$/.test(n))).slice(
        0,
        30
      );
      const providerFns = uniqSorted(
        exported.filter(
          (n) =>
            /Providers$/.test(n) ||
            /^provide[A-Z]/.test(n) ||
            /^get[A-Z].*Providers$/.test(n)
        )
      ).slice(0, 30);

      const lines: string[] = [];
      lines.push(`## ${mdLink(fileRel)}`);
      if (providerFns.length > 0) {
        lines.push('');
        lines.push(
          `Provider factories (hints): ${providerFns.map((n) => `\`${n}()\``).join(', ')}`
        );
      }
      if (ports.length > 0) {
        lines.push('');
        lines.push(`Ports (hints): ${ports.map((n) => `\`${n}\``).join(', ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return `# Generated Codemap: Public APIs

Last updated: ${TODAY}
Root: \`${rootRel}\`

This map lists \`public-api.ts\` files (common cross-context entry points).

${blocks}
`;
}

function generateApplicationDoc(
  allFilesRel: string[],
  rootRel: string
): string {
  const facades = uniqSorted(
    allFilesRel.filter((f) => /\.facade\.ts$/.test(f))
  );
  const useCases = uniqSorted(
    allFilesRel.filter((f) => /\.use-case\.ts$/.test(f))
  );

  const byCtx = (fileRel: string): string => {
    const m = fileRel.match(/^src\/app\/([^/]+)\//);
    if (m) return `src/app/${m[1]}`;
    if (fileRel.startsWith('src/domains/')) return 'src/domains';
    return 'other';
  };

  const group = (files: string[]): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const f of files) {
      const k = byCtx(f);
      out[k] ??= [];
      out[k].push(f);
    }
    for (const k of Object.keys(out)) out[k].sort();
    return out;
  };

  const renderGroups = (title: string, files: string[]): string => {
    const grouped = group(files);
    const blocks = Object.keys(grouped)
      .sort()
      .map((k) => {
        const sample = grouped[k].slice(0, 40).map(mdLink);
        const more = grouped[k].length > sample.length;
        return `## ${title}: ${k}\n\n${toMdList(sample, '- *(none)*')}${more ? `\n*...and ${grouped[k].length - sample.length} more*\n` : ''}`;
      })
      .join('\n\n');

    return blocks;
  };

  return `# Generated Codemap: Application Layer

Last updated: ${TODAY}
Root: \`${rootRel}\`

Heuristic index of facades and use cases.

${renderGroups('Facades', facades)}

${renderGroups('Use cases', useCases)}
`;
}

function removeLegacyGeneratedFiles(): void {
  // Clean up older generator outputs we no longer produce.
  const legacy = [
    'app.md',
    'shared.md',
    'domains.md',
    'assets-config.md',
    'misc.md',
    'frontend.md',
    'backend.md',
    'database.md',
    'integrations.md',
    'workers.md',
    'AREAS.md',
    'ROUTING.md',
    'PROVIDERS.md',
    'STATE.md',
    'LAYERS.md',
    'PUBLIC-APIS.md',
    'APPLICATION.md',
  ].map((f) => path.join(OUTPUT_DIR, f));

  for (const p of legacy) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

function main(): void {
  console.log(`[codemaps] Scanning: ${SRC_DIR}`);
  console.log(`[codemaps] Output:   ${OUTPUT_DIR}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  removeLegacyGeneratedFiles();

  const allFilesAbs = walkDir(SRC_DIR);
  const allFilesRel = allFilesAbs.map(rel).sort();
  const classified = classify(allFilesAbs);

  const rootRel = rel(SRC_DIR) || '.';

  const outIndex = path.join(OUTPUT_DIR, OUTPUT_FILES.index);
  fs.writeFileSync(outIndex, generateIndex(rootRel), 'utf8');
  console.log(`[codemaps] Written:  ${rel(outIndex)}`);

  const outAreas = path.join(OUTPUT_DIR, OUTPUT_FILES.areas);
  fs.writeFileSync(
    outAreas,
    generateAreasDoc(classified, allFilesRel, rootRel),
    'utf8'
  );
  console.log(`[codemaps] Written:  ${rel(outAreas)}`);

  const outRouting = path.join(OUTPUT_DIR, OUTPUT_FILES.routing);
  fs.writeFileSync(
    outRouting,
    generateRoutingDoc(allFilesRel, rootRel),
    'utf8'
  );
  console.log(`[codemaps] Written:  ${rel(outRouting)}`);

  const outProviders = path.join(OUTPUT_DIR, OUTPUT_FILES.providers);
  fs.writeFileSync(
    outProviders,
    generateProvidersDoc(allFilesRel, rootRel),
    'utf8'
  );
  console.log(`[codemaps] Written:  ${rel(outProviders)}`);

  const outState = path.join(OUTPUT_DIR, OUTPUT_FILES.state);
  fs.writeFileSync(outState, generateStateDoc(allFilesRel, rootRel), 'utf8');
  console.log(`[codemaps] Written:  ${rel(outState)}`);

  const outLayers = path.join(OUTPUT_DIR, OUTPUT_FILES.layers);
  fs.writeFileSync(outLayers, generateLayersDoc(allFilesRel, rootRel), 'utf8');
  console.log(`[codemaps] Written:  ${rel(outLayers)}`);

  const outPublicApis = path.join(OUTPUT_DIR, OUTPUT_FILES.publicApis);
  fs.writeFileSync(
    outPublicApis,
    generatePublicApisDoc(allFilesRel, rootRel),
    'utf8'
  );
  console.log(`[codemaps] Written:  ${rel(outPublicApis)}`);

  const outApplication = path.join(OUTPUT_DIR, OUTPUT_FILES.application);
  fs.writeFileSync(
    outApplication,
    generateApplicationDoc(allFilesRel, rootRel),
    'utf8'
  );
  console.log(`[codemaps] Written:  ${rel(outApplication)}`);
}

main();
