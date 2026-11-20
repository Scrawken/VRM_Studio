import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedHostHeader } from './security';

test('Host allowlist accepts only exact loopback host:port', () => {
  for (const h of ['127.0.0.1:3100', 'localhost:3100', '[::1]:3100', 'LOCALHOST:3100']) {
    assert.equal(isAllowedHostHeader(h, 3100), true, h);
  }
});

test('Host allowlist rejects spoofed, rebinding, prefix, suffix and malformed hosts', () => {
  const bad = [
    undefined, '', 'evil.com', 'evil.com:3100', 'localhost.evil.com', 'localhost.evil.com:3100',
    '127.0.0.1.evil.com', '127.0.0.1.evil.com:3100', 'evil.com:3100.127.0.0.1:3100',
    '127.0.0.1:3101', '127.0.0.1', 'localhost', '127.0.0.1:3100 ', ' 127.0.0.1:3100',
    '127.0.0.1:3100, evil.com', 'user@127.0.0.1:3100', '127.0.0.1:31000', '0.0.0.0:3100', '127.0.0.2:3100',
  ];
  for (const h of bad) assert.equal(isAllowedHostHeader(h, 3100), false, String(h));
});

test('bare host accepted only when the server listens on port 80', () => {
  assert.equal(isAllowedHostHeader('localhost', 80), true);
  assert.equal(isAllowedHostHeader('localhost', 3000), false);
});

test('explicit LAN bind host is allowed only with the live port', () => {
  assert.equal(isAllowedHostHeader('192.168.1.5:3000', 3000, ['192.168.1.5']), true);
  assert.equal(isAllowedHostHeader('192.168.1.5:3000', 3000), false);
  assert.equal(isAllowedHostHeader('192.168.1.5:3001', 3000, ['192.168.1.5']), false);
});
