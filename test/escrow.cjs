const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const ganache = require('ganache');
const solc = require('solc');

const file = 'FreelanceEscrow.sol';
const source = fs.readFileSync(path.join(__dirname, '../contracts', file), 'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { [file]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
})));
assert.deepEqual((compiled.errors || []).filter(e => e.severity === 'error'), []);
const artifact = compiled.contracts[file].FreelanceEscrow;
const wage = ethers.parseEther('0.001');
const period = 3 * 86400;
const send = async promise => (await promise).wait();
const denied = (promise, reason) => assert.rejects(promise, e =>
  e.code === 'CALL_EXCEPTION' && e.reason === reason);

async function setup(t) {
  const chain = ganache.provider({logging: {quiet: true}, miner: {timestampIncrement: 0}});
  t.after(() => chain.disconnect());
  const p = new ethers.BrowserProvider(chain);
  const [employer, worker, judge, outsider] = await Promise.all([0,1,2,3].map(i => p.getSigner(i)));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, employer);
  const c = await factory.deploy(judge.address);
  await c.waitForDeployment();
  const deadline = (await p.getBlock('latest')).timestamp + 1000;
  async function at(timestamp) {
    await p.send('evm_setTime', [timestamp * 1000]);
    await p.send('evm_mine', []);
    assert.equal(Number((await p.send('eth_getBlockByNumber',['latest',false])).timestamp), timestamp);
  }
  const create = (amount = wage) => send(c.createJob('Design','Homepage',worker.address,amount,deadline));
  const balance = async address => BigInt(await p.send('eth_getBalance',[address,'latest']));
  const escrow = () => balance(c.target);
  const status = async id => (await c.getJob(id)).status;
  return {c, w:c.connect(worker), j:c.connect(judge), x:c.connect(outsider), employer, worker,
    judge, deadline, at, create, balance, escrow, status};
}

test('Normal payment and isolation of two different wages', async t => {
  const {c,w,worker,create,balance,escrow,status} = await setup(t);
  await create(); await create(3n*wage);
  assert.equal(await status(1),0n);
  await send(c.depositPayment(1,{value:wage})); await send(c.depositPayment(2,{value:3n*wage}));
  assert.equal(await status(1),1n);
  await send(w.submitWork(1,'demo-hash'));
  assert.equal(await status(1),2n);
  const before = await balance(worker.address);
  await send(c.approveAndRelease(1));
  assert.equal(await balance(worker.address)-before,wage);
  assert.equal(await status(1),4n);
  await denied(c.approveAndRelease.staticCall(1),'Job not awaiting approval');
  assert.equal(await escrow(),3n*wage);
  assert.equal(await status(2),1n);
});

test('Invalid amounts, evidence, roles and order leave escrow unchanged', async t => {
  const {c,w,x,j,worker,judge,create,deadline,escrow,status} = await setup(t);
  for (const [caller,freelancer] of [[j,worker.address],[c,judge.address]]) {
    await denied(caller.createJob.staticCall('a','b',freelancer,wage,deadline),'Arbitrator must be independent');
  }
  await create();
  await denied(w.submitWork.staticCall(1,'hash'),'Job not funded');
  await denied(x.depositPayment.staticCall(1,{value:wage}),'Employer only');
  await denied(c.depositPayment.staticCall(1,{value:wage-1n}),'Deposit exact wage');
  // Force an invalid transaction to be mined, in addition to inspecting the revert reason.
  await assert.rejects(send(c.depositPayment(1,{value:wage-1n,gasLimit:150000})),
    e => e.receipt?.status === 0);
  assert.equal(await status(1),0n); assert.equal(await escrow(),0n);
  await send(c.depositPayment(1,{value:wage}));
  await denied(c.depositPayment.staticCall(1,{value:wage}),'Job not awaiting deposit');
  await denied(w.submitWork.staticCall(1,''),'Missing evidence');
  await denied(x.submitWork.staticCall(1,'hash'),'Freelancer only');
  await denied(c.approveAndRelease.staticCall(1),'Job not awaiting approval');
  await denied(x.openDispute.staticCall(1,'issue'),'Parties only');
  assert.equal(await status(1),1n); assert.equal(await escrow(),wage);
});

test('Delivery deadline is inclusive; approve freezes and refund is final', async t => {
  const {c,w,j,x,employer,create,at,deadline,balance,escrow,status} = await setup(t);
  await create(); await create(); await create();
  await send(c.depositPayment(1,{value:wage})); await send(c.depositPayment(2,{value:wage}));
  await at(deadline);
  await send(w.submitWork(1,'on-time')); assert.equal(await c.submittedAt(1),BigInt(deadline));
  await denied(c.openDispute.staticCall(2,'late'),'No overdue delivery');
  await at(deadline+1);
  await denied(c.depositPayment.staticCall(3,{value:wage}),'Delivery deadline passed');
  await denied(w.submitWork.staticCall(2,'late'),'Delivery deadline passed');
  await send(c.openDispute(2,'Missing delivery'));
  await denied(c.approveAndRelease.staticCall(2),'Job not awaiting approval');
  await denied(x.addEvidence.staticCall(2,'text'),'Parties only');
  await send(c.addEvidence(2,'Employer note'));
  await denied(j.resolveDispute.staticCall(2,0,'refund'),'Awaiting response');
  await send(w.addEvidence(2,'Worker response'));
  await denied(x.resolveDispute.staticCall(2,0,'refund'),'Arbitrator only');
  await denied(j.resolveDispute.staticCall(2,0,''),'Missing decision reason');
  const before = await balance(employer.address);
  await send(j.resolveDispute(2,0,'No delivery'));
  assert.equal(await balance(employer.address)-before,wage);
  await denied(j.resolveDispute.staticCall(2,1,'retry'),'No open dispute');
  assert.equal(await status(2),5n); assert.equal(await escrow(),wage);
});

test('Exact review and response boundaries; no automatic release on expiry', async t => {
  const {c,w,j,worker,create,at,balance,escrow,status} = await setup(t);
  await create(); await send(c.depositPayment(1,{value:wage})); await send(w.submitWork(1,'hash'));
  const reviewEnd = Number(await c.submittedAt(1))+period;
  await at(reviewEnd-1);
  await c.openDispute.staticCall(1,'quality');
  await denied(w.openDispute.staticCall(1,'silence'),'Review ongoing');
  await at(reviewEnd);
  await denied(c.openDispute.staticCall(1,'quality'),'Review closed');
  await send(w.openDispute(1,'No review'));
  const responseEnd = reviewEnd+period;
  assert.equal((await c.disputes(1)).responseDeadline,BigInt(responseEnd));
  await at(responseEnd-1);
  await c.addEvidence.staticCall(1,'response');
  await denied(j.resolveDispute.staticCall(1,1,'pay'),'Awaiting response');
  await at(responseEnd);
  await denied(c.addEvidence.staticCall(1,'response'),'Response period ended');
  assert.equal(await status(1),3n); assert.equal(await escrow(),wage);
  const before = await balance(worker.address);
  await send(j.resolveDispute(1,1,'Delivery verified'));
  assert.equal(await balance(worker.address)-before,wage);
  assert.equal(await status(1),4n); assert.equal(await escrow(),0n);
  await denied(j.resolveDispute.staticCall(1,0,'retry'),'No open dispute');
});
