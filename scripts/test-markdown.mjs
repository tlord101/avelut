import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Run with: node scripts/test-markdown.mjs (after installing repo dependencies).
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { MarkdownContent } = await server.ssrLoadModule('/components/MarkdownContent.tsx');
  const { preprocessMarkdown, prepareMarkdown } = await server.ssrLoadModule('/utils/markdownPreprocess.ts');
  const render = (content) => renderToStaticMarkup(React.createElement(MarkdownContent, { content }));

  assert.equal(preprocessMarkdown('==key term== and ==x=='), '<mark>key term</mark> and <mark>x</mark>');
  assert.equal(preprocessMarkdown('<mark>==leave alone==</mark>'), '<mark>==leave alone==</mark>');
  assert.equal(preprocessMarkdown('==unfinished'), '==unfinished');
  assert.equal(preprocessMarkdown('===not a highlight==='), '===not a highlight===');

  for (const literal of ['`alpha == beta`', '```\nalpha == beta\n```', '~~~js\nconst x_0 = 10^5;\n~~~', '```js\nalpha == beta', '[source](https://example.org/alpha/x_0)']) {
    assert.equal(prepareMarkdown(literal), literal, `Literal changed: ${literal}`);
  }

  const typography = render('# Title\n\n## Section\n\n### Subsection\n\n#### Detail\n\n**bold** and *italic*\nnext line');
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'strong', 'em', 'br']) assert.match(typography, new RegExp(`<${tag}[ >/]`));
  assert.match(typography, /dark:text-white/);

  const highlights = render('==important== and <mark>existing</mark>');
  assert.equal((highlights.match(/<mark /g) || []).length, 2);
  assert.match(highlights, /bg-blue-100/);
  assert.match(highlights, /dark:bg-blue-900\/50/);
  assert.doesNotMatch(highlights, /amber|gold|yellow/);
  assert.match(render('==**important**=='), /<mark[^>]*><strong/);

  for (const fence of ['```\none line\n```', '```c++\nint x = 1;\n```', '```\n```', '    indented code']) {
    assert.match(render(fence), /Copy code to clipboard/);
  }
  assert.doesNotMatch(render('`inline`'), /Copy code to clipboard/);
  assert.match(render('```\nalpha == beta\n```'), /alpha == beta/);

  assert.match(render('$x^2$'), /class="katex"/);
  assert.match(render('$$\nx^2\n$$'), /katex-display/);
  assert.match(render('x^2'), /class="katex"/);
  assert.match(render('| Name | Value |\n| :--- | ---: |\n| A | 1 |'), /<table/);
  assert.match(render('3. First\n4. Second'), /<ol start="3"/);
  assert.match(render('- [x] Finished'), /type="checkbox"/);
  assert.match(render('> Quoted'), /border-blue-400/);
  assert.match(render('[source](https://example.org)'), /rel="noopener noreferrer"/);
  assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
  assert.doesNotMatch(render('<mark onclick="alert(1)">unsafe attributes</mark>'), /<mark onclick/);
  assert.doesNotMatch(render('[unsafe](javascript:alert%281%29)'), /href="javascript:/);

  for (const partial of ['## Stream', '==unfinished', '```js\nconst x =', '$x', '<mark>term']) {
    assert.doesNotThrow(() => render(partial));
  }
  console.log('Markdown rendering smoke tests passed.');
} finally {
  await server.close();
}
