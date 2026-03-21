#!/usr/bin/env node
// esbuild.config.js – Build configuration for Cortex Tools userscript

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const HEADER_FILE = path.join(ROOT, 'userscript.header.js');
const ENTRY = path.join(ROOT, 'src', 'index.ts');
const OUT_SCRIPT = path.join(DIST, 'cortex-tools.user.js');
const OUT_META = path.join(DIST, 'cortex-tools.meta.js');

// Ensure dist directory exists
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// Read the userscript header comment
const header = fs.readFileSync(HEADER_FILE, 'utf8').trimEnd();

/**
 * esbuild plugin: prepends the userscript header to the final bundle.
 * Also wraps the output in an IIFE (handled by esbuild's "iife" format)
 * and writes the .meta.js file (header only, for Tampermonkey update checks).
 */
const userscriptPlugin = {
  name: 'userscript',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      // Read esbuild's output
      const outFile = build.initialOptions.outfile;
      let bundleCode = '';
      try {
        bundleCode = fs.readFileSync(outFile, 'utf8');
      } catch {
        // outfile not found — esbuild may have used write:false
        const output = result.outputFiles?.find((f) => f.path.endsWith('.js'));
        if (output) bundleCode = output.text;
      }

      // Write the final userscript: header + blank line + bundle
      const finalSource = `${header}\n\n${bundleCode}`;
      fs.writeFileSync(OUT_SCRIPT, finalSource, 'utf8');

      // Write .meta.js (header only, for update-URL / metadata polling)
      fs.writeFileSync(OUT_META, header + '\n', 'utf8');

      const kb = (finalSource.length / 1024).toFixed(1);
      console.log(`[esbuild] ✅  ${path.relative(ROOT, OUT_SCRIPT)} (${kb} KB)${isProd ? ' [minified]' : ''}`);
    });
  },
};

const buildOptions = {
  entryPoints: [ENTRY],
  bundle: true,
  // esbuild writes to a temp file; our plugin then overwrites with header+bundle
  outfile: path.join(DIST, '_bundle.js'),
  format: 'iife',
  target: ['chrome90', 'firefox90'],
  platform: 'browser',
  minify: isProd,
  sourcemap: !isProd ? 'inline' : false,
  logLevel: 'info',
  plugins: [userscriptPlugin],
  // Treat GM_* globals as externals – they are injected by Tampermonkey at runtime
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
  },
  banner: {
    // Empty banner – we inject the header ourselves via the plugin
    js: '',
  },
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] 👀  Watching for changes…');
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch((e) => {
  console.error('[esbuild] ❌ Build failed:', e);
  process.exit(1);
});
