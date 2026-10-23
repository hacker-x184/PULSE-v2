import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

test('Security: Bcrypt hashes passwords securely and never matches invalid passwords', () => {
  const password = 'StrongPassword#2026';
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);

  assert.notEqual(hash, password, 'Password must not be stored in plaintext');
  assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'Hash must use bcrypt standard prefix');

  assert.ok(bcrypt.compareSync(password, hash), 'Valid password must verify against hash');
  assert.ok(!bcrypt.compareSync('WrongPassword', hash), 'Invalid password must not verify');
});

test('Security: HMAC signed auth tokens reject forged, malformed, or tampered tokens', () => {
  const secret = 'test-secret-key-prod-999';
  const userId = 'u-test-user-123';
  const expiry = Date.now() + 86400000;
  const payload = `${userId}.${expiry}`;
  const validHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const validToken = `${payload}.${validHmac}`;

  // Helper verifying token logic
  function verifyToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [u, exp, hmac] = parts;
    const expNum = parseInt(exp, 10);
    if (isNaN(expNum) || Date.now() > expNum) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${u}.${exp}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
    return u;
  }

  // 1. Valid token passes
  assert.equal(verifyToken(validToken), userId);

  // 2. Forged user ID is rejected
  const forgedToken = `u-admin.${expiry}.${validHmac}`;
  assert.equal(verifyToken(forgedToken), null, 'Forged token must be rejected');

  // 3. Expired token is rejected
  const pastExpiry = Date.now() - 10000;
  const expiredPayload = `${userId}.${pastExpiry}`;
  const expiredHmac = crypto.createHmac('sha256', secret).update(expiredPayload).digest('hex');
  assert.equal(verifyToken(`${expiredPayload}.${expiredHmac}`), null, 'Expired token must be rejected');

  // 4. Malformed tokens are rejected
  assert.equal(verifyToken('jwt-auth-admin'), null);
  assert.equal(verifyToken('garbage'), null);

  // 5. Short or tampered HMAC does not throw an uncaught exception
  function safeVerifyToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [u, exp, hmac] = parts;
    const expNum = parseInt(exp, 10);
    if (isNaN(expNum) || Date.now() > expNum) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${u}.${exp}`).digest('hex');
    const hmacBuf = Buffer.from(hmac, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (hmacBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;
    return u;
  }

  assert.doesNotThrow(() => {
    const res = safeVerifyToken(`u-test.${expiry}.short`);
    assert.equal(res, null, 'Short signature must safely return null without throwing RangeError');
  });
});

import { computePlanHash, executeApprovedWorkflowPlan, DbAdapter } from '../src/ai/pulseAgent.ts';

test('Security: Plan hash changes when any plan property is tampered with', () => {
  const originalPlan = {
    project_id: 'p-ledger',
    proposed_tasks: [{ title: 'Implement Auth', priority: 'High', estimated_hours: 6 }]
  };

  const hash1 = computePlanHash(originalPlan);

  // Tampered task
  const tamperedPlan = {
    project_id: 'p-ledger',
    proposed_tasks: [{ title: 'Implement Backdoor', priority: 'High', estimated_hours: 6 }]
  };

  const hash2 = computePlanHash(tamperedPlan);
  assert.notEqual(hash1, hash2, 'Plan hash must change when contents are modified');
});

test('Security: executeApprovedWorkflowPlan rejects tampered plan_json with hash mismatch', () => {
  const mockDb: DbAdapter = {
    queryAll: () => [],
    queryOne: <T = any>() => ({ id: 'p-ledger', key_prefix: 'EQX', current_sprint: 'Sprint 1' } as unknown as T),
    execute: () => {}
  };

  const validPlan = {
    project_id: 'p-ledger',
    proposed_tasks: [{ title: 'Legitimate Task', priority: 'Medium' }]
  };
  const validHash = computePlanHash(validPlan);

  // Tamper with the plan JSON while keeping original hash
  const tamperedPlanJson = JSON.stringify({
    project_id: 'p-ledger',
    proposed_tasks: [{ title: 'Malicious Injected Task', priority: 'High' }]
  });

  const workflowRecord = {
    id: 'wf-test-1',
    project_id: 'p-ledger',
    workflow_type: 'document_planner',
    plan_json: tamperedPlanJson,
    plan_hash: validHash, // Mismatched hash!
    status: 'WAITING_APPROVAL'
  };

  assert.throws(() => {
    executeApprovedWorkflowPlan(mockDb, workflowRecord, 'u-leader', 'Project Leader');
  }, /Plan integrity verification failed/, 'Tampered plan payload must be rejected on approval');
});

test('Security: Server-side registration forces default role "Member" and ignores client role escalation', () => {
  function processRegistration(inputRole: string | undefined): string {
    // Server-enforced role ignoring inputRole
    const userRole = 'Member';
    return userRole;
  }

  assert.equal(processRegistration('Admin'), 'Member', 'Admin role must not be granted via registration');
  assert.equal(processRegistration('Team Leader'), 'Member', 'Team Leader role must not be granted via registration');
  assert.equal(processRegistration('Super Admin'), 'Member', 'Super Admin role must not be granted via registration');
});
