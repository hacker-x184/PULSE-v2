import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('GitHub Jira issue key & status transition logic', () => {
  const issueKeyRegex = /\b([A-Z]{2,10}-\d+)\b/i;
  const closingRegex = /\b(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved|done|complete|completed)\s+([A-Z]{2,10}-\d+)/i;

  it('extracts Jira issue key from commit messages', () => {
    const msg1 = 'EQX-101: implement ledger balance check';
    const match1 = msg1.match(issueKeyRegex);
    assert.strictEqual(match1?.[1].toUpperCase(), 'EQX-101');

    const msg2 = '[PORT-42] add customer analytics dashboard';
    const match2 = msg2.match(issueKeyRegex);
    assert.strictEqual(match2?.[1].toUpperCase(), 'PORT-42');
  });

  it('detects closing keywords before issue keys', () => {
    const msg1 = 'Fixes EQX-101: resolve settlement edge case';
    assert.ok(closingRegex.test(msg1));

    const msg2 = 'close EQX-101 in hotfix branch';
    assert.ok(closingRegex.test(msg2));

    const msg3 = 'WIP work on EQX-101 without closing';
    assert.strictEqual(closingRegex.test(msg3), false);
  });

  it('cleans repository URLs properly', () => {
    function cleanRepo(input) {
      let clean = input.trim();
      const match = clean.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
      if (match) {
        return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
      }
      if (clean.includes('/')) {
        const parts = clean.split('/');
        return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
      }
      return null;
    }

    assert.deepStrictEqual(cleanRepo('https://github.com/facebook/react'), { owner: 'facebook', repo: 'react' });
    assert.deepStrictEqual(cleanRepo('facebook/react'), { owner: 'facebook', repo: 'react' });
    assert.deepStrictEqual(cleanRepo('https://github.com/octocat/Hello-World.git'), { owner: 'octocat', repo: 'Hello-World' });
  });
});
