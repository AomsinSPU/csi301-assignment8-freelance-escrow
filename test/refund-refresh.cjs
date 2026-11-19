const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { JsonRpcProvider, toQuantity } = require('ethers');
const config = require('../public/sepolia.json');

// Replay the existing job #2 refund with the public reader one block behind.
const hash = '0x8209856df22d775df83913b759d1828d18ebed6c878ce803a343428c4ea51c22';
async function run() {
  const reader = new JsonRpcProvider(config.rpc);
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const tx = await reader.getTransaction(hash);
    const page = await browser.newPage();
    let head = tx.blockNumber - 1;
    let replayed = false;
    let staleReads = 0;
    await page.route(config.rpc + '/**', async route => {
      const body = route.request().postDataJSON();
      const read = async ({ id, method, params }) => {
        if (method === 'eth_getBlockByNumber' && params[0] === 'latest') {
          params = [toQuantity(head), params[1]];
          if (replayed && head < tx.blockNumber) staleReads++;
        }
        return { jsonrpc: '2.0', id, result: await reader.send(method, params) };
      };
      await route.fulfill({ json: Array.isArray(body) ? await Promise.all(body.map(read)) : await read(body) });
    });
    await page.exposeFunction('testWallet', async ({ method, params }) => {
      if (method === 'eth_accounts') return [tx.from];
      if (method === 'eth_chainId') return toQuantity(config.chainId);
      if (method === 'eth_estimateGas') return toQuantity(tx.gasLimit);
      if (method === 'eth_sendTransaction') {
        assert.equal(params[0].data, tx.data);
        assert.equal(params[0].to.toLowerCase(), config.address.toLowerCase());
        replayed = true;
        return hash;
      }
      assert.ok(['eth_blockNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
        'eth_getBlockByNumber'].includes(method), method);
      return reader.send(method, params);
    });
    await page.addInitScript(() => { window.ethereum = { request: window.testWallet }; });
    await page.goto('http://127.0.0.1:15173/#/jobs/2');
    const decide = page.getByRole('button', { name: 'ตัดสินข้อพิพาท' });
    await decide.click();
    await page.getByLabel('เหตุผลของคำตัดสิน').fill('กรณีทดสอบ #2 ทั้งสองฝ่ายยืนยันว่าเป็นฉบับร่าง คืนค่าจ้างเต็มจำนวน');
    await page.getByRole('button', { name: 'ตรวจทานรายการ' }).click();
    await page.getByRole('button', { name: 'ยืนยันในกระเป๋า' }).click();
    await page.getByText(/กำลังอัปเดตสถานะงานและยอดเงิน/).waitFor();
    assert.equal(await decide.count(), 0);
    for (let i = 0; !staleReads && i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(staleReads, 'expected an outdated public RPC response after wallet confirmation');
    head = tx.blockNumber;
    await page.getByText('คืนแล้ว', { exact: true }).waitFor();
    assert.match(await page.locator('.amount').innerText(), /^0\s+ETH$/);
    assert.equal(await decide.count(), 0);
    console.log('PASS refund status, balance and actions update without page reload');
  } finally {
    await browser.close();
    reader.destroy();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
