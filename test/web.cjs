const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});
 try {
  for(const width of [1280,360]){
   const page=await browser.newPage({viewport:{width,height:900}});
   // Read data from Sepolia. Supply only wallet identity to exercise the UI without signing.
   await page.addInitScript(()=>{window.ethereum={request:async({method})=>{
    if(method==='eth_accounts')return ['0x955b721de0dc3c55a95703772eb44440af6487e3'];
    if(method==='eth_chainId')return '0xaa36a7';
    throw Error('Unexpected wallet request: '+method)
   }}});
   await page.goto('http://127.0.0.1:15173/');
   await page.getByRole('heading',{name:'งานของฉัน',exact:true}).waitFor();
   assert.equal(await page.getByText('บอร์ดงาน',{exact:true}).count(),0);
   await page.getByLabel('ค้นหางาน').fill('#1');
   await page.getByLabel('สถานะงาน').selectOption({label:'จ่ายแล้ว'});
   await page.getByLabel('บทบาทของฉัน').selectOption('ผู้ว่าจ้าง');
   await page.locator('a.jobrow[href="#/jobs/1"]').waitFor();
   await page.getByLabel('บทบาทของฉัน').selectOption('ฟรีแลนซ์');
   await page.getByText('ไม่พบงานที่ตรงกับตัวกรอง').waitFor();
   await page.getByRole('button',{name:'ล้างตัวกรอง'}).click();
   assert.equal(await page.getByLabel('ค้นหางาน').inputValue(),'');
   await page.getByRole('link',{name:'+ สร้างงาน'}).click();
   await page.getByLabel('ชื่อโครงการ').fill('ตรวจฟอร์ม');
   await page.getByLabel('รายละเอียดงาน',{exact:true}).fill('ตรวจการกรอกข้อมูล');
   await page.getByLabel('กระเป๋าฟรีแลนซ์').fill('0x3621abbA8afB2dc2D207964732e133603ACaEFC8');
   await page.getByLabel('ค่าจ้าง (Sepolia ETH)').fill('0.001');
   const day=page.getByLabel('วันที่ส่งงาน'), time=page.getByLabel('เวลาส่งงาน');
   assert.equal(await day.getAttribute('type'),'date');
   const hours=Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+':00');
   assert.deepEqual(await time.locator('option').allTextContents(),hours.map(h=>h+' น.'));
   await page.getByRole('button',{name:'อีก 7 วัน'}).click();
   assert.match(await day.inputValue(),/^\d{4}-\d{2}-\d{2}$/);
   await day.fill('2030-11-25');
   for(const hour of ['00:00','23:00']){
     await time.selectOption(hour);
     await page.getByRole('button',{name:'ตรวจทานข้อตกลง'}).click();
     await page.getByRole('dialog').getByText(new RegExp(hour)).waitFor();
     await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.close();console.log('PASS filters, reset, calendar, 24 hourly options, review at',width);
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
