import {
  Contract,
  JsonRpcProvider,
  Interface,
  formatEther,
  type InterfaceAbi,
} from "ethers";
export type Deployment = {
  marketplace?: boolean;
  chainId: number;
  name: string;
  rpc: string;
  address: string;
  block: number;
  explorer: string;
  abi: InterfaceAbi;
};
export type Entry = {
  name: string;
  actor: string;
  time: number;
  hash: string;
  text: string;
  recipient?: string;
  amount?: bigint;
};
export type Job = {
  id: string;
  title: string;
  description: string;
  employer: string;
  freelancer: string;
  deadline: number;
  wage: bigint;
  status: number;
  evidence: string;
  reviewEnd: number;
  responseEnd: number;
  responded: boolean;
  events: Entry[];
};
export type Snapshot = { jobs: Job[]; judge: string; now: number; block: number };
export const labels = [
  "รอฝากเงิน",
  "ฝากเงินแล้ว",
  "รอตรวจรับ",
  "อยู่ระหว่างข้อพิพาท",
  "จ่ายแล้ว",
  "คืนแล้ว",
  "เปิดรับฟรีแลนซ์",
];
export const eventNames: Record<string, string> = {
  JobCreated: "สร้างข้อตกลง",
  PaymentDeposited: "ฝากค่าจ้าง",
  JobAccepted: "ฟรีแลนซ์รับงาน",
  WorkSubmitted: "ส่งหลักฐานงาน",
  PaymentReleased: "จ่ายค่าจ้าง",
  DisputeOpened: "เปิดข้อพิพาท",
  EvidenceAdded: "เพิ่มหลักฐาน",
  DisputeResolved: "ตัดสินข้อพิพาท",
};
export const eth = (v: bigint) => formatEther(v).replace(/\.0$/, "");
export const date = (v: number) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(v * 1000);
export const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
export const same = (a: string, b: string) =>
  !!a && a.toLowerCase() === b.toLowerCase();
export async function readChain(
  p: JsonRpcProvider,
  d: Deployment,
): Promise<Snapshot> {
  const c = new Contract(d.address, d.abi, p),
    iface = new Interface(d.abi);
  const head = await p.getBlock("latest");
  if (!head) throw Error("อ่านบล็อกล่าสุดไม่ได้");
  const opt = { blockTag: head.number };
  const [judge, period] = await Promise.all([
    c.arbitrator(opt),
    c.REVIEW_PERIOD(opt),
  ]);
  const history = new Map<string, Entry[]>();
  const blocks = new Map<number, Promise<number>>(),
    actors = new Map<string, Promise<string>>();
  for (let from = d.block; from <= head.number; from += 1500) {
    const logs = await p.getLogs({
      address: d.address,
      fromBlock: from,
      toBlock: Math.min(head.number, from + 1499),
    });
    for (const log of logs) {
      const ev = iface.parseLog(log);
      if (!ev) continue;
      const a = ev.args,
        id = String(a.jobId);
      if (!blocks.has(log.blockNumber))
        blocks.set(
          log.blockNumber,
          p.getBlock(log.blockNumber).then((b) => {
            if (!b) throw Error("ไม่พบเวลาในบล็อก");
            return b.timestamp;
          }),
        );
      if (!actors.has(log.transactionHash))
        actors.set(
          log.transactionHash,
          p.getTransaction(log.transactionHash).then((tx) => {
            if (!tx) throw Error("ไม่พบธุรกรรม");
            return tx.from;
          }),
        );
      const [time, actor] = await Promise.all([
        blocks.get(log.blockNumber)!,
        actors.get(log.transactionHash)!,
      ]);
      const entry = {
        name: ev.name,
        time,
        actor,
        hash: log.transactionHash,
        text: String(a.reason ?? a.evidence ?? ""),
        amount: a.amount,
        recipient:
          a.recipient ??
          (ev.name === "PaymentReleased" ? a.freelancer : undefined),
      };
      if (!history.has(id)) history.set(id, []);
      history.get(id)!.push(entry);
    }
  }
  const jobs = await Promise.all(
    [...history].map(async ([id, events]) => {
      const [j, s, dis] = await Promise.all([
        c.getJob(id, opt),
        c.submittedAt(id, opt),
        c.disputes(id, opt),
      ]);
      return {
        id,
        title: j.title,
        description: j.description,
        employer: j.employer,
        freelancer: j.freelancer,
        deadline: Number(j.deadline),
        wage: j.wageWei,
        status: Number(j.status),
        evidence: j.evidence,
        reviewEnd: Number(s + period),
        responseEnd: Number(dis.responseDeadline),
        responded: dis.otherPartyResponded,
        events: events.reverse(),
      } as Job;
    }),
  );
  return { jobs: jobs.reverse(), judge, now: head.timestamp, block: head.number };
}
