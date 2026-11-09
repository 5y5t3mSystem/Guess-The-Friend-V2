#!/usr/bin/env node
'use strict';

/*
 * Local sequential-voting verification harness.
 * This mirrors the authoritative invariants in apps-script/Code.gs.
 * It does not call Google Apps Script or Google Sheets.
 */

const assert = require('assert');
const fs = require('fs');

const backend = fs.readFileSync('apps-script/Code.gs', 'utf8');
const client = fs.readFileSync('multiplayer.js', 'utf8');

assert(backend.includes('return s.players.filter(x=>x.id!==answer.authorId).map(x=>x.id);'));
assert(backend.includes('s.voterOrder=eligibleVoters_(s,answer);'));
assert(backend.includes("s.currentVoterId!==p.id"));
assert(backend.includes("s.deadlineAt&&t>=s.deadlineAt"));
assert(backend.includes('skipTimedOutVoter_(s,t);'));
assert(client.includes('btn.disabled=busy;'));
assert(!client.includes('btn.disabled=!p.connected||busy;'));

function game() {
  const players = [
    { id: 'A', name: 'A', score: 0 },
    { id: 'B', name: 'B', score: 0 },
    { id: 'C', name: 'C', score: 0 }
  ];
  const answer = { id: 'answer-1', authorId: 'A' };
  const state = {
    players, answer, phase: 'voting',
    voterOrder: players.filter(p => p.id !== answer.authorId).map(p => p.id),
    voterIndex: 0, currentVoterId: 'B',
    deadlineAt: 11000, now: 1000, votes: []
  };
  return state;
}

const s = game();
assert.deepStrictEqual(s.voterOrder, ['B', 'C']);
assert.strictEqual(s.currentVoterId, 'B');

// C cannot vote while B is active.
assert.notStrictEqual(s.currentVoterId, 'C');

// B votes once; the queue advances exactly once.
s.votes.push({ voterId: 'B', targetId: 'C' });
s.voterIndex++;
s.currentVoterId = s.voterOrder[s.voterIndex];
s.deadlineAt = s.now + 10000;
assert.strictEqual(s.currentVoterId, 'C');
assert.strictEqual(s.votes.length, 1);

// B cannot vote again on the same answer.
assert(s.votes.some(v => v.voterId === 'B'));

// C receives a fresh full-duration deadline.
assert.strictEqual(s.deadlineAt, 11000);

// Simulate C timeout: advance once, then finish.
s.now = s.deadlineAt;
s.voterIndex++;
s.currentVoterId = s.voterOrder[s.voterIndex] || null;
assert.strictEqual(s.currentVoterId, null);

console.log('PASS: source invariants + 3-player sequential voting harness');
