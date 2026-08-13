import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelRouteHref,
  unavailableChannelUrls,
} from '../lib/channel-route-href.mjs';

test('keeps the same route when it exists in the target channel', () => {
  assert.equal(
    channelRouteHref('en', 'stable', ['reference', 'cli'], true),
    '/en/stable/reference/cli',
  );
});

test('falls back to the target channel root for a channel-only route', () => {
  assert.equal(
    channelRouteHref('vi', 'stable', ['reference', 'cli', 'orchestrate'], false),
    '/vi/stable',
  );
});

test('decodes static route segments before building the target href', () => {
  assert.equal(
    channelRouteHref('en', 'stable', ['guides', 'hello%20world'], true),
    '/en/stable/guides/hello world',
  );
});

test('lists only channel counterpart URLs that do not exist', () => {
  assert.deepEqual(
    unavailableChannelUrls([
      '/en/stable',
      '/en/beta',
      '/en/stable/reference/cli',
      '/en/beta/reference/cli',
      '/en/beta/reference/cli/orchestrate',
    ]),
    ['/en/stable/reference/cli/orchestrate'],
  );
});
