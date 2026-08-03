import assert from 'node:assert/strict';
import test from 'node:test';
import { docsOgLayout, getDocsOgTypography } from '../lib/docs-og-layout.mjs';

const brainstormVi = {
  title: 'Định hình hướng triển khai với ak:brainstorm',
  description:
    'Biến ý định chưa đầy đủ thành outcome có giới hạn, so sánh các hướng khả thi và chuyển giao quyết định dựa trên bằng chứng.',
};

test('reduces typography for the Vietnamese brainstorm social card', () => {
  assert.deepEqual(
    getDocsOgTypography(brainstormVi.title, brainstormVi.description),
    {
      titleFontSize: 62,
      descriptionFontSize: 32,
    },
  );
});

test('reserves independent content and footer regions', () => {
  assert.equal(docsOgLayout.contentHeight, 390);
  assert.ok(docsOgLayout.titleMaxHeight < docsOgLayout.contentHeight);
  assert.ok(docsOgLayout.footerHeight > 0);
});

test('uses the smallest typography tier for very long metadata', () => {
  assert.deepEqual(getDocsOgTypography('x'.repeat(66), 'x'.repeat(181)), {
    titleFontSize: 54,
    descriptionFontSize: 28,
  });
});
